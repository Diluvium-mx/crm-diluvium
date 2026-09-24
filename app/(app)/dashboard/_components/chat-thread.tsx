"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdReferral, AttachmentView, ConversationDetail, MessageView } from "@/lib/inbox/types";
import { listMessages, retryMessage, sendMessage, sendTemplate } from "@/lib/inbox/actions";
import { Composer } from "./composer";
import { DocumentCard } from "./document-card";
import { MediaViewer } from "./media-viewer";
import { ScheduledInThread } from "./scheduled-in-thread";
import { AgentNoticeLine, AgentPausedBanner, useConversationAgent } from "./agent-in-thread";
import { interleaveNotices } from "@/lib/agente-ia/timeline";
import { AdFreeWindowNote, AdReferralCard } from "./ad-referral-card";
import {
  bubbleTime,
  dayLabel,
  isWindowOpen,
  statusMark,
  windowHoursLeft,
} from "./format";
import { displayPhone } from "@/lib/phone-format";

const PAGE_LIMIT = 30;

// Mensaje pintado de forma optimista (aún sin id del servidor). Se reconcilia
// con el `message.upserted` del SSE: al re-pedir el hilo, se descarta el
// optimista cuyo texto ya aparece como mensaje saliente real.
type OptimisticMessage = {
  clientId: string;
  optimistic: true;
  direction: "out";
  kind: "text" | "template";
  body: string;
  status: "queued" | "failed";
  errorMessage: string | null;
  sentAt: Date;
};

type Row = (MessageView & { optimistic?: false }) | OptimisticMessage;

function isOptimistic(row: Row): row is OptimisticMessage {
  return "optimistic" in row && row.optimistic === true;
}

function Attachment({ attachment, onOpen }: { attachment: AttachmentView; onOpen: () => void }) {
  if (attachment.state === "failed") {
    return <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">Adjunto no disponible</div>;
  }
  // Mientras se copia al bucket el mensaje ya se ve: "Procesando…" y el SSE lo
  // rellena al terminar (message.upserted).
  if (attachment.state === "processing") {
    return attachment.kind === "document" ? (
      <div className="w-64 max-w-full rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        📄 {attachment.fileName ?? "Documento"} · Procesando…
      </div>
    ) : (
      <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">Procesando…</div>
    );
  }
  switch (attachment.kind) {
    case "image":
    case "sticker":
      return (
        <button type="button" onClick={onOpen} className="block cursor-zoom-in" aria-label="Ver imagen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.fileName ?? "Imagen"} className="max-h-64 rounded-md object-cover" />
        </button>
      );
    case "audio":
      return <audio controls src={attachment.url} className="w-56" />;
    case "video":
      return <video controls src={attachment.url} className="max-h-64 rounded-md" />;
    default:
      return <DocumentCard attachment={attachment} onOpen={onOpen} />;
  }
}

function Bubble({
  row,
  onRetry,
  onOpenAttachment,
}: {
  row: Row;
  onRetry: (row: Row) => void;
  onOpenAttachment: (attachment: AttachmentView) => void;
}) {
  const out = row.direction === "out";
  const opt = isOptimistic(row);
  const mark = out ? statusMark(row.status) : null;
  // Una plantilla optimista fallida NO se reintenta como texto (fuera de la
  // ventana de 24 h el texto se rechaza): el vendedor vuelve a elegir plantilla.
  const canRetry = opt
    ? row.status === "failed" && row.kind !== "template"
    : row.status === "failed" && (row as MessageView).canRetry;
  const errorMessage = opt ? row.errorMessage : (row as MessageView).errorMessage;
  const attachments = opt ? [] : (row as MessageView).attachments;
  const adReferral: AdReferral | null = opt ? null : (row as MessageView).adReferral;
  const view = opt ? null : (row as MessageView);
  const reactions = view ? [view.reactions.contact, view.reactions.business].filter(Boolean) : [];

  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"} ${reactions.length ? "mb-3" : ""}`}>
      <div
        className={`relative max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          out ? "bg-brand-navy text-brand-white" : "bg-card text-foreground border"
        }`}
      >
        {view?.quoted && (
          <div
            className={`mb-1 rounded-md border-l-4 px-2 py-1 text-xs ${
              out ? "border-brand-white/60 bg-brand-white/10" : "border-brand-navy/60 bg-muted"
            }`}
          >
            <span className="font-medium">{view.quoted.direction === "out" ? "Tú" : "Cliente"}</span>
            <p className="line-clamp-2 opacity-80">{view.quoted.preview}</p>
          </div>
        )}
        {view?.deletedAt && (
          <p className={`mb-1 text-[11px] italic ${out ? "text-brand-white/70" : "text-muted-foreground"}`}>
            🚫 Eliminado en WhatsApp por su autor (se conserva en el CRM)
          </p>
        )}
        {adReferral && <AdReferralCard referral={adReferral} />}
        {view?.location && (
          <a
            href={`https://www.google.com/maps?q=${view.location.latitude},${view.location.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 block rounded-md border px-2 py-1 text-xs underline-offset-2 hover:underline"
          >
            📍 {view.location.name ?? "Ubicación"}
            {view.location.address && <span className="block opacity-80">{view.location.address}</span>}
          </a>
        )}
        {view && view.contactCards.length > 0 && (
          <div className="mb-1 flex flex-col gap-0.5 text-xs">
            {view.contactCards.map((name, i) => (
              <span key={i}>👤 {name}</span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-1 flex flex-col gap-1">
            {attachments.map((att) => (
              <Attachment key={att.index} attachment={att} onOpen={() => onOpenAttachment(att)} />
            ))}
          </div>
        )}
        {row.body && <p className="whitespace-pre-wrap break-words">{row.body}</p>}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-white/70" : "text-muted-foreground"}`}>
          {view?.editedAt && <span>editado</span>}
          <span>{bubbleTime(row.sentAt)}</span>
          {mark && mark.glyph && (
            <span className={mark.className} title={mark.label} aria-label={mark.label}>
              {mark.glyph}
            </span>
          )}
        </div>
        {reactions.length > 0 && (
          <span
            className={`absolute -bottom-3 ${out ? "right-2" : "left-2"} rounded-full border bg-card px-1.5 text-xs text-foreground shadow-sm`}
            aria-label={`Reacciones: ${reactions.join(" ")}`}
          >
            {reactions.join(" ")}
          </span>
        )}
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
  const [viewing, setViewing] = useState<AttachmentView | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Sube al programar un mensaje: la franja de programados (A6) se recarga.
  const [scheduledRev, setScheduledRev] = useState(0);
  const [scheduledCount, setScheduledCount] = useState(0);
  // Agente IA (Fase B): pausa + avisos; se recarga con el SSE de la conversación.
  const { agent, reload: reloadAgent } = useConversationAgent(conversationId, revalToken, detail);

  const windowOpen = isWindowOpen(detail.windowExpiresAt, nowMs);
  const hoursLeft = windowHoursLeft(detail.windowExpiresAt, nowMs);

  // Descarta optimistas (texto o plantilla) cuyo cuerpo ya llegó como saliente
  // real, sin importar si estaban "queued" o "failed": así no queda un duplicado
  // (la burbuja optimista fallida junto a la fila real) cuando el envío se
  // rechazó y su fila real ya cargó por SSE.
  const reconcile = useCallback((server: MessageView[]) => {
    setOptimistic((current) => {
      if (current.length === 0) return current;
      const outBodies = new Set(server.filter((m) => m.direction === "out").map((m) => m.body ?? ""));
      return current.filter((o) => !outBodies.has(o.body));
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
  // Avisos del agente intercalados por hora con los mensajes.
  const timeline = useMemo(() => interleaveNotices(rows, agent?.notices ?? [], hasMore), [rows, agent?.notices, hasMore]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
  const noticeCount = agent?.notices.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, scheduledCount, conversationId, noticeCount]);

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

  // Envío optimista de una plantilla (misma mecánica que el texto: la burbuja
  // guarda el cuerpo ya rellenado, que coincide con el mensaje real al llegar
  // por SSE y reconcilia). Solo se usa con la ventana de 24 h cerrada.
  async function doSendTemplate(templateId: string, values: string[], preview: string) {
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimistic((current) => [
      ...current,
      { clientId, optimistic: true, direction: "out", kind: "template", body: preview, status: "queued", errorMessage: null, sentAt: new Date() },
    ]);
    const result = await sendTemplate(conversationId, templateId, values);
    if (!result.ok) {
      setOptimistic((current) =>
        current.map((o) => (o.clientId === clientId ? { ...o, status: "failed", errorMessage: result.message } : o)),
      );
    }
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
          <p className="truncate text-xs text-muted-foreground">{displayPhone(detail.contact.phone) || "Sin teléfono"}</p>
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
        <AdFreeWindowNote adEntry={detail.adEntry} nowMs={nowMs} />
      </div>
      <AgentPausedBanner conversationId={conversationId} agent={agent} onChanged={() => void reloadAgent()} />

      {/* Hilo */}
      <div ref={scrollRef} className="chat-wallpaper min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
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
            {timeline.map((item) => {
              if (item.kind === "notice") return <AgentNoticeLine key={`aviso-${item.notice.id}`} notice={item.notice} />;
              const row = item.row;
              const key = isOptimistic(row) ? row.clientId : row.id;
              const prev = rows[(rowIndex.get(row) ?? 0) - 1];
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
                  <Bubble row={row} onRetry={handleRetry} onOpenAttachment={setViewing} />
                </div>
              );
            })}
          </>
        )}
        {/* Programados (A6) al final del hilo: van después de lo ya enviado. */}
        <ScheduledInThread
          key={`sched-${conversationId}`}
          conversationId={conversationId}
          windowExpiresAt={detail.windowExpiresAt}
          refreshToken={revalToken + scheduledRev}
          onCountChange={setScheduledCount}
        />
      </div>

      {/* Composer (composer.tsx): texto libre, fragmentos y plantillas con la
          ventana abierta; solo plantilla cuando está cerrada. key: al cambiar de
          conversación se reinicia el borrador y se cierran los selectores. */}
      <Composer
        key={conversationId}
        conversationId={conversationId}
        windowOpen={windowOpen}
        windowExpiresAt={detail.windowExpiresAt}
        onSendText={(text) => void doSend(text)}
        onSendTemplate={(templateId, values, preview) => void doSendTemplate(templateId, values, preview)}
        onScheduled={() => setScheduledRev((n) => n + 1)}
      />
      {viewing && <MediaViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
