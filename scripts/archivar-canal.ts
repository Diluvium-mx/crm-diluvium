// Uso: npm run canal:archivar -- --cuenta <accountId> [--confirmar]
// Archiva un canal de WhatsApp SIN borrar su historial (docs/numero-prueba.md, paso 8):
//   (2) cuenta conversaciones, mensajes y contactos del canal;
//   (3) primero cierra el canal (ningún envío nuevo pasa) y luego cancela, sin borrar,
//       los programados y corridas que nadie reclamó; apaga el agente en el canal y
//       reporta lo que ya iba en curso (no se cancela ni se reenvía);
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

/** Trabajo pendiente del canal: sin reclamar (se cancela) y ya reclamado (se espera). */
async function pendingWork(channelId: string) {
  const [row] = await db.execute<{ scheduled: number; sending: number; queued: number; running: number }>(sql`
    select
      (select count(*)::int from scheduled_messages s join conversations cv on cv.id = s.conversation_id
        where cv.channel_id = ${channelId} and s.status = 'scheduled') as scheduled,
      (select count(*)::int from scheduled_messages s join conversations cv on cv.id = s.conversation_id
        where cv.channel_id = ${channelId} and s.status = 'sending') as sending,
      (select count(*)::int from workflow_runs r join conversations cv on cv.id = r.conversation_id
        where cv.channel_id = ${channelId} and r.status = 'queued') as queued,
      (select count(*)::int from workflow_runs r join conversations cv on cv.id = r.conversation_id
        where cv.channel_id = ${channelId} and r.status = 'running') as running`);
  return { scheduled: Number(row.scheduled), sending: Number(row.sending), queued: Number(row.queued), running: Number(row.running) };
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
  const pending = await pendingWork(channel.id);
  console.log(`Canal ${channel.id} (${channel.displayName}) — ANTES: ${JSON.stringify(before)}`);
  console.log(
    `Programados pendientes: ${pending.scheduled} (en envío: ${pending.sending}) · corridas en cola: ${pending.queued} ` +
      `(en ejecución: ${pending.running}) · agente: ${channel.aiAgentMode}`,
  );
  if (channel.archivedAt) console.log(`Ya estaba archivado desde ${channel.archivedAt.toISOString()}.`);
  if (!values.confirmar) {
    console.log("Simulación: no se cambió nada. Repite con --confirmar para archivarlo.");
    process.exit(0);
  }

  // PRIMERO se cierra el canal (con su fila bloqueada): desde el commit ningún envío
  // nuevo pasa (send.ts rechaza un canal inactivo). Después, en la MISMA transacción,
  // se cancela SOLO lo que nadie reclamó; lo que ya va "en envío"/"en ejecución" no se
  // toca (su resultado real manda) y se reporta para volver a contar en un par de minutos.
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channel.id)).for("update");
    await tx
      .update(channels)
      .set({
        isActive: false,
        isTest: true,
        archivedAt: channel.archivedAt ?? now,
        ...(channel.aiAgentMode !== "off" ? { aiAgentMode: "off" as const, aiAgentModeChangedAt: now } : {}),
      })
      .where(eq(channels.id, channel.id));
    const convIds = tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.channelId, channel.id));
    await tx
      .update(scheduledMessages)
      .set({ status: "cancelled", cancelReason: "canal_archivado", updatedAt: now })
      .where(and(inArray(scheduledMessages.conversationId, convIds), eq(scheduledMessages.status, "scheduled")));
    await tx
      .update(workflowRuns)
      .set({ status: "cancelled", errorCode: "canal_archivado", finishedAt: now })
      .where(and(inArray(workflowRuns.conversationId, convIds), eq(workflowRuns.status, "queued")));
  });

  const inFlight = await pendingWork(channel.id);
  if (inFlight.sending + inFlight.running > 0) {
    console.log(
      `Aún en curso (ya reclamados antes de archivar): ${inFlight.sending} programado(s) y ${inFlight.running} corrida(s). ` +
        "No se cancelan ni se reenvían: espera 2 minutos y repite la simulación para confirmar que terminaron.",
    );
  }
  const after = await countsOf(channel.id);
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`DESPUÉS: ${JSON.stringify(after)} → ${same ? "IGUAL que antes (nada se borró)" : "¡DISTINTO! revisar"}`);
  process.exit(same ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
