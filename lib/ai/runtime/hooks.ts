// Ganchos del runtime del agente para la ingesta de WhatsApp. Se conectan AL
// FINAL (cambio mínimo en lib/messaging/ingest.ts, cuando el dueño avise). Nunca
// lanzan: un fallo del agente no debe tumbar la ingesta de un mensaje.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { loadAgentConfig } from "./config";
import { loadSnapshot } from "./context";
import {
  bullAgentQueuePort,
  cancelAgentRun,
  redisKvPort,
  scheduleAgentRun,
  type AgentQueuePort,
  type KvPort,
} from "./queue";
import { debounceDelayFor } from "./schedule";
import { obsoletePendingDrafts, setAgentState } from "./state";

type Ports = { queue?: AgentQueuePort; kv?: KvPort; now?: Date };

// Tras guardar un ENTRANTE del cliente: marca last_inbound_at y (re)programa el
// job de respuesta con el debounce deslizante.
export async function onInboundCustomerMessage(
  input: { organizationId: string; conversationId: string; receivedAt: Date },
  ports: Ports = {},
): Promise<void> {
  try {
    await db
      .update(conversations)
      // ISO con cast: en SQL crudo el driver no serializa Date.
      .set({
        lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${input.receivedAt.toISOString()}::timestamp), ${input.receivedAt.toISOString()}::timestamp)`,
      })
      .where(eq(conversations.id, input.conversationId));
    const now = ports.now ?? new Date();
    const delay = await debounceDelayFor(input.conversationId, now);
    if (delay === null) return; // canal apagado o nada pendiente
    await scheduleAgentRun(
      ports.queue ?? bullAgentQueuePort(),
      ports.kv ?? redisKvPort(),
      { conversationId: input.conversationId, organizationId: input.organizationId },
      delay,
    );
  } catch (error) {
    console.error(`[agente] no se pudo programar ${input.conversationId}; lo recoge el barrido`, error);
  }
}

// Tras guardar un SALIENTE HUMANO (CRM o eco business_app): pausa al agente en
// esa conversación sin límite de tiempo y cancela el job pendiente (GHL).
export async function onHumanOutbound(input: { conversationId: string }, ports: Ports = {}): Promise<void> {
  try {
    const snap = await loadSnapshot(input.conversationId);
    if (!snap) return;
    const now = ports.now ?? new Date();
    // El vendedor ya respondió: un borrador vigente del agente quedó viejo.
    await obsoletePendingDrafts(snap.conversation.organizationId, input.conversationId, now);
    if (snap.channel.aiAgentMode === "off") return;
    const cfg = await loadAgentConfig(snap.conversation.organizationId);
    if (!cfg.pauseOnHumanReply) return;
    if (snap.conversation.agentState === "activo") {
      await setAgentState(input.conversationId, "pausado_humano", { now });
    }
    await cancelAgentRun(ports.queue ?? bullAgentQueuePort(), input.conversationId);
  } catch (error) {
    console.error(`[agente] no se pudo pausar ${input.conversationId} tras respuesta humana`, error);
  }
}

// Ganchos listos para processWebhookEvent (lib/messaging/ingest.ts): se pasan
// junto a onMediaMessage en el worker.
export const agentIngestHooks = {
  onInboundMessage: (m: { organizationId: string; conversationId: string; receivedAt: Date }) =>
    onInboundCustomerMessage({ organizationId: m.organizationId, conversationId: m.conversationId, receivedAt: m.receivedAt }),
  onHumanOutbound: (m: { conversationId: string }) => onHumanOutbound({ conversationId: m.conversationId }),
};

// "Sleep on manual message" (GHL): un envío humano desde el CRM —inmediato,
// plantilla, reintento o PROGRAMADO— pausa al agente en esa conversación. Lo
// llaman las acciones de la bandeja y el despacho de programados tras un envío
// que no falló. Nunca lanza.
export async function pauseAgentOnManualMessage(conversationId: string): Promise<void> {
  await onHumanOutbound({ conversationId });
}

// Igual, a partir del mensaje enviado (el reintento de la bandeja solo trae su id).
export async function pauseAgentOnManualMessageId(organizationId: string, messageId: string): Promise<void> {
  try {
    const [m] = await db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)))
      .limit(1);
    if (m) await onHumanOutbound({ conversationId: m.conversationId });
  } catch (error) {
    console.error(`[agente] no se pudo pausar tras el reintento ${messageId}`, error);
  }
}
