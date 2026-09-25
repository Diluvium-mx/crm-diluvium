// Ganchos del runtime del agente para la ingesta de WhatsApp. Se conectan AL
// FINAL (cambio mínimo en lib/messaging/ingest.ts, cuando el dueño avise). Nunca
// lanzan: un fallo del agente no debe tumbar la ingesta de un mensaje.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { loadSnapshot } from "./context";
import {
  bullAgentQueuePort,
  cancelAgentRun,
  redisKvPort,
  scheduleAgentRun,
  withQueueTimeout,
  type AgentQueuePort,
  type KvPort,
} from "./queue";
import { isPauseDue, pauseForHumanReply, reactivateDuePause } from "./pause";
import { debounceDelayFor } from "./schedule";

type Ports = { queue?: AgentQueuePort; kv?: KvPort; now?: Date };

// Hora en que el cliente ESCRIBIÓ el mensaje: la de WhatsApp (sent_at); si no
// viene, la de llegada. Un webhook retrasado llega después, pero se escribió antes.
async function writtenAt(organizationId: string, conversationId: string, messageId: string): Promise<Date | null> {
  const [m] = await db
    .select({ sentAt: messages.sentAt, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId)))
    .limit(1);
  return m ? (m.sentAt ?? m.createdAt) : null;
}

// Tras guardar un ENTRANTE del cliente: marca last_inbound_at y (re)programa el
// job de respuesta con el debounce deslizante. Con el canal apagado no escribe
// nada (una sola lectura).
export async function onInboundCustomerMessage(
  input: { organizationId: string; conversationId: string; receivedAt: Date; messageId?: string },
  ports: Ports = {},
): Promise<void> {
  try {
    const snap = await loadSnapshot(input.organizationId, input.conversationId);
    if (!snap || snap.channel.aiAgentMode !== "auto") return;
    const now = ports.now ?? new Date();
    const conv = snap.conversation;
    const wrote = input.messageId ? await writtenAt(input.organizationId, input.conversationId, input.messageId) : null;
    await db
      .update(conversations)
      // ISO con cast: en SQL crudo el driver no serializa Date.
      .set({
        lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${input.receivedAt.toISOString()}::timestamp), ${input.receivedAt.toISOString()}::timestamp)`,
      })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)));
    // "Apagar bot" — solo mensajes nuevos: lo que el cliente ESCRIBIÓ con el bot
    // apagado no se contesta aunque llegue tarde (webhook retrasado).
    if (isPauseDue(conv, now)) {
      // Hora de regreso cumplida y el barrido (cada minuto) aún sin pasar: si el
      // mensaje se escribió después de esa hora, el bot ya volvió y es el primero nuevo.
      if (wrote && conv.agentPausedUntil && wrote.getTime() <= conv.agentPausedUntil.getTime()) return;
      await reactivateDuePause(input.organizationId, input.conversationId, now);
    } else if (wrote && conv.agentState === "activo" && conv.agentStateChangedAt && wrote.getTime() <= conv.agentStateChangedAt.getTime()) {
      return; // escrito antes de que el bot volviera (solo o con "Reactivar") y llegó tarde
    }
    const delay = await debounceDelayFor(input.organizationId, input.conversationId, now);
    if (delay === null) return; // canal apagado o nada pendiente
    await withQueueTimeout(
      scheduleAgentRun(
        ports.queue ?? bullAgentQueuePort(),
        ports.kv ?? redisKvPort(),
        { conversationId: input.conversationId, organizationId: input.organizationId },
        delay,
      ),
      "programar",
    );
  } catch (error) {
    console.error(`[agente] no se pudo programar ${input.conversationId}; lo recoge el barrido`, error);
  }
}

// Tras guardar un SALIENTE HUMANO (CRM o eco business_app): pausa al agente en
// esa conversación sin límite de tiempo y cancela el job pendiente (GHL). Si el bot
// ya estaba apagado con hora de regreso ("Apagar bot"), la hora se respeta: el
// vendedor puede escribir sin cambiarla.
export async function onHumanOutbound(
  input: { organizationId: string; conversationId: string },
  ports: Ports = {},
): Promise<void> {
  try {
    const snap = await loadSnapshot(input.organizationId, input.conversationId);
    if (!snap) return;
    // Canal apagado: nada que pausar.
    if (snap.channel.aiAgentMode !== "auto") return;
    const now = ports.now ?? new Date();
    // Pausa sin tiempo (se reactiva a mano con "Reactivar"), solo si el bot estaba
    // encendido o su hora de regreso ya se cumplió; condicional en la BD.
    await pauseForHumanReply(input.organizationId, input.conversationId, now);
    // La pausa ya quedó guardada: cancelar el job es solo optimización (acotada).
    await withQueueTimeout(cancelAgentRun(ports.queue ?? bullAgentQueuePort(), input.conversationId), "cancelar").catch(
      (error) => console.error(`[agente] no se pudo cancelar el job de ${input.conversationId}: ${String(error)}`),
    );
  } catch (error) {
    console.error(`[agente] no se pudo pausar ${input.conversationId} tras respuesta humana`, error);
  }
}

// Ganchos listos para processWebhookEvent (lib/messaging/ingest.ts): se pasan
// junto a onMediaMessage en el worker.
export const agentIngestHooks = {
  onInboundMessage: (m: { organizationId: string; conversationId: string; receivedAt: Date; messageId?: string }) =>
    onInboundCustomerMessage({
      organizationId: m.organizationId,
      conversationId: m.conversationId,
      receivedAt: m.receivedAt,
      messageId: m.messageId,
    }),
  onHumanOutbound: (m: { organizationId: string; conversationId: string }) =>
    onHumanOutbound({ organizationId: m.organizationId, conversationId: m.conversationId }),
};

// "Sleep on manual message" (GHL): un envío humano desde el CRM —inmediato,
// plantilla, reintento o PROGRAMADO— pausa al agente en esa conversación. Lo
// llaman las acciones de la bandeja y el despacho de programados tras un envío
// que no falló. Nunca lanza.
export async function pauseAgentForManualSend(organizationId: string, conversationId: string): Promise<void> {
  // onHumanOutbound ya atrapa todo; este catch es la última red del envío del vendedor.
  try {
    await onHumanOutbound({ organizationId, conversationId });
  } catch (error) {
    console.error(`[agente] no se pudo pausar ${conversationId} tras envío manual`, error);
  }
}

// Igual, a partir del mensaje enviado (el reintento de la bandeja solo trae su id).
export async function pauseAgentOnManualMessageId(organizationId: string, messageId: string): Promise<void> {
  try {
    const [m] = await db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)))
      .limit(1);
    if (m) await onHumanOutbound({ organizationId, conversationId: m.conversationId });
  } catch (error) {
    console.error(`[agente] no se pudo pausar tras el reintento ${messageId}`, error);
  }
}
