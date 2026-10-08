// Cuentas para la sección «Datos personales» del Detalle (ARCO, 7-oct-2026): qué se llevaría
// «Borrar contacto» (chats, mensajes, archivos, seguimientos y programados pendientes) y cuánto
// pesan los archivos del cliente para «Exportar datos» (tope de 200 MB). Acotado a la organización.
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, followUps, messages, scheduledMessages } from "@/lib/db/schema";
import { clientFiles, EXPORT_MAX_FILE_BYTES, totalBytes } from "./export-files";
import { ownOriginalKeys } from "./keys";

export type ContactArcoSummary = {
  chats: number;
  mensajes: number;
  archivos: number;
  seguimientos: number;
  programados: number;
  exportar: { archivos: number; bytes: number; maxBytes: number; demasiado: boolean };
};

export async function contactArcoSummary(organizationId: string, contactId: string): Promise<ContactArcoSummary | null> {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) return null;

  const convIds = (
    await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId)))
  ).map((c) => c.id);

  const [rows, [seguimientos], [programados]] = await Promise.all([
    convIds.length
      ? db
          .select({ id: messages.id, direction: messages.direction, type: messages.type, attachments: messages.attachments, createdAt: messages.createdAt })
          .from(messages)
          .where(and(eq(messages.organizationId, organizationId), inArray(messages.conversationId, convIds)))
      : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(followUps)
      .where(
        and(
          eq(followUps.organizationId, organizationId),
          eq(followUps.contactId, contactId),
          inArray(followUps.status, ["programado", "esperando"]),
        ),
      ),
    convIds.length
      ? db
          .select({ n: count() })
          .from(scheduledMessages)
          .where(
            and(
              eq(scheduledMessages.organizationId, organizationId),
              inArray(scheduledMessages.conversationId, convIds),
              eq(scheduledMessages.status, "scheduled"),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
  ]);

  const originals = new Set<string>();
  for (const m of rows) for (const key of ownOriginalKeys(organizationId, m.attachments)) originals.add(key);
  // Para el tope solo importa el peso (la hora no): los archivos del cliente que irían en el zip.
  const files = clientFiles(organizationId, rows.map((m) => ({ id: m.id, direction: m.direction, at: m.createdAt, attachments: m.attachments })));
  const bytes = totalBytes(files);

  return {
    chats: convIds.length,
    mensajes: rows.filter((m) => m.type !== "system_note").length,
    archivos: originals.size,
    seguimientos: seguimientos?.n ?? 0,
    programados: programados?.n ?? 0,
    exportar: { archivos: files.length, bytes, maxBytes: EXPORT_MAX_FILE_BYTES, demasiado: bytes > EXPORT_MAX_FILE_BYTES },
  };
}
