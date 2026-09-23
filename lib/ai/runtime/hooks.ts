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
  withQueueTimeout,
  type AgentQueuePort,
  type KvPort,
} from "./queue";
import { debounceDelayFor } from "./schedule";
import { obsoletePendingDrafts, setAgentState } from "./state";

type Ports = { queue?: AgentQueuePort; kv?: KvPort; now?: Date };

// Tras guardar un ENTRANTE del cliente: marca last_inbound_at, deja viejo el
// borrador vigente y (re)programa el job de respuesta con el debounce
// deslizante. Con el canal apagado no escribe nada (una sola lectura).
export async function onInboundCustomerMessage(
  input: { organizationId: string; conversationId: string; receivedAt: Date },
  ports: Ports = {},
): Promise<void> {
  try {
    const snap = await loadSnapshot(input.organizationId, input.conversationId);
    if (!snap || snap.channel.aiAgentMode === "off") return;
    const now = ports.now ?? new Date();
    await db
      .update(conversations)
      // ISO con cast: en SQL crudo el driver no serializa Date.
      .set({
        lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${input.receivedAt.toISOString()}::timestamp), ${input.receivedAt.toISOString()}::timestamp)`,
      })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)));
    // El cliente escribió después del borrador: ya no responde a lo último que
    // dijo. Con el agente ACTIVO, generará otro que lo cubra (o ninguno). Con el
    // agente pausado se conserva: p. ej. una respuesta RETENIDA por la guardia de
    // salida es justo la tarjeta que el vendedor debe revisar.
    if (snap.conversation.agentState === "activo") {
      await obsoletePendingDrafts(input.organizationId, input.conversationId, now);
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
// esa conversación sin límite de tiempo y cancela el job pendiente (GHL).
export async function onHumanOutbound(
  input: { organizationId: string; conversationId: string },
  ports: Ports = {},
): Promise<void> {
  try {
    const snap = await loadSnapshot(input.organizationId, input.conversationId);
    if (!snap) return;
    // Canal apagado: nada que pausar y sin borradores (apagarlo los deja obsoletos).
    if (snap.channel.aiAgentMode === "off") return;
    const now = ports.now ?? new Date();
    // El vendedor ya respondió: un borrador vigente del agente quedó viejo.
    await obsoletePendingDrafts(input.organizationId, input.conversationId, now);
    const cfg = await loadAgentConfig(input.organizationId);
    if (!cfg.pauseOnHumanReply) return;
    if (snap.conversation.agentState === "activo") {
      await setAgentState(input.organizationId, input.conversationId, "pausado_humano", { now });
    }
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
  onInboundMessage: (m: { organizationId: string; conversationId: string; receivedAt: Date }) =>
    onInboundCustomerMessage({ organizationId: m.organizationId, conversationId: m.conversationId, receivedAt: m.receivedAt }),
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
