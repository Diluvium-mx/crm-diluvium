// «Despertar» desde la píldora dormida (10-oct-2026, docs/seguimientos.md §22): corre el lector AL MOMENTO en modo
// despertar (arma el seguimiento aunque el último mensaje sea del cliente). Pase lo que pase, al terminar avisa
// «followup.updated»: la píldora del que lo pidió deja de «cargar» y juega el final (despierta o se vuelve a dormir).
import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { runLector, type LectorDeps } from "@/lib/ai/runtime/lector";
import { announce } from "@/lib/followups/view";
import { redisConnection } from "@/lib/queue/inbound";
import { DESPERTAR_QUEUE, type DespertarJob } from "@/lib/queue/despertar";
import { safeErrorMessage } from "@/lib/log/safe-error";

async function avisar({ organizationId, conversationId }: DespertarJob): Promise<void> {
  const [conv] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (conv) await announce(organizationId, conversationId, conv.contactId);
}

export function startDespertarWorker(deps: LectorDeps) {
  const worker = new Worker<DespertarJob>(
    DESPERTAR_QUEUE,
    async (job) => {
      const { organizationId, conversationId } = job.data;
      const outcome = await runLector(organizationId, conversationId, deps, { force: true, despertar: true });
      // El barrido lo está leyendo (candado): se reintenta en unos segundos (backoff de la cola).
      if (outcome.kind === "ocupado") throw new Error("lector ocupado");
      console.info(`[despertar] ${conversationId}: ${outcome.kind}`);
      await avisar(job.data);
      return outcome.kind;
    },
    { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency: 3, autorun: false },
  );
  worker.on("failed", (job, error) => {
    console.error(`[despertar] falló ${job?.data.conversationId} (intento ${job?.attemptsMade}): ${safeErrorMessage(error)}`);
    // Último intento: que la píldora no se quede «cargando».
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void avisar(job.data).catch(() => undefined);
  });
  return { worker, run: () => void worker.run(), close: () => worker.close() };
}
