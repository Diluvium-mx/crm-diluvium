// Uso (solo desarrollo/staging):
//   npx tsx scripts/send-test-message.ts "texto" [conversationId]
// Envía un texto por el MISMO camino que usará el composer de la bandeja
// (lib/messaging/send.ts: ventana de 24 h, fila en cola, error guardado,
// enlace del eco). Sin conversationId usa la conversación más reciente de la
// organización. El autor es el owner de la organización.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, member } from "@/lib/db/schema";
import { messagingProvider } from "@/lib/messaging";
import { sendTextMessage } from "@/lib/messaging/send";

async function main() {
  const [text, conversationArg] = process.argv.slice(2);
  if (!text) throw new Error('Uso: npx tsx scripts/send-test-message.ts "texto" [conversationId]');

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(conversationArg ? eq(conversations.id, conversationArg) : undefined)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (!conversation) throw new Error("No hay conversaciones");

  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, conversation.organizationId), eq(member.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("La organización no tiene owner");

  const result = await sendTextMessage(messagingProvider(), {
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    sentByUserId: owner.userId,
    text,
  });
  console.log(
    result.status === "sent"
      ? `Enviado: mensaje ${result.messageId} en la conversación ${conversation.id}`
      : `Resultado desconocido: mensaje ${result.messageId} queda en reconciliación (barrido del worker)`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("No se pudo enviar:", error instanceof Error ? error.message : error);
  process.exit(1);
});
