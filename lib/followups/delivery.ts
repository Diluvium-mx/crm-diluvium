// WhatsApp rechazó DESPUÉS un mensaje (aviso de estado "failed"; docs/seguimientos.md §9):
//   - si era un seguimiento, el error queda anotado en su intento (se ve en la burbuja 🤖); nunca se
//     reintenta solo (131049 = tope de promociones de Meta por persona);
//   - 131050 = el cliente se dio de baja de las promociones: el contacto queda «sin seguimientos» y se
//     cancela lo pendiente (venga del seguimiento o de una plantilla que mandó un vendedor).
// Nunca lanza: lo llama la ingesta de estados después de guardar.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, followUps } from "@/lib/db/schema";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import { patchAttempt } from "./store";
import { logError } from "@/lib/log/safe-error";

export const MARKETING_OPT_OUT = "131050";

type Failed = { organizationId: string; conversationId: string; errorCode: string | null; errorMessage: string | null; metadata?: Record<string, unknown> | null };

function followUpMark(metadata: Failed["metadata"]): { followUpId: string; intento: number } | null {
  const m = metadata?.seguimiento as { followUpId?: unknown; intento?: unknown } | undefined;
  return m && typeof m.followUpId === "string" && typeof m.intento === "number" ? { followUpId: m.followUpId, intento: m.intento } : null;
}

export async function onFollowUpDeliveryFailed(failed: Failed): Promise<void> {
  try {
    const mark = followUpMark(failed.metadata);
    if (mark) await patchAttempt(mark.followUpId, failed.organizationId, mark.intento, { error: plainSendReason(failed.errorCode, failed.errorMessage) });
    if (failed.errorCode !== MARKETING_OPT_OUT) return;
    const [conv] = await db
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(and(eq(conversations.id, failed.conversationId), eq(conversations.organizationId, failed.organizationId)))
      .limit(1);
    if (!conv) return;
    await db.transaction(async (tx) => {
      await tx.update(contacts).set({ sinSeguimientos: true }).where(and(eq(contacts.id, conv.contactId), eq(contacts.organizationId, failed.organizationId)));
      const closed = await tx
        .update(followUps)
        .set({ status: "cancelado", cancelReason: "sin_seguimientos", closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(followUps.organizationId, failed.organizationId), eq(followUps.contactId, conv.contactId), inArray(followUps.status, ["programado", "esperando"])))
        .returning({ conversationId: followUps.conversationId });
      for (const c of closed) {
        await tx.execute(sql`select pg_notify('inbox_events', json_build_object(
          'org', ${failed.organizationId}::text, 'type', 'followup.updated',
          'conversationId', ${c.conversationId}::text, 'contactId', ${conv.contactId}::text
        )::text)`);
      }
    });
  } catch (error) {
    logError(`[seguimientos] no se pudo anotar el envío fallido de ${failed.conversationId}`, error);
  }
}
