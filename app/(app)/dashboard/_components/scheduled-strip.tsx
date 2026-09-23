"use client";

// "🕒 Programado para …" fijo ARRIBA del composer (A6), fuera del hilo: las
// burbujas son de otro track; en el Bloque B esto se integra al hilo. Muestra
// pendientes (editar/cancelar), fallidos (Reintentar/Descartar) y los que se
// cancelaron solos porque el cliente escribió antes.
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

export function ScheduledStrip({
  conversationId,
  windowExpiresAt,
  refreshToken,
}: {
  conversationId: string;
  windowExpiresAt: Date | null;
  /** Cambia con cada evento SSE de la conversación o al programar uno nuevo. */
  refreshToken: number;
}) {
  const [items, setItems] = useState<ScheduledView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listScheduledMessages(conversationId));
    } catch {
      // Silencioso: la próxima recarga lo intenta de nuevo.
    }
  }, [conversationId]);

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
    <div className="space-y-1 border-t bg-card px-3 pt-2">
      {items.map((item) =>
        editingId === item.id ? (
          <ScheduleForm
            key={item.id}
            mode={{ type: "edit", item }}
            conversationId={conversationId}
            windowExpiresAt={windowExpiresAt}
            onDone={() => {
              setEditingId(null);
              void load();
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={item.id}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
              item.status === "failed" ? "border-brand-orange/50 bg-brand-orange/5" : "bg-muted/40"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.status === "failed"
                  ? `⚠ No se envió el mensaje programado para ${whenFormat.format(new Date(item.sendAt))}`
                  : item.status === "cancelled"
                    ? item.cancelReason === "autor_inactivo"
                      ? "🕒 Cancelado: quien lo programó ya no está activo"
                      : "🕒 Cancelado: el cliente escribió antes"
                    : item.status === "sending"
                      ? "🕒 Enviando mensaje programado…"
                      : `🕒 Programado para ${whenFormat.format(new Date(item.sendAt))}${item.kind === "template" ? " · 📄 plantilla" : ""}`}
              </p>
              <p className="truncate text-muted-foreground">
                {item.status === "failed" && item.errorMessage ? `${item.errorMessage} · ` : ""}
                {item.body}
              </p>
            </div>
            {item.status === "scheduled" && (
              <>
                <button type="button" onClick={() => setEditingId(item.id)} className="rounded px-2 py-1 text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                  Editar
                </button>
                <button type="button" onClick={() => void act(() => cancelScheduledMessage(item.id))} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted">
                  Cancelar
                </button>
              </>
            )}
            {item.status === "failed" && item.canRetry && (
              <button type="button" onClick={() => void act(() => retryScheduledMessage(item.id))} className="rounded px-2 py-1 font-medium text-brand-orange hover:bg-brand-orange/10">
                Reintentar
              </button>
            )}
            {(item.status === "failed" || item.status === "cancelled") && (
              <button type="button" onClick={() => void act(() => cancelScheduledMessage(item.id))} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted">
                Descartar
              </button>
            )}
          </div>
        ),
      )}
      {error && <p className="text-xs text-brand-orange">{error}</p>}
    </div>
  );
}
