// Ganchos del runtime del agente para la ingesta de WhatsApp. Se conectan AL
// FINAL (cambio mínimo en lib/messaging/ingest.ts, cuando el dueño avise). Nunca
// lanzan: un fallo del agente no debe tumbar la ingesta de un mensaje.
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
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
import { setAgentState } from "./state";

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
    if (!snap || snap.channel.aiAgentMode === "off") return;
    const cfg = await loadAgentConfig(snap.conversation.organizationId);
    if (!cfg.pauseOnHumanReply) return;
    if (snap.conversation.agentState === "activo") {
      await setAgentState(input.conversationId, "pausado_humano", { now: ports.now ?? new Date() });
    }
    await cancelAgentRun(ports.queue ?? bullAgentQueuePort(), input.conversationId);
  } catch (error) {
    console.error(`[agente] no se pudo pausar ${input.conversationId} tras respuesta humana`, error);
  }
}
