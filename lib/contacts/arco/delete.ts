// Borrar UN contacto con todo lo suyo (derechos ARCO, 7-oct-2026; «Borrar contacto» del Detalle).
//
// Orden (docs/bandeja.md › Borrar y exportar un contacto):
//  1. El contacto se busca por id + organización (de otra organización = no encontrado).
//  2. Sale de la cola `agent-replies` el job de cada chat (jobId = conversationId). Es optimización:
//     si Redis no responde, la corrida no encuentra la conversación y no contesta.
//  3. En UNA transacción (avisos por mensaje apagados: un solo `contact.deleted` al final):
//     - se juntan las llaves del bucket de sus mensajes (solo propias: ./keys.ts; nunca la Biblioteca);
//     - `ai_usage` de sus chats queda con conversación y mensaje en null (el gasto de IA del
//       Dashboard no se pierde con el cascade);
//     - se borran sus comprobantes leídos por el Agente IA (FK con set null: quedarían huérfanos
//       con monto, banco y referencia) y lo crudo de `webhook_events` ligado a sus mensajes o chats
//       (por wamid, id interno de Zernio o id de la conversación en Zernio, siempre en su organización);
//     - las filas viejas del Historial que nombraban su chat (pausas) se quedan sin el nombre;
//     - se borra el contacto: el cascade se lleva chats, mensajes, entradas, comentarios,
//       seguimientos, programados, corridas de workflows, clics de anuncios, borradores y avisos;
//     - queda la fila «contacto_borrado» del Historial (quién y cuándo; solo los últimos 4 dígitos);
//     - aviso en vivo `contact.deleted` (sale al confirmar).
//  4. Ya confirmado, se borran los archivos del bucket. Lo que falle se devuelve (nunca se traga).
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage, changeHistory, comprobantes, contacts, conversations, messages } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import { logError } from "@/lib/log/safe-error";
import type { ObjectStorage } from "@/lib/storage/s3";
import { notifyContactDeleted } from "../notify-updated";
import { deleteStoredFiles } from "./delete-files";
import { hasUnstoredAttachment, messageFolderPrefix, ownKeysToDelete, ownOriginalKeys } from "./keys";

export type DeleteContactDeps = {
  /** El bucket. Si no está configurado lanza: los archivos cuentan como no borrados. */
  storage: () => ObjectStorage;
  /** Saca de la cola `agent-replies` el job de esa conversación (jobId = conversationId). */
  cancelAgentJob: (conversationId: string) => Promise<void>;
};

export type DeletedCounts = { chats: number; mensajes: number; archivos: number };

export type DeleteContactOutcome =
  | { status: "not_found" }
  /** `pendingFiles` = llaves o carpetas del bucket que no se pudieron borrar (para reintentar). */
  | { status: "deleted"; counts: DeletedCounts; pendingFiles: string[] };

/** Últimos 4 dígitos del teléfono (lo único del número que guarda el Historial). */
export function phoneTail(phoneE164: string | null): string | null {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;

export function countsLabel(c: DeletedCounts): string {
  return [plural(c.chats, "chat", "chats"), plural(c.mensajes, "mensaje", "mensajes"), plural(c.archivos, "archivo", "archivos")].join(" · ");
}

async function cancelJobs(deps: DeleteContactDeps, conversationIds: readonly string[]): Promise<void> {
  for (const id of conversationIds) {
    try {
      await deps.cancelAgentJob(id);
    } catch (error) {
      logError("[borrar contacto] no se pudo sacar de la cola del Agente IA un chat", error);
    }
  }
}

export async function deleteContactAndData(
  input: { organizationId: string; userId: string; contactId: string },
  deps: DeleteContactDeps,
): Promise<DeleteContactOutcome> {
  const { organizationId, userId, contactId } = input;
  const own = and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId));
  const ownConversations = and(eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId));

  const [exists] = await db.select({ id: contacts.id }).from(contacts).where(own).limit(1);
  if (!exists) return { status: "not_found" };
  const before = await db.select({ id: conversations.id }).from(conversations).where(ownConversations);
  await cancelJobs(deps, before.map((c) => c.id));

  const done = await db.transaction(async (tx) => {
    // Un solo aviso en vivo (contact.deleted) en vez de uno por cada mensaje y chat borrado.
    await tx.execute(sql`select set_config('crm.avisos_en_lote', 'on', true)`);
    const [contact] = await tx
      .select({ id: contacts.id, phoneE164: contacts.phoneE164, instagramId: contacts.instagramId })
      .from(contacts)
      .where(own)
      .for("update");
    if (!contact) return null;

    const convIds = (await tx.select({ id: conversations.id }).from(conversations).where(ownConversations)).map((c) => c.id);
    const rows = convIds.length
      ? await tx
          .select({ id: messages.id, type: messages.type, attachments: messages.attachments })
          .from(messages)
          .where(and(eq(messages.organizationId, organizationId), inArray(messages.conversationId, convIds)))
      : [];
    const files = new Set<string>();
    const originals = new Set<string>();
    for (const m of rows) {
      for (const key of ownKeysToDelete(organizationId, m.attachments)) files.add(key);
      for (const key of ownOriginalKeys(organizationId, m.attachments)) originals.add(key);
      if (hasUnstoredAttachment(m.attachments)) files.add(messageFolderPrefix(organizationId, m.id));
    }
    const counts: DeletedCounts = {
      chats: convIds.length,
      mensajes: rows.filter((m) => m.type !== "system_note").length,
      archivos: originals.size,
    };

    if (convIds.length) {
      // El gasto de IA se conserva (Dashboard › Gasto de IA); solo pierde a qué chat pertenecía.
      await tx
        .update(aiUsage)
        .set({ conversationId: null, messageId: null })
        .where(and(eq(aiUsage.organizationId, organizationId), inArray(aiUsage.conversationId, convIds)));
      // Lo crudo de los webhooks de sus mensajes y chats (payload con texto, teléfono y nombre).
      await tx.execute(sql`
        with ids as (
          select m.provider_message_id as id from messages m
            where m.organization_id = ${organizationId} and m.conversation_id in (select v.id from conversations v where v.organization_id = ${organizationId} and v.contact_id = ${contactId}) and m.provider_message_id is not null
          union
          select m.provider_internal_id from messages m
            where m.organization_id = ${organizationId} and m.conversation_id in (select v.id from conversations v where v.organization_id = ${organizationId} and v.contact_id = ${contactId}) and m.provider_internal_id is not null
          union
          select v.provider_conversation_id from conversations v
            where v.organization_id = ${organizationId} and v.contact_id = ${contactId} and v.provider_conversation_id is not null
        )
        delete from webhook_events w
        where w.organization_id = ${organizationId}
          and (
            w.payload #>> '{message,platformMessageId}' in (select id from ids)
            or w.payload ->> 'platformMessageId' in (select id from ids)
            or w.payload #>> '{reaction,platformMessageId}' in (select id from ids)
            or w.payload #>> '{message,id}' in (select id from ids)
            or w.payload ->> 'messageId' in (select id from ids)
            or w.payload #>> '{message,conversationId}' in (select id from ids)
            or w.payload #>> '{conversation,id}' in (select id from ids)
          )
      `);
    }
    await tx
      .delete(comprobantes)
      .where(
        and(
          eq(comprobantes.organizationId, organizationId),
          or(eq(comprobantes.contactId, contactId), convIds.length ? inArray(comprobantes.conversationId, convIds) : undefined),
        ),
      );
    // Filas viejas del Historial que nombraban su chat (pausas): se quedan sin el nombre.
    await tx
      .update(changeHistory)
      .set({ subject: null })
      .where(and(eq(changeHistory.organizationId, organizationId), inArray(changeHistory.subjectId, [contactId, ...convIds])));

    await tx.delete(contacts).where(own);

    await logChanges(tx, {
      organizationId,
      userId,
      kind: "contacto_borrado",
      action: "borrar",
      subject: phoneTail(contact.phoneE164) ?? (contact.instagramId ? "instagram" : null),
      subjectId: contactId,
      newValue: countsLabel(counts),
    });
    await notifyContactDeleted(tx, { organizationId, contactId, conversationIds: convIds });
    return { counts, files: [...files] };
  });
  if (!done) return { status: "not_found" };

  if (done.files.length === 0) return { status: "deleted", counts: done.counts, pendingFiles: [] };
  let storage: ObjectStorage;
  try {
    storage = deps.storage();
  } catch (error) {
    logError("[borrar contacto] bucket no disponible: los archivos quedaron", error);
    return { status: "deleted", counts: done.counts, pendingFiles: done.files };
  }
  const { failed } = await deleteStoredFiles(storage, done.files);
  if (failed.length > 0) console.error(`[borrar contacto] ${failed.length} archivo(s) del bucket no se pudieron borrar`);
  return { status: "deleted", counts: done.counts, pendingFiles: failed };
}
