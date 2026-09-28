// Adjuntos del chat en el worker (28-sep-2026): manda los archivos de cada
// envío del vendedor UNO POR UNO y en orden (concurrencia 1: dos envíos nunca
// se intercalan). Un archivo que WhatsApp rechaza queda con su error en la
// burbuja y los siguientes siguen saliendo. En el barrido: re-encola lo que no
// se pudo encolar y, cada hora, borra del bucket lo subido y nunca enviado (24 h).
import { Worker } from "bullmq";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { SendFailedError } from "@/lib/messaging/provider";
import { SendRejectedError, sendQueuedChatUpload } from "@/lib/messaging/send";
import { cleanupUnsentChatUploads, pendingChatUploadJobs } from "@/lib/chat-attachments/maintenance";
import { redisConnection } from "@/lib/queue/inbound";
import { CHAT_UPLOAD_QUEUE, reviveChatUploads, type ChatUploadJob } from "@/lib/queue/chat-uploads";
import type { ObjectStorage } from "@/lib/storage/s3";

const CLEANUP_EVERY_MS = 60 * 60_000;

export function startChatUploadWorker(provider: MessagingProvider, storage: ObjectStorage) {
  const worker = new Worker<ChatUploadJob>(
    CHAT_UPLOAD_QUEUE,
    async (job) => {
      let sent = 0;
      let rejected = 0;
      for (const messageId of job.data.messageIds) {
        try {
          if (await sendQueuedChatUpload(provider, storage, { organizationId: job.data.organizationId, messageId })) sent++;
        } catch (error) {
          // Rechazo del proveedor: ya quedó "failed" con su motivo en la burbuja; sigue el siguiente.
          if (error instanceof SendFailedError || error instanceof SendRejectedError) {
            rejected++;
            continue;
          }
          throw error; // infraestructura: BullMQ reintenta; lo ya reclamado no se repite
        }
      }
      console.info(`[adjuntos] ${job.data.messageIds[0]}: ${sent} enviado(s), ${rejected} rechazado(s) de ${job.data.messageIds.length}`);
    },
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 1, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[adjuntos] falló ${job?.data.messageIds[0]} (intento ${job?.attemptsMade}): ${error.message}`);
  });

  let lastCleanup = 0;
  async function sweep() {
    let revived = 0;
    for (const job of await pendingChatUploadJobs()) {
      const r = await reviveChatUploads(job);
      if (r === "added" || r === "retried") revived++;
    }
    if (revived) console.info(`[adjuntos] barrido: ${revived} envío(s) re-encolados`);
    if (Date.now() - lastCleanup < CLEANUP_EVERY_MS) return;
    lastCleanup = Date.now();
    const deleted = await cleanupUnsentChatUploads(storage);
    if (deleted) console.info(`[adjuntos] limpieza: ${deleted} archivo(s) subidos y no enviados borrados (>24 h)`);
  }

  return { worker, sweep, run: () => void worker.run(), close: () => worker.close() };
}
