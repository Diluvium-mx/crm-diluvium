// Uso: npm run canal:archivar -- --cuenta <accountId> [--confirmar]
// Archiva un canal de WhatsApp SIN borrar su historial (docs/numero-prueba.md, paso 8):
//   (2) cuenta conversaciones, mensajes y contactos del canal;
//   (3) cancela (sin borrar) sus mensajes programados pendientes y sus corridas de
//       workflow en cola, y apaga el agente en el canal;
//   (4) lo deja inactivo y archivado: historial visible, marcado Prueba, composer
//       bloqueado con "Canal archivado", y sus webhooks se registran sin procesar;
//   (6) vuelve a contar y confirma que nada se perdió.
// El respaldo (1) y quitar la cuenta de ZERNIO_ALLOWED_ACCOUNT_IDS (5) van aparte (guion).
// Sin --confirmar solo cuenta y muestra lo que haría.
import { parseArgs } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, conversations, scheduledMessages, workflowRuns } from "@/lib/db/schema";

type Counts = { conversaciones: number; mensajes: number; contactos: number };

async function countsOf(channelId: string): Promise<Counts> {
  const [row] = await db.execute<{ conversaciones: number; mensajes: number; contactos: number }>(sql`
    select
      (select count(*)::int from conversations where channel_id = ${channelId}) as conversaciones,
      (select count(*)::int from messages m join conversations cv on cv.id = m.conversation_id where cv.channel_id = ${channelId}) as mensajes,
      (select count(distinct contact_id)::int from conversations where channel_id = ${channelId}) as contactos`);
  return { conversaciones: Number(row.conversaciones), mensajes: Number(row.mensajes), contactos: Number(row.contactos) };
}

async function main() {
  const { values } = parseArgs({ options: { cuenta: { type: "string" }, confirmar: { type: "boolean", default: false } } });
  const accountId = values.cuenta?.trim();
  if (!accountId) throw new Error("--cuenta <accountId de Zernio> es obligatorio");
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);
  if (!channel) throw new Error(`No hay canal para la cuenta ${accountId}`);

  const before = await countsOf(channel.id);
  const convIds = (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.channelId, channel.id))).map((c) => c.id);
  const pendingScheduled = convIds.length
    ? await db
        .select({ id: scheduledMessages.id })
        .from(scheduledMessages)
        .where(and(inArray(scheduledMessages.conversationId, convIds), inArray(scheduledMessages.status, ["scheduled", "sending"])))
    : [];
  const pendingRuns = convIds.length
    ? await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(and(inArray(workflowRuns.conversationId, convIds), inArray(workflowRuns.status, ["queued", "running"])))
    : [];
  console.log(`Canal ${channel.id} (${channel.displayName}) — ANTES: ${JSON.stringify(before)}`);
  console.log(`Programados pendientes: ${pendingScheduled.length} · corridas en cola: ${pendingRuns.length} · agente: ${channel.aiAgentMode}`);
  if (channel.archivedAt) console.log(`Ya estaba archivado desde ${channel.archivedAt.toISOString()}.`);
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para archivarlo.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    if (pendingScheduled.length) {
      await tx
        .update(scheduledMessages)
        .set({ status: "cancelled", cancelReason: "canal_archivado", updatedAt: now })
        .where(and(inArray(scheduledMessages.id, pendingScheduled.map((r) => r.id)), inArray(scheduledMessages.status, ["scheduled", "sending"])));
    }
    if (pendingRuns.length) {
      await tx
        .update(workflowRuns)
        .set({ status: "cancelled", errorCode: "canal_archivado", finishedAt: now })
        .where(and(inArray(workflowRuns.id, pendingRuns.map((r) => r.id)), inArray(workflowRuns.status, ["queued", "running"])));
    }
    await tx
      .update(channels)
      .set({
        isActive: false,
        isTest: true,
        archivedAt: channel.archivedAt ?? now,
        ...(channel.aiAgentMode !== "off" ? { aiAgentMode: "off" as const, aiAgentModeChangedAt: now } : {}),
      })
      .where(eq(channels.id, channel.id));
  });

  const after = await countsOf(channel.id);
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`DESPUÉS: ${JSON.stringify(after)} → ${same ? "IGUAL que antes (nada se borró)" : "¡DISTINTO! revisar"}`);
  process.exit(same ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
