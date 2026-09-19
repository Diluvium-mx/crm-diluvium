"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdReferral, AttachmentView, ConversationDetail, MessageView } from "@/lib/inbox/types";
import { listMessages, retryMessage, sendMessage } from "@/lib/inbox/actions";
import {
  bubbleTime,
  dayLabel,
  isWindowOpen,
  statusMark,
  windowHoursLeft,
} from "./format";

const PAGE_LIMIT = 30;

// Mensaje pintado de forma optimista (aún sin id del servidor). Se reconcilia
// con el `message.upserted` del SSE: al re-pedir el hilo, se descarta el
// optimista cuyo texto ya aparece como mensaje saliente real.
type OptimisticMessage = {
  clientId: string;
  optimistic: true;
  direction: "out";
  kind: "text";
  body: string;
  status: "queued" | "failed";
  errorMessage: string | null;
  sentAt: Date;
};

type Row = (MessageView & { optimistic?: false }) | OptimisticMessage;

function isOptimistic(row: Row): row is OptimisticMessage {
  return "optimistic" in row && row.optimistic === true;
}

function AdReferralCard({ referral }: { referral: AdReferral }) {
  return (
    <div className="mb-1 overflow-hidden rounded-lg border bg-card">
      <div className="bg-brand-orange/10 px-2 py-1 text-[11px] font-medium text-brand-orange">
        📣 Llegó por anuncio
      </div>
      <div className="flex gap-2 p-2">
        {referral.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={referral.thumbnailUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0">
          {referral.headline && <p className="truncate text-xs font-semibold">{referral.headline}</p>}
          {referral.body && <p className="line-clamp-2 text-xs text-muted-foreground">{referral.body}</p>}
        </div>
      </div>
    </div>
  );
}

function Attachment({ attachment }: { attachment: AttachmentView }) {
  if (attachment.state === "processing") {
    return <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">Procesando…</div>;
  }
  if (attachment.state === "failed") {
    return <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">Adjunto no disponible</div>;
  }
  switch (attachment.kind) {
    case "image":
    case "sticker":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.url} alt={attachment.fileName ?? "Imagen"} className="max-h-64 rounded-md object-cover" />
      );
    case "audio":
      return <audio controls src={attachment.url} className="w-56" />;
    case "video":
      return <video controls src={attachment.url} className="max-h-64 rounded-md" />;
    default:
      return (
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs hover:bg-muted"
        >
          <span aria-hidden="true">📄</span>
          <span className="min-w-0 truncate">{attachment.fileName ?? "Documento"}</span>
          <span className="ml-auto text-brand-navy">Descargar</span>
        </a>
      );
  }
}

function Bubble({ row, onRetry }: { row: Row; onRetry: (row: Row) => void }) {
  const out = row.direction === "out";
  const opt = isOptimistic(row);
  const mark = out ? statusMark(row.status) : null;
  const canRetry = opt ? row.status === "failed" : row.status === "failed" && (row as MessageView).canRetry;
  const errorMessage = opt ? row.errorMessage : (row as MessageView).errorMessage;
  const attachments = opt ? [] : (row as MessageView).attachments;
  const adReferral = opt ? null : (row as MessageView).adReferral;

  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          out ? "bg-brand-navy text-brand-white" : "bg-card text-foreground border"
        }`}
      >
        {adReferral && <AdReferralCard referral={adReferral} />}
        {attachments.length > 0 && (
          <div className="mb-1 flex flex-col gap-1">
            {attachments.map((att) => (
              <Attachment key={att.index} attachment={att} />
            ))}
          </div>
        )}
        {row.body && <p className="whitespace-pre-wrap break-words">{row.body}</p>}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-white/70" : "text-muted-foreground"}`}>
          <span>{bubbleTime(row.sentAt)}</span>
          {mark && mark.glyph && (
            <span className={mark.className} title={mark.label} aria-label={mark.label}>
              {mark.glyph}
            </span>
          )}
        </div>
        {out && row.status === "failed" && (
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-red-200">
            <span className="text-red-300">{errorMessage ?? "No se envió."}</span>
            {canRetry && (
              <button
                type="button"
                onClick={() => onRetry(row)}
                className="rounded bg-brand-white/15 px-2 py-0.5 font-medium hover:bg-brand-white/25"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThread({
  detail,
  revalToken,
  nowMs,
}: {
  detail: ConversationDetail;
  revalToken: number;
  nowMs: number;
}) {
  const conversationId = detail.id;
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const windowOpen = isWindowOpen(detail.windowExpiresAt, nowMs);
  const hoursLeft = windowHoursLeft(detail.windowExpiresAt, nowMs);

  // Descarta optimistas cuyo texto ya llegó como saliente real (reconciliación).
  const reconcile = useCallback((server: MessageView[]) => {
    setOptimistic((current) => {
      if (current.length === 0) return current;
      const outBodies = new Set(server.filter((m) => m.direction === "out").map((m) => m.body ?? ""));
      return current.filter((o) => !(o.status === "queued" && outBodies.has(o.body)));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await listMessages(conversationId, { limit: PAGE_LIMIT });
      if (!page) {
        setLoadError("No se pudo cargar la conversación.");
        return;
      }
      setMessages(page.messages);
      setHasMore(page.hasMore);
      reconcile(page.messages);
    } catch {
      setLoadError("No se pudo cargar la conversación.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, reconcile]);

  // Carga inicial y recarga ante cada evento SSE de esta conversación.
  useEffect(() => {
    // Diferido: evita setState síncrono dentro del efecto (react-hooks).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, revalToken]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    const page = await listMessages(conversationId, { before: oldest.id, limit: PAGE_LIMIT });
    if (!page) return;
    setMessages((current) => [...page.messages, ...current]);
    setHasMore(page.hasMore);
  }

  // Auto-scroll al fondo cuando cambia la cantidad de mensajes/optimistas.
  const rows: Row[] = useMemo(() => [...messages, ...optimistic], [messages, optimistic]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, conversationId]);

  async function doSend(text: string) {
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimistic((current) => [
      ...current,
      { clientId, optimistic: true, direction: "out", kind: "text", body: text, status: "queued", errorMessage: null, sentAt: new Date() },
    ]);
    const result = await sendMessage(conversationId, text);
    if (!result.ok) {
      setOptimistic((current) =>
        current.map((o) => (o.clientId === clientId ? { ...o, status: "failed", errorMessage: result.message } : o)),
      );
    }
    // ok:true (pending o no) → el message.upserted del SSE recargará y
    // reconciliará; el optimista "queued" se descarta al aparecer el real.
  }

  function handleSubmit() {
    const text = draft.trim();
    if (!text || !windowOpen) return;
    setDraft("");
    void doSend(text);
  }

  async function handleRetry(row: Row) {
    if (isOptimistic(row)) {
      // Optimista fallido: reintentar = volver a enviar el mismo texto.
      setOptimistic((current) => current.filter((o) => o.clientId !== row.clientId));
      await doSend(row.body);
      return;
    }
    // Mensaje real fallido con canRetry: usar retryMessage(id).
    const result = await retryMessage(row.id);
    if (!result.ok) {
      setMessages((current) =>
        current.map((m) => (m.id === row.id ? { ...m, errorMessage: result.message } : m)),
      );
    }
    // Éxito → SSE recarga.
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      {/* Encabezado */}
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{detail.contact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail.contact.phone ?? "Sin teléfono"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-navy/10 px-2.5 py-1 text-xs font-medium text-brand-navy">
          {detail.contact.stage}
        </span>
      </header>

      {/* Aviso de ventana de 24 h */}
      <div
        className={`border-b px-4 py-1.5 text-center text-xs ${
          windowOpen ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        }`}
      >
        {windowOpen
          ? `Ventana abierta · quedan ${hoursLeft} h`
          : "Pasaron 24 h desde su último mensaje. Solo se puede enviar una plantilla."}
      </div>

      {/* Hilo */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {loading && messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando mensajes…</p>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-brand-orange">{loadError}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay mensajes.</p>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Cargar mensajes anteriores
                </button>
              </div>
            )}
            {rows.map((row, index) => {
              const key = isOptimistic(row) ? row.clientId : row.id;
              const prev = rows[index - 1];
              const showDay =
                !prev || dayLabel(new Date(prev.sentAt)) !== dayLabel(new Date(row.sentAt));
              return (
                <div key={key}>
                  {showDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                        {dayLabel(new Date(row.sentAt))}
                      </span>
                    </div>
                  )}
                  <Bubble row={row} onRetry={handleRetry} />
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-card p-3">
        {windowOpen ? (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
              placeholder="Escribe un mensaje… (Enter envía, Shift+Enter salto de línea)"
              className="max-h-32 min-h-[40px] flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!draft.trim()}
              className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        ) : (
          <div className="rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            Fuera de la ventana de 24 h. El envío de plantillas llega con el número real.
          </div>
        )}
      </div>
    </div>
  );
}
