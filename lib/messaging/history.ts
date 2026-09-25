// Historial del celular (coexistencia; docs/numero-prueba.md, paso 5). Al conectar un
// número de la app de WhatsApp Business, Meta copia hasta 6 meses de chats y Zernio
// los guarda marcados `coexistence_history`. Llegan por dos caminos que terminan aquí:
// el importador (scripts/importar-historial.ts, lee la API de Zernio) y, si Zernio los
// mandara también por webhook, la ingesta (ingest.ts los desvía por `event.history`).
//
// Un mensaje del historial es REGISTRO, no conversación viva:
// - NUNCA dispara agente, workflows ni palabras clave (no llama a los ganchos);
// - no suma no leídos, no abre ni alarga la ventana de 24 h, no cambia el estado de
//   la conversación, no mueve etapa ni temperatura;
// - no cuenta como primera respuesta, ni en el semáforo, ni en el Dashboard
//   (`messages.imported_at` los excluye);
// - se guarda con su fecha, dirección, tipo y adjuntos originales, sin duplicados
//   (wamid único) y con la marca "Importado del celular" (imported_at).
// Los contactos que crea nacen en Inbox, con source `historial_celular` (el Dashboard
// no los cuenta como conversaciones nuevas) y marcados Prueba si el canal es de prueba.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTxRetry } from "@/lib/db/retry";
import { channels, contacts, conversations, messages } from "@/lib/db/schema";
import { phoneLookupVariants } from "@/lib/phone";
import {
  DeadLetterIngestError,
  eventIdentity,
  markTestContact,
  resolveContact,
  type IngestHooks,
} from "./ingest";
import type { NormalizedMessageEvent, ProviderName } from "./provider";

/** source de los contactos que nacen del historial (el Dashboard los excluye). */
export const HISTORY_CONTACT_SOURCE = "historial_celular";

type ChannelRow = typeof channels.$inferSelect;

export type HistoryOutcome = "importado" | "duplicado";

export async function ingestHistoryMessage(
  provider: ProviderName,
  channel: ChannelRow,
  event: NormalizedMessageEvent,
  hooks: Pick<IngestHooks, "onMediaMessage"> = {},
): Promise<{ outcome: string; organizationId: string; result: HistoryOutcome }> {
  if (channel.provider !== provider) throw new Error(`canal ${channel.id} no es de ${provider}`);
  const orgId = channel.organizationId;
  const { phone, bsuid } = eventIdentity(event);
  const importedAt = new Date();

  const inserted = await withTxRetry(() =>
    db.transaction(async (tx) => {
      let conversation = event.providerConversationId
        ? (
            await tx
              .select()
              .from(conversations)
              .where(and(eq(conversations.channelId, channel.id), eq(conversations.providerConversationId, event.providerConversationId)))
              .limit(1)
          )[0]
        : undefined;

      if (!conversation) {
        if (!phone && !bsuid) {
          throw new DeadLetterIngestError(
            `historial sin teléfono, BSUID ni conversación conocida (conversación ${event.providerConversationId})`,
          );
        }
        const contactId = await resolveContact(tx, orgId, { phone, bsuid, name: event.contactName }, undefined, {
          source: HISTORY_CONTACT_SOURCE,
          esPrueba: channel.isTest,
        });
        [conversation] = await tx
          .insert(conversations)
          .values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            contactId,
            channelId: channel.id,
            providerConversationId: event.providerConversationId || null,
            lastMessageAt: event.sentAt,
          })
          .onConflictDoUpdate({
            target: [conversations.channelId, conversations.contactId],
            set: {
              providerConversationId: sql`coalesce(${conversations.providerConversationId}, excluded.provider_conversation_id)`,
            },
          })
          .returning();
      }
      if (channel.isTest) await markTestContact(tx, orgId, conversation.contactId);

      // Mismo orden de bloqueo que la ingesta en vivo: conversación → mensajes.
      const [locked] = await tx.select().from(conversations).where(eq(conversations.id, conversation.id)).for("update");

      const first = event.attachments[0];
      const rows = await tx
        .insert(messages)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          conversationId: locked.id,
          direction: event.direction,
          source: event.source,
          type: event.type,
          body: event.body,
          attachments: event.attachments,
          mediaUrl: first?.url ?? null,
          mediaMimeType: first?.mimeType ?? null,
          providerMessageId: event.providerMessageId,
          // La API de Zernio no da su id interno en el historial (solo el wamid).
          providerInternalId: event.providerInternalId || null,
          metadata: event.metadata ?? null,
          status: event.direction === "in" ? "received" : "sent",
          sentAt: event.sentAt,
          importedAt,
        })
        // Cualquier choque de unicidad (wamid, o id interno) = ya estaba: no se duplica.
        .onConflictDoNothing()
        .returning({ id: messages.id });
      if (rows.length === 0) return null;

      // Solo el orden de la lista (último mensaje): NADA de no leídos, ventana,
      // estado, primera respuesta ni anuncio.
      if (!locked.lastMessageAt || locked.lastMessageAt < event.sentAt) {
        await tx.update(conversations).set({ lastMessageAt: event.sentAt }).where(eq(conversations.id, locked.id));
      }
      return rows[0].id;
    }),
  );

  // Después del commit: la descarga ya puede leer la fila (si no hay cola, el
  // barrido del worker recoge los adjuntos pendientes).
  if (inserted && event.attachments.length > 0 && hooks.onMediaMessage) await hooks.onMediaMessage(inserted);
  return inserted
    ? { outcome: "historial del celular importado", organizationId: orgId, result: "importado" }
    : { outcome: "historial del celular duplicado (wamid ya guardado)", organizationId: orgId, result: "duplicado" };
}

/** Nombre de relleno que la ingesta pone cuando WhatsApp no trae nombre. */
const PLACEHOLDER_NAMES = new Set(["cliente de whatsapp", ""]);

/** ¿El nombre del contacto está "vacío" (placeholder o el propio teléfono)? */
export function isEmptyContactName(firstName: string, lastName: string | null, phoneE164: string | null): boolean {
  if (lastName && lastName.trim()) return false;
  const name = firstName.trim();
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return true;
  const digits = name.replace(/\D/g, "");
  // El teléfono como nombre (con o sin +, espacios o el 1 heredado de México).
  if (!phoneE164 || digits.length < 8 || digits.length !== name.replace(/[\s()+\-.]/g, "").length) return false;
  const phoneDigits = phoneE164.replace(/\D/g, "");
  return digits === phoneDigits || phoneLookupVariants(phoneE164).some((v) => v.replace(/\D/g, "") === digits) || phoneDigits.endsWith(digits);
}

/**
 * Agenda del celular (contactos que Zernio importó de la app): SOLO rellena el
 * nombre de contactos que YA existen y lo tienen vacío. Nunca crea contactos (se
 * crean únicamente si tienen chat en el historial) ni pisa un nombre real.
 */
export async function fillEmptyContactNames(
  organizationId: string,
  entries: ReadonlyArray<{ phoneE164: string; name: string }>,
): Promise<{ filled: number; skipped: number }> {
  let filled = 0;
  let skipped = 0;
  for (const entry of entries) {
    const name = entry.name.trim().slice(0, 200);
    if (!name || /^\+?[\d\s()\-.]+$/.test(name)) {
      skipped++;
      continue;
    }
    const matches = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, phoneE164: contacts.phoneE164 })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phoneE164, phoneLookupVariants(entry.phoneE164))));
    let touched = false;
    for (const c of matches) {
      if (!isEmptyContactName(c.firstName, c.lastName, c.phoneE164)) continue;
      // Condición repetida en el UPDATE: si alguien le puso nombre mientras tanto, no se pisa.
      const updated = await db
        .update(contacts)
        .set({ firstName: name })
        .where(and(eq(contacts.id, c.id), eq(contacts.organizationId, organizationId), eq(contacts.firstName, c.firstName)))
        .returning({ id: contacts.id });
      if (updated.length > 0) touched = true;
    }
    if (touched) filled++;
    else skipped++;
  }
  return { filled, skipped };
}
