// Freno ante contestadores automáticos (7-oct-2026, caso Estafeta). PURO (sin BD).
//
// El WhatsApp de Estafeta le mandó al número de Diluvium un aviso con botones (Meta lo pasa
// como «no compatible», 131051). El Agente IA saludó; el contestador de Estafeta respondió
// «Perdón, no estoy seguro de haber entendido bien…» más su menú (otra vez «no compatible»),
// y así 102 veces en 78 minutos: dos contestadores hablándose. Nada lo frenaba (decisión del
// 23-sep: sin freno anti-bucle); se detuvo solo porque fallaron los dos modelos.
//
// Regla (dueño, 7-oct-2026: «nunca un tope de respuestas; sí un freno ante estos bucles»):
// si en las últimas LOOP_ROUNDS vueltas que contestó el Agente IA el contacto SOLO mandó lo
// mismo que ya había mandado (texto idéntico de MIN_REPEAT_CHARS letras o más) o avisos que
// WhatsApp no deja ver, el Agente IA no contesta, se pausa en ese chat y deja la tarjeta.
// Medido en producción (todos los chats al 7-oct): solo el chat de Estafeta la cumple.
//
// Lo que NO cuenta como «sin nada nuevo» (una persona real hace esto): textos cortos
// repetidos («sí», «ok», «gracias»), fotos, audios o archivos, y lo que Instagram no deja ver
// (un cliente que manda varios reels seguidos). Una respuesta de un vendedor en medio, o un
// «Activar», vuelve a empezar la cuenta.
import { instagramUnviewableCard } from "@/lib/messaging/instagram-unviewable";
import { repeatKey } from "@/lib/messaging/repeat";

/** Vueltas seguidas sin nada nuevo (la pendiente incluida) que disparan el freno. */
export const LOOP_ROUNDS = 3;
/** Un texto repetido cuenta desde este largo: «sí» u «ok» repetidos son de una persona. */
export const MIN_REPEAT_CHARS = 20;

export type LoopMessage = {
  direction: "in" | "out";
  /** Saliente de un vendedor (CRM con usuario o celular): corta la cuenta. */
  human: boolean;
  body: string | null;
  /** Aviso de Meta sin contenido («[Unsupported message]», metadata.unsupported). */
  unreadable: boolean;
  /** Después del último corte («Activar», encendido del canal): solo esas vueltas cuentan. */
  afterCut: boolean;
};

type Round = { messages: LoopMessage[]; humanBefore: boolean };

/**
 * ¿Parece un contestador automático? `rows`: los mensajes recientes del chat en el orden del
 * Agente IA (viejo → nuevo), sin fallidos, notas internas ni avisos ocultos. La última vuelta
 * es la que el Agente IA está por contestar.
 */
export function looksLikeAutoResponder(rows: readonly LoopMessage[]): boolean {
  // Salientes al final (p. ej. la media de un workflow por palabra clave): no cierran la vuelta pendiente.
  let end = rows.length;
  while (end > 0 && rows[end - 1].direction === "out") end--;
  const rounds: Round[] = [];
  let humanSince = false;
  let open: Round | null = null;
  for (const row of rows.slice(0, end)) {
    if (row.direction === "out") {
      open = null;
      if (row.human) humanSince = true;
      continue;
    }
    if (!open) {
      open = { messages: [], humanBefore: humanSince };
      rounds.push(open);
      humanSince = false;
    }
    open.messages.push(row);
  }
  if (rounds.length < LOOP_ROUNDS) return false;
  const last = rounds.slice(-LOOP_ROUNDS);
  // Un vendedor contestó entre esas vueltas: ya no es el Agente IA hablando solo.
  if (last.slice(1).some((r) => r.humanBefore)) return false;
  if (!last.every((r) => r.messages.every((m) => m.afterCut))) return false;

  const seen = new Set<string>();
  const firstCounted = rounds.length - LOOP_ROUNDS;
  return rounds.every((round, i) => {
    let empty = true;
    for (const m of round.messages) {
      const key = m.body ? repeatKey(m.body) : "";
      const repeated = key.length >= MIN_REPEAT_CHARS && seen.has(key) && !instagramUnviewableCard(m.body);
      if (!m.unreadable && !repeated) empty = false;
      if (key) seen.add(key);
    }
    return i < firstCounted || empty;
  });
}

/** Tarjeta para el vendedor (aviso 🤖, amarilla en el Embudo hasta «Activar»). */
export const AUTO_RESPONDER_NOTICE =
  `Parece un contestador automático: en las últimas ${LOOP_ROUNDS} vueltas solo mandó lo mismo que antes o mensajes que WhatsApp no deja ver. ` +
  "El Agente IA se pausó en este chat; revísalo y, si es un cliente, elige «Activar» en el Detalle del contacto.";
