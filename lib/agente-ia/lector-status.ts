// Estado del Agente IA en segundo plano para el indicador del Detalle (29-sep-2026). PURO:
// recibe lo que ya se leyó de la base y de Redis y decide qué mostrar.
//   espera  → hay mensajes sin leer: "Leerá el chat en ~N min" (mismas reglas del barrido);
//   leyendo → el lector tiene tomado el candado del chat (Luna está leyendo);
//   al_dia  → última lectura bien, sin nada nuevo: "Al día · leído 10:42";
//   error   → la última lectura falló (el barrido reintenta solo).
//   null    → nunca lo ha leído el lector y no hay nada pendiente (no se muestra nada).
// Un contacto con dos chats (dos números): manda el que esté leyendo, luego el pendiente
// que se lea primero y, si no, la lectura más reciente.
import { LECTOR_EVERY_MS, LECTOR_LOOKBACK_DAYS, LECTOR_MAX_WAIT_MS, LECTOR_QUIET_MS } from "@/lib/ai/runtime/lector-core";

export type LectorConversationInfo = {
  conversationId: string;
  lastMessageAt: Date;
  /** conversations.detalle_leido_hasta (null = nunca marcada). */
  leidoHasta: Date | null;
  /** Primer mensaje sin leer (para el tope de espera); null si no se sabe. */
  firstUnreadAt: Date | null;
  /** El candado lector-lock:<id> existe: lo está leyendo ahora. */
  reading: boolean;
  /** Última fila de ai_usage (etapa "detalle") de esta conversación. */
  lastRead: { at: Date; ok: boolean } | null;
};

export type LectorStatus =
  | { kind: "leyendo" }
  | { kind: "espera"; etaSeconds: number }
  | { kind: "al_dia"; at: string }
  | { kind: "error"; at: string }
  | null;

// Cuándo lo tomará el barrido: al calmarse el chat o al cumplirse el tope desde el primer
// mensaje sin leer (lo que pase antes), más el siguiente paso del barrido (hasta 1 min).
export function etaSeconds(c: Pick<LectorConversationInfo, "lastMessageAt" | "firstUnreadAt">, now: Date): number {
  const quiet = c.lastMessageAt.getTime() + LECTOR_QUIET_MS;
  const cap = c.firstUnreadAt ? c.firstUnreadAt.getTime() + LECTOR_MAX_WAIT_MS : quiet;
  const due = Math.min(quiet, cap) + LECTOR_EVERY_MS / 2;
  return Math.max(0, Math.round((due - now.getTime()) / 1000));
}

export function isPending(c: Pick<LectorConversationInfo, "lastMessageAt" | "leidoHasta">, now: Date): boolean {
  // Lo más viejo que LECTOR_LOOKBACK_DAYS no lo toma el barrido: no se promete una lectura.
  if (now.getTime() - c.lastMessageAt.getTime() > LECTOR_LOOKBACK_DAYS * 24 * 60 * 60_000) return false;
  return !c.leidoHasta || c.lastMessageAt > c.leidoHasta;
}

export function resolveLectorStatus(convs: readonly LectorConversationInfo[], now: Date): LectorStatus {
  if (convs.length === 0) return null;
  if (convs.some((c) => c.reading)) return { kind: "leyendo" };
  const pending = convs.filter((c) => isPending(c, now));
  if (pending.length) return { kind: "espera", etaSeconds: Math.min(...pending.map((c) => etaSeconds(c, now))) };
  const reads = convs.flatMap((c) => (c.lastRead ? [c.lastRead] : []));
  if (reads.length === 0) return null;
  const last = reads.reduce((a, b) => (b.at > a.at ? b : a));
  return last.ok ? { kind: "al_dia", at: last.at.toISOString() } : { kind: "error", at: last.at.toISOString() };
}

