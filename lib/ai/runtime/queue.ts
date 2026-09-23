// Cola del Agente IA (BullMQ) con debounce deslizante (Fase B). UN solo job por
// conversación: jobId = conversation_id. Cada entrante reprograma el job
// (changeDelay) en lugar de crear otro; si el job está corriendo, se deja un
// aviso "dirty" que el consumer revisa al terminar (y se re-programa solo).
// La lógica de programación usa puertos (AgentQueuePort / KvPort) para poder
// probarla sin Redis; los adaptadores reales están abajo.
import { Queue } from "bullmq";
import Redis from "ioredis";
import { redisConnection } from "@/lib/queue/inbound";

export const AGENT_QUEUE = "agent-replies";
export type AgentJob = { conversationId: string; organizationId: string };

export interface AgentJobHandle {
  getState(): Promise<string>;
  changeDelay(delayMs: number): Promise<void>;
  remove(): Promise<void>;
}

export interface AgentQueuePort {
  getJob(jobId: string): Promise<AgentJobHandle | undefined>;
  add(data: AgentJob, opts: { jobId: string; delay: number }): Promise<void>;
}

// Llave/valor mínimo para avisos y candados (Redis en producción).
export interface KvPort {
  setNxPx(key: string, value: string, ttlMs: number): Promise<boolean>;
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
  getDel(key: string): Promise<string | null>;
  delIfEquals(key: string, value: string): Promise<void>;
}

export const dirtyKey = (conversationId: string) => `agent-dirty:${conversationId}`;
export const lockKey = (conversationId: string) => `agent-lock:${conversationId}`;
const DIRTY_TTL_SECONDS = 15 * 60;

export type ScheduleOutcome = "added" | "rescheduled" | "waiting" | "running_marked";

export async function scheduleAgentRun(
  queue: AgentQueuePort,
  kv: KvPort,
  data: AgentJob,
  delayMs: number,
): Promise<ScheduleOutcome> {
  const job = await queue.getJob(data.conversationId);
  if (job) {
    const state = await job.getState();
    if (state === "delayed") {
      try {
        await job.changeDelay(delayMs);
        return "rescheduled";
      } catch {
        // Pasó a waiting/active entre medio: se trata abajo como nuevo intento.
      }
    } else if (state === "waiting" || state === "prioritized" || state === "waiting-children") {
      return "waiting"; // correrá enseguida y leerá lo que acaba de entrar
    } else if (state === "active") {
      await kv.setEx(dirtyKey(data.conversationId), "1", DIRTY_TTL_SECONDS);
      // Si terminó entre la lectura y el aviso, el aviso quedaría huérfano:
      // se vuelve a mirar y, si ya no corre, se agrega uno nuevo.
      const again = await queue.getJob(data.conversationId);
      if (again && (await again.getState()) === "active") return "running_marked";
    } else {
      await job.remove().catch(() => undefined); // completed/failed/unknown
    }
  }
  // Un add con un jobId existente es ignorado por BullMQ (nunca duplica).
  await queue.add(data, { jobId: data.conversationId, delay: delayMs });
  return "added";
}

// Cancela el job pendiente de una conversación (p. ej. respondió un vendedor).
export async function cancelAgentRun(queue: AgentQueuePort, conversationId: string): Promise<boolean> {
  const job = await queue.getJob(conversationId);
  if (!job) return false;
  const state = await job.getState();
  if (state !== "delayed" && state !== "waiting" && state !== "prioritized") return false;
  await job.remove().catch(() => undefined);
  return true;
}

// ── Candado por conversación ────────────────────────────────────────────────
export async function acquireLock(kv: KvPort, conversationId: string, ttlMs: number): Promise<string | null> {
  const token = crypto.randomUUID();
  return (await kv.setNxPx(lockKey(conversationId), token, ttlMs)) ? token : null;
}

export async function releaseLock(kv: KvPort, conversationId: string, token: string): Promise<void> {
  await kv.delIfEquals(lockKey(conversationId), token);
}

// ── Adaptadores reales (BullMQ + ioredis) ───────────────────────────────────
const globalForAgent = globalThis as unknown as { agentQueue?: Queue<AgentJob>; agentRedis?: Redis };

export function agentQueue(): Queue<AgentJob> {
  globalForAgent.agentQueue ??= new Queue<AgentJob>(AGENT_QUEUE, {
    connection: { ...redisConnection(), maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 15_000 },
      // Se borran al terminar: un job viejo con el mismo jobId bloquearía el siguiente.
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return globalForAgent.agentQueue;
}

function agentRedis(): Redis {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set");
  globalForAgent.agentRedis ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
  return globalForAgent.agentRedis;
}

export function bullAgentQueuePort(): AgentQueuePort {
  return {
    getJob: async (jobId) => (await agentQueue().getJob(jobId)) ?? undefined,
    add: async (data, opts) => {
      await agentQueue().add("reply", data, opts);
    },
  };
}

const RELEASE_IF_EQUALS = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function redisKvPort(): KvPort {
  return {
    setNxPx: async (key, value, ttlMs) => (await agentRedis().set(key, value, "PX", ttlMs, "NX")) === "OK",
    setEx: async (key, value, ttlSeconds) => {
      await agentRedis().set(key, value, "EX", ttlSeconds);
    },
    getDel: async (key) => agentRedis().getdel(key),
    delIfEquals: async (key, value) => {
      await agentRedis().eval(RELEASE_IF_EQUALS, 1, key, value);
    },
  };
}

export async function closeAgentConnections(): Promise<void> {
  await globalForAgent.agentQueue?.close();
  globalForAgent.agentRedis?.disconnect();
}
