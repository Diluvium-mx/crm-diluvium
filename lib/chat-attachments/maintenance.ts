// Tareas del worker para los adjuntos del chat (28-sep-2026):
// - burbujas "pendiente" que no se pudieron encolar (Redis no respondió) → se
//   re-encolan en orden, agrupadas por conversación;
// - archivos subidos y NUNCA enviados → se borran del bucket a las 24 h. Un
//   archivo que alguna burbuja usa (enviada, fallida o en cola) nunca se borra.
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, organization } from "@/lib/db/schema";
import { CHAT_UPLOAD_META } from "@/lib/messaging/send";
import type { ChatUploadJob } from "@/lib/queue/chat-uploads";
import type { ObjectStorage } from "@/lib/storage/s3";
import { chatUploadDayPrefix } from "./keys";

/** Una burbuja recién creada la toma su job; el barrido solo mira las de más de esto. */
export const PENDING_GRACE_MS = 10_000;
export const CHAT_UPLOAD_TTL_MS = 24 * 3_600_000;
/** Días (UTC) hacia atrás que revisa la limpieza (el de hoy aún no tiene nada de 24 h). */
export const CLEANUP_LOOKBACK_DAYS = 4;

/** Burbujas "pendiente" viejas, agrupadas por conversación y en su orden. */
export async function pendingChatUploadJobs(now = new Date()): Promise<ChatUploadJob[]> {
  const rows = await db
    .select({ id: messages.id, organizationId: messages.organizationId, conversationId: messages.conversationId })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "out"),
        eq(messages.status, "queued"),
        sql`${messages.metadata}->${CHAT_UPLOAD_META}->>'estado' = 'pendiente'`,
        lt(messages.createdAt, new Date(now.getTime() - PENDING_GRACE_MS)),
        gt(messages.createdAt, new Date(now.getTime() - CHAT_UPLOAD_TTL_MS)),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(200);
  const jobs = new Map<string, ChatUploadJob>();
  for (const r of rows) {
    const job = jobs.get(r.conversationId) ?? { organizationId: r.organizationId, conversationId: r.conversationId, messageIds: [] };
    job.messageIds.push(r.id);
    jobs.set(r.conversationId, job);
  }
  return [...jobs.values()];
}

// Llaves (de esta lista) que alguna burbuja de la organización usa.
async function referencedKeys(organizationId: string, keys: readonly string[], since: Date): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const rows = await db.execute<{ k: string }>(sql`
      select distinct a->>'storageKey' as k
      from ${messages} m cross join lateral jsonb_array_elements(m.attachments) a
      where m.organization_id = ${organizationId} and m.created_at >= ${since.toISOString()}::timestamp
        and a->>'storageKey' in (${sql.join(
          chunk.map((k) => sql`${k}`),
          sql`, `,
        )})`);
    for (const r of rows) out.add(r.k);
  }
  return out;
}

/** Borra los adjuntos del chat de más de 24 h que ninguna burbuja usa. Devuelve cuántos borró. */
export async function cleanupUnsentChatUploads(storage: ObjectStorage, now = new Date()): Promise<number> {
  if (!storage.listObjects) return 0;
  const orgs = await db.select({ id: organization.id }).from(organization);
  let deleted = 0;
  for (const org of orgs) {
    const old: { key: string; lastModified: Date }[] = [];
    for (let d = 1; d <= CLEANUP_LOOKBACK_DAYS; d++) {
      const prefix = chatUploadDayPrefix(org.id, new Date(now.getTime() - d * 86_400_000));
      for await (const o of storage.listObjects(prefix)) {
        if (now.getTime() - o.lastModified.getTime() > CHAT_UPLOAD_TTL_MS) old.push(o);
      }
    }
    if (old.length === 0) continue;
    // Una burbuja nace a lo más 6 h después de su subida (CHAT_UPLOAD_MAX_AGE_MS): se busca desde la más vieja.
    const since = new Date(Math.min(...old.map((o) => o.lastModified.getTime())) - 60_000);
    const used = await referencedKeys(org.id, old.map((o) => o.key), since);
    for (const o of old) {
      if (used.has(o.key)) continue;
      await storage.deleteObject(o.key);
      deleted++;
    }
  }
  return deleted;
}
