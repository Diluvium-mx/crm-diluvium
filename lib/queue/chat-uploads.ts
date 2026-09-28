// Cola de adjuntos del chat (28-sep-2026): un job por envío del vendedor con
// los ids de sus burbujas EN ORDEN; el worker las manda una por una. La base es
// la fuente de verdad: si Redis no responde, las burbujas quedan "pendiente" y
// el barrido del worker las recoge (mismo patrón que workflows).
import { Queue } from "bullmq";
import { redisConnection } from "./inbound";

export const CHAT_UPLOAD_QUEUE = "chat-uploads";

export type ChatUploadJob = { organizationId: string; conversationId: string; messageIds: string[] };

const globalForQueue = globalThis as unknown as { chatUploadQueue?: Queue<ChatUploadJob> };

function chatUploadQueue(): Queue<ChatUploadJob> {
  globalForQueue.chatUploadQueue ??= new Queue<ChatUploadJob>(CHAT_UPLOAD_QUEUE, {
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    defaultJobOptions: {
      // Cada burbuja se reclama una sola vez (pendiente → enviando): un
      // reintento de BullMQ salta las que ya salieron o se intentaron.
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 3600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return globalForQueue.chatUploadQueue;
}

export function chatUploadJobId(messageIds: readonly string[]): string {
  return `adj_${messageIds[0]}`;
}

const ENQUEUE_TIMEOUT_MS = 1_500;
const ENQUEUE_ATTEMPTS = 2;

/** Encola el envío. Nunca lanza: false = lo recoge el barrido del worker. */
export async function enqueueChatUploads(job: ChatUploadJob): Promise<boolean> {
  for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        chatUploadQueue().add("send", job, { jobId: chatUploadJobId(job.messageIds) }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout de Redis")), ENQUEUE_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch (error) {
      if (attempt === ENQUEUE_ATTEMPTS) console.error("[adjuntos] no se pudo encolar; lo recoge el barrido", job.messageIds[0], error);
      else await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

/** Barrido: burbujas "pendiente" sin job vivo → se re-encolan (o se reintenta el job fallido). */
export async function reviveChatUploads(job: ChatUploadJob): Promise<"added" | "retried" | "in_flight" | "error"> {
  try {
    const existing = await chatUploadQueue().getJob(chatUploadJobId(job.messageIds));
    if (!existing) return (await enqueueChatUploads(job)) ? "added" : "error";
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry("failed");
      return "retried";
    }
    if (state === "completed" || state === "unknown") {
      await existing.remove();
      return (await enqueueChatUploads(job)) ? "added" : "error";
    }
    return "in_flight";
  } catch (error) {
    console.error("[adjuntos] barrido no pudo revisar el job", job.messageIds[0], error);
    return "error";
  }
}
