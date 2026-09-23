"use client";

// Mensajes programados DENTRO del hilo (A6, integrado en el Bloque B): al final
// de la conversación, como burbujas salientes punteadas ("🕒 Programado para
// …" con Editar/Cancelar), fallidos (Reintentar/Descartar) y los cancelados
// solos (el cliente escribió antes, o quien lo programó ya no está activo).
import { useCallback, useEffect, useState } from "react";
import {
  cancelScheduledMessage,
  listScheduledMessages,
  retryScheduledMessage,
} from "@/lib/actions/scheduled";
import { SCHEDULE_TIME_ZONE } from "@/lib/scheduled/rules";
import type { ScheduledView } from "@/lib/scheduled/types";
import { ScheduleForm } from "./schedule-form";

const POLL_MS = 30_000;

const whenFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: SCHEDULE_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function ScheduledInThread({
  conversationId,
  windowExpiresAt,
  refreshToken,
  onCountChange,
}: {
  conversationId: string;
  windowExpiresAt: Date | null;
  /** Cambia con cada evento SSE de la conversación o al programar uno nuevo. */
  refreshToken: number;
  /** Avisa cuántos se muestran (el hilo baja al final cuando aparecen). */
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ScheduledView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await listScheduledMessages(conversationId);
      setItems(next);
      onCountChange?.(next.length);
    } catch {
      // Silencioso: la próxima recarga lo intenta de nuevo.
    }
  }, [conversationId, onCountChange]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, refreshToken]);

  // Mientras haya pendientes, se refresca solo (el envío pasa en el worker).
  const hasPending = items.some((i) => i.status === "scheduled" || i.status === "sending");
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [hasPending, load]);

  async function act(action: () => ReturnType<typeof cancelScheduledMessage>) {
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.message);
    await load();
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) =>
        editingId === item.id ? (
          <div key={item.id} className="flex justify-end">
            <div className="w-full max-w-md">
              <ScheduleForm
                mode={{ type: "edit", item }}
                conversationId={conversationId}
                windowExpiresAt={windowExpiresAt}
                onDone={() => {
                  setEditingId(null);
                  void load();
                }}
                onCancel={() => setEditingId(null)}
              />
            </div>
          </div>
        ) : (
          <div key={item.id} className="flex justify-end">
            <div
              className={`max-w-[78%] rounded-2xl border border-dashed px-3 py-2 text-sm shadow-sm ${
                item.status === "failed"
                  ? "border-brand-orange/60 bg-brand-orange/5"
                  : item.status === "cancelled"
                    ? "border-muted-foreground/40 bg-card/80 text-muted-foreground"
                    : "border-brand-navy/50 bg-card"
              }`}
            >
              <p className="text-[11px] font-medium text-muted-foreground">
                {item.status === "failed"
                  ? `⚠ No se envió · programado para ${whenFormat.format(new Date(item.sendAt))}`
                  : item.status === "cancelled"
                    ? item.cancelReason === "autor_inactivo"
                      ? "🕒 Cancelado: quien lo programó ya no está activo"
                      : "🕒 Cancelado: el cliente escribió antes"
                    : item.status === "sending"
                      ? "🕒 Enviando…"
                      : `🕒 Programado para ${whenFormat.format(new Date(item.sendAt))}${item.kind === "template" ? " · 📄 plantilla" : ""}`}
              </p>
              <p className={`mt-0.5 whitespace-pre-wrap break-words ${item.status === "cancelled" ? "line-through" : ""}`}>{item.body}</p>
              {item.status === "failed" && item.errorMessage && (
                <p className="mt-1 text-[11px] text-brand-orange">{item.errorMessage}</p>
              )}
              <div className="mt-1 flex justify-end gap-1 text-[11px]">
                {item.status === "scheduled" && (
                  <>
                    <button type="button" onClick={() => setEditingId(item.id)} className="rounded px-1.5 py-0.5 text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                      Editar
                    </button>
                    <button type="button" onClick={() => void act(() => cancelScheduledMessage(item.id))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
                      Cancelar
                    </button>
                  </>
                )}
                {item.status === "failed" && item.canRetry && (
                  <button type="button" onClick={() => void act(() => retryScheduledMessage(item.id))} className="rounded px-1.5 py-0.5 font-medium text-brand-orange hover:bg-brand-orange/10">
                    Reintentar
                  </button>
                )}
                {(item.status === "failed" || item.status === "cancelled") && (
                  <button type="button" onClick={() => void act(() => cancelScheduledMessage(item.id))} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
                    Descartar
                  </button>
                )}
              </div>
            </div>
          </div>
        ),
      )}
      {error && <p className="text-right text-xs text-brand-orange">{error}</p>}
    </div>
  );
}
