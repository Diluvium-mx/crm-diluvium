"use client";

// Seguimiento del Agente IA en el composer (docs/seguimientos.md §8, decisión del dueño del
// 2-oct-2026): una píldora 🤖 que RELLENA el hueco blanco de la barra arriba de ⚡ 📄 📎 (la caja
// de texto mide dos renglones y los iconos uno), sin agrandar la barra. Solo aparece cuando el
// chat tiene un seguimiento. Al tocarla se abre la burbuja arriba del composer (como Mensajes
// rápidos) con qué quedó pendiente, a qué hora sale, por dónde y Ver mensaje · Cambiar hora ·
// Lo mando yo · Cancelar (y "Que salga solo" en una sugerencia).
// Parte 1 = MODO ENSAYO: la píldora gris punteada dice "Ensayo"; nada sale al cliente.
// Consultas: al abrir el chat, con cada aviso "followup.updated" de este chat y al volver a la pestaña.
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { approveSuggestedFollowUp, cancelFollowUp, getFollowUp, rescheduleFollowUp } from "@/lib/actions/seguimientos";
import type { FollowUpView } from "@/lib/followups/view";
import { followUpText } from "@/lib/followups/message";
import { whatsappWebLink } from "@/lib/contacts/whatsapp-link";
import { instantToLocal, SCHEDULE_TIME_ZONE } from "@/lib/scheduled/rules";
import { CloseX } from "@/components/ui/close-x";
import { useInboxStream } from "./use-inbox-stream";

// ── Datos ────────────────────────────────────────────────────────────────────

export function useFollowUp(conversationId: string): { followUp: FollowUpView | null; reload: () => void } {
  const [followUp, setFollowUp] = useState<FollowUpView | null>(null);
  const seq = useRef(0);
  const [seen, setSeen] = useState(conversationId);
  if (seen !== conversationId) {
    setSeen(conversationId);
    setFollowUp(null);
  }
  const reload = useCallback(() => {
    const mine = ++seq.current;
    void getFollowUp(conversationId).then((view) => {
      if (mine === seq.current) setFollowUp(view);
    });
  }, [conversationId]);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  useInboxStream((event) => {
    if (event.type === "reload") reload();
    else if (event.type === "followup.updated" && event.conversationId === conversationId) reload();
  });
  return { followUp, reload };
}

// ── Formato ──────────────────────────────────────────────────────────────────

const dayKey = (d: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hourOf = (d: Date, zone: string) => new Intl.DateTimeFormat("es-MX", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const weekdayOf = (d: Date, zone: string) => new Intl.DateTimeFormat("es-MX", { timeZone: zone, weekday: "short" }).format(d).replace(".", "");

/** "20:00" (hoy) · "mañana 10:00" · "sáb 10:00" · "12 oct 10:00" (más de una semana). */
export function whenLabel(iso: string, zone: string = SCHEDULE_TIME_ZONE, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = dayKey(now, zone);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60_000), zone);
  const day = dayKey(d, zone);
  const hour = hourOf(d, zone);
  if (day === today) return hour;
  if (day === tomorrow) return `mañana ${hour}`;
  if (d.getTime() - now.getTime() < 6 * 24 * 60 * 60_000) return `${weekdayOf(d, zone)} ${hour}`;
  const date = new Intl.DateTimeFormat("es-MX", { timeZone: zone, day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${date} ${hour}`;
}

const ZONE_NAMES: Readonly<Record<string, string>> = {
  "America/Mexico_City": "centro",
  "America/Mazatlan": "Mazatlán",
  "America/Tijuana": "Tijuana",
  "America/Hermosillo": "Sonora",
  "America/Chihuahua": "Chihuahua",
  "America/Ciudad_Juarez": "Cd. Juárez",
  "America/Cancun": "Cancún",
};

function pillText(f: FollowUpView): string {
  const prefix = f.ensayo ? "Ensayo" : f.modo === "sugerido" ? "Sugerido" : "Seguimiento";
  if (f.status === "esperando") return `${prefix} · esperando`;
  return f.dueAt ? `${prefix} · ${whenLabel(f.dueAt)}` : prefix;
}

// ── Píldora ──────────────────────────────────────────────────────────────────

export function FollowUpPill({ followUp, open, onToggle, className = "" }: { followUp: FollowUpView; open: boolean; onToggle: () => void; className?: string }) {
  const tone = followUp.ensayo
    ? "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground"
    : followUp.modo === "sugerido" && !followUp.autoAprobado
      ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
      : "border-brand-navy bg-brand-navy/10 text-brand-navy dark:text-sky-300";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Seguimiento del Agente IA: ${followUp.casoLabel}`}
      title={`Seguimiento del Agente IA · ${followUp.casoLabel}`}
      data-testid="followup-pill"
      className={`h-5 min-w-0 items-center justify-center gap-1 rounded-full border px-2 text-[11px] leading-none whitespace-nowrap transition-colors ${tone} ${open ? "ring-2 ring-brand-navy/30" : ""} ${className}`}
    >
      <span aria-hidden="true">🤖</span>
      <span className="truncate">{pillText(followUp)}</span>
    </button>
  );
}

// ── Burbuja ──────────────────────────────────────────────────────────────────

export function FollowUpPanel({ followUp, onClose, onChanged }: { followUp: FollowUpView; onClose: () => void; onChanged: () => void }) {
  const [showMessage, setShowMessage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [local, setLocal] = useState(followUp.dueAt ? instantToLocal(new Date(followUp.dueAt)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = followUp;
  const due = f.dueAt ? new Date(f.dueAt) : null;
  const clientHour = due && dayKey(due, f.timeZone) + hourOf(due, f.timeZone) !== dayKey(due, SCHEDULE_TIME_ZONE) + hourOf(due, SCHEDULE_TIME_ZONE) ? hourOf(due, f.timeZone) : null;
  const text = f.borrador ? followUpText(f.borrador, f.firstName, due ?? new Date(), f.timeZone) : null;

  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(result.message);
      else onChanged();
      return result.ok;
    } catch {
      setError("No se pudo guardar. Inténtalo otra vez.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const button = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-brand-navy/10 disabled:opacity-50";
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      data-testid="followup-panel"
      className="mb-2 flex max-h-[min(26rem,55cqh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-md"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-brand-navy dark:text-sky-300">
          <span aria-hidden="true">🤖</span>
          <span className="truncate">Seguimiento del Agente IA</span>
          {f.ensayo && <span className="rounded-full border border-dashed border-muted-foreground/60 px-2 text-[11px] font-medium text-muted-foreground">Ensayo</span>}
          {f.total > 0 && f.status === "programado" && <span className="rounded-full bg-brand-navy/10 px-2 text-[11px] font-medium">{`${f.intento}.º de ${f.total}`}</span>}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar seguimiento"
          className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:flex"
        >
          <X className="size-4" aria-hidden="true" />
          Cerrar
        </button>
        <CloseX size="sm" label="Cerrar seguimiento" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 text-sm">
        {f.ensayo && <p className="text-xs text-muted-foreground">Modo ensayo: así trabajaría el seguimiento; no se le manda nada al cliente.</p>}
        <div>
          <p className="font-medium">{f.casoLabel}</p>
          {f.pendiente && <p className="text-muted-foreground">{f.pendiente}</p>}
          <p className="text-muted-foreground">Busca: {f.siguientePaso ?? f.objetivo}</p>
        </div>

        {f.status === "esperando" ? (
          <p>
            Ya {f.ensayo ? "habría salido" : "salió"} el último intento; espera respuesta{due ? ` hasta ${whenLabel(f.dueAt!)}` : ""}. Si no contesta, pasa a frío.
          </p>
        ) : (
          <div className="space-y-0.5">
            <p>
              <span className="text-muted-foreground">{f.ensayo ? "Saldría:" : "Sale:"}</span> {due ? whenLabel(f.dueAt!) : "—"}
              {clientHour && <span className="text-muted-foreground">{` (su hora: ${clientHour}, ${ZONE_NAMES[f.timeZone] ?? f.timeZone})`}</span>}
              {f.dueSetBy === "vendedor" && <span className="text-muted-foreground"> · hora puesta a mano</span>}
            </p>
            <p>
              <span className="text-muted-foreground">Por dónde:</span>{" "}
              {f.door === "plantilla" ? `plantilla «${f.templateText ?? f.templateName}»` : "texto del Agente IA (la ventana de 24 h sigue abierta)"}
            </p>
            {f.modo === "sugerido" && (
              <p className="rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                {f.autoAprobado
                  ? "Saldrá solo a su hora (lo aprobó un vendedor)."
                  : `Queda como sugerencia: el Agente IA está en pausa a mano en este chat.${f.presentarAt ? ` Se le presenta al vendedor: ${whenLabel(f.presentarAt)}.` : ""}`}
              </p>
            )}
          </div>
        )}

        {f.intentos.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {f.intentos.map((a) => (
              <li key={a.n}>
                {a.modo === "vendedor"
                  ? `${a.n}.º lo mandó un vendedor ${whenLabel(a.at)}`
                  : `${a.n}.º ${f.ensayo ? "habría salido" : "salió"} ${whenLabel(a.at)} · ${a.door === "plantilla" ? `plantilla ${a.template}` : "texto"}${a.modo === "sugerido" ? " · sugerido" : ""}`}
              </li>
            ))}
          </ul>
        )}

        {showMessage && (
          <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-[13px]">
            {f.door === "plantilla" ? (
              <>
                <p>{f.templateText ?? f.templateName}</p>
                {text && <p className="mt-2 text-muted-foreground">Cuando conteste, el Agente IA retoma: {f.borrador}</p>}
              </>
            ) : (
              <p>{text ?? "El lector no dejó borrador para este chat."}</p>
            )}
          </div>
        )}

        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={local}
              onChange={(event) => setLocal(event.target.value)}
              aria-label="Nueva hora (Mazatlán)"
              className="rounded-md border bg-background px-2 py-1 text-sm"
            />
            <span className="text-xs text-muted-foreground">hora de Mazatlán</span>
            <button
              type="button"
              disabled={busy || !local}
              onClick={() => void run(() => rescheduleFollowUp(f.id, local)).then((ok) => ok && setEditing(false))}
              className={`${button} border-brand-navy`}
            >
              Guardar
            </button>
          </div>
        )}

        {confirmCancel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs dark:border-red-500/40 dark:bg-red-500/10">
            <span>¿Cancelar este seguimiento? Se cancelan los intentos que faltan.</span>
            <button type="button" disabled={busy} onClick={() => void run(() => cancelFollowUp(f.id)).then((ok) => ok && onClose())} className={`${button} border-red-400 text-red-700 dark:text-red-300`}>
              Sí, cancelar
            </button>
            <button type="button" onClick={() => setConfirmCancel(false)} className={button}>
              No
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setShowMessage((v) => !v)} className={button} aria-expanded={showMessage}>
              {showMessage ? "Ocultar mensaje" : "Ver mensaje"}
            </button>
            {f.status === "programado" && (
              <button type="button" onClick={() => setEditing((v) => !v)} className={button} aria-expanded={editing}>
                Cambiar hora
              </button>
            )}
            {f.phoneE164 && f.borrador && (
              <a
                href={whatsappWebLink(f.phoneE164, followUpText(f.borrador, f.firstName, new Date(), f.timeZone))}
                target="_blank"
                rel="noopener noreferrer"
                className={button}
                title="Abre WhatsApp Web con el texto ya escrito (gratis y sin ventana de 24 h)"
              >
                Lo mando yo
              </a>
            )}
            {f.status === "programado" && f.modo === "sugerido" && !f.autoAprobado && (
              <button type="button" disabled={busy} onClick={() => void run(() => approveSuggestedFollowUp(f.id))} className={`${button} border-amber-500`}>
                Que salga solo
              </button>
            )}
            <button type="button" onClick={() => setConfirmCancel(true)} className={`${button} text-red-700 dark:text-red-300`}>
              Cancelar
            </button>
          </div>
        )}
        {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
