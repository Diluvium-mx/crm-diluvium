// Helpers de presentación de la bandeja, seguros para el cliente (sin BD).
// La UI recibe los tipos *View ya listos; esto solo formatea fechas/estados.
import type { ConversationListItem, MessageView } from "@/lib/inbox/types";

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Hora corta para la fila: HH:MM si es hoy, "Ayer", o dd/mm. */
export function shortTime(value: Date, now = new Date()): string {
  const d = new Date(value);
  if (sameDay(d, now)) {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" });
}

/** Vista previa de la fila con prefijo "Tú:" si el último fue saliente. */
export function rowPreview(last: ConversationListItem["lastMessage"]): string {
  if (!last) return "Sin mensajes";
  return last.direction === "out" ? `Tú: ${last.preview}` : last.preview;
}

export type Semaforo = "verde" | "ambar" | "rojo" | null;

/** Punto de espera: verde <15min, ámbar <1h, rojo >1h. null = sin punto. */
export function semaforo(awaitingReplySince: Date | null, nowMs: number): Semaforo {
  if (!awaitingReplySince) return null;
  const mins = (nowMs - new Date(awaitingReplySince).getTime()) / 60_000;
  if (mins < 15) return "verde";
  if (mins < 60) return "ambar";
  return "rojo";
}

export const SEMAFORO_CLASS: Record<"verde" | "ambar" | "rojo", string> = {
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  rojo: "bg-red-500",
};

export const SEMAFORO_LABEL: Record<"verde" | "ambar" | "rojo", string> = {
  verde: "Espera menos de 15 min",
  ambar: "Espera menos de 1 h",
  rojo: "Espera más de 1 h",
};

/** true si la ventana de 24 h sigue abierta. */
export function isWindowOpen(windowExpiresAt: Date | null, nowMs: number): boolean {
  return !!windowExpiresAt && new Date(windowExpiresAt).getTime() > nowMs;
}

/** Horas enteras restantes de la ventana (mín. 1 si sigue abierta). */
export function windowHoursLeft(windowExpiresAt: Date | null, nowMs: number): number {
  if (!windowExpiresAt) return 0;
  const ms = new Date(windowExpiresAt).getTime() - nowMs;
  return ms > 0 ? Math.max(1, Math.ceil(ms / 3_600_000)) : 0;
}

/** Etiqueta del separador por día dentro del hilo. */
export function dayLabel(value: Date, now = new Date()): string {
  const d = new Date(value);
  if (sameDay(d, now)) return "Hoy";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

export function bubbleTime(value: Date): string {
  return new Date(value).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/** Marca de estado del saliente (✓ / ✓✓ / leído / ⚠). */
export function statusMark(status: MessageView["status"]): { glyph: string; label: string; className: string } {
  switch (status) {
    case "queued":
      return { glyph: "🕗", label: "Enviando…", className: "text-brand-white/60" };
    case "sent":
      return { glyph: "✓", label: "Enviado", className: "text-brand-white/70" };
    case "delivered":
      return { glyph: "✓✓", label: "Entregado", className: "text-brand-white/70" };
    case "read":
      return { glyph: "✓✓", label: "Leído", className: "text-sky-300" };
    case "failed":
      return { glyph: "⚠", label: "No se envió", className: "text-red-200" };
    default:
      return { glyph: "", label: "", className: "" };
  }
}
