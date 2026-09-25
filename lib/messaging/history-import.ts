// Corrida del importador del historial del celular (docs/numero-prueba.md, paso 5):
// recorre las conversaciones de la cuenta en Zernio, importa SOLO los mensajes del
// historial (coexistence_history) y después rellena nombres vacíos con la agenda.
// Idempotente (wamid único): se puede repetir hasta que Zernio termine de copiar.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { DeadLetterIngestError } from "./ingest";
import { fillEmptyContactNames, ingestHistoryMessage } from "./history";
import { historyEventFromRest, type ZernioHistoryClient } from "./zernio-history";

export type HistoryImportReport = {
  conversaciones: number;
  importados: number;
  duplicados: number;
  noHistorial: number;
  omitidos: { motivo: string; total: number }[];
  errores: string[];
  nombresRellenados: number;
  /** Primeros mensajes vistos (fecha, dirección, tipo) para cotejar con el celular. */
  muestra: { conversacion: string; fecha: string; direccion: "in" | "out"; tipo: string }[];
};

export async function importPhoneHistory(
  client: ZernioHistoryClient,
  accountId: string,
  opts: { dryRun?: boolean; withContacts?: boolean; log?: (line: string) => void } = {},
): Promise<HistoryImportReport> {
  const log = opts.log ?? (() => {});
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);
  if (!channel) throw new Error(`No hay canal para la cuenta ${accountId}: dalo de alta primero (npm run canal:prueba)`);
  if (!channel.isActive || channel.archivedAt) throw new Error(`El canal ${channel.id} está inactivo o archivado: no se importa`);

  const report: HistoryImportReport = {
    conversaciones: 0,
    importados: 0,
    duplicados: 0,
    noHistorial: 0,
    omitidos: [],
    errores: [],
    nombresRellenados: 0,
    muestra: [],
  };
  const skipped = new Map<string, number>();

  for await (const conversation of client.conversations(accountId)) {
    report.conversaciones++;
    let inConversation = 0;
    for await (const raw of client.messages(accountId, conversation.id)) {
      const parsed = historyEventFromRest(accountId, conversation, raw);
      if ("skip" in parsed) {
        if (parsed.skip === "no es historial") report.noHistorial++;
        else skipped.set(parsed.skip, (skipped.get(parsed.skip) ?? 0) + 1);
        continue;
      }
      const { event } = parsed;
      if (report.muestra.length < 20) {
        report.muestra.push({ conversacion: conversation.id, fecha: event.sentAt.toISOString(), direccion: event.direction, tipo: event.type });
      }
      if (opts.dryRun) {
        report.importados++;
        inConversation++;
        continue;
      }
      try {
        const r = await ingestHistoryMessage("zernio", channel, event);
        if (r.result === "importado") {
          report.importados++;
          inConversation++;
        } else report.duplicados++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (report.errores.length < 50) report.errores.push(`${conversation.id}/${event.providerMessageId}: ${message}`);
        if (!(error instanceof DeadLetterIngestError)) throw error; // error de base: se detiene
      }
    }
    if (inConversation > 0) log(`conversación ${conversation.id}: ${inConversation} mensaje(s) del historial${opts.dryRun ? " (simulado)" : ""}`);
  }

  if (opts.withContacts !== false) {
    const entries: { phoneE164: string; name: string }[] = [];
    for await (const entry of client.contacts(accountId)) entries.push(entry);
    if (opts.dryRun) log(`agenda: ${entries.length} contacto(s) con nombre (simulado, no se rellena nada)`);
    else {
      const { filled } = await fillEmptyContactNames(channel.organizationId, entries);
      report.nombresRellenados = filled;
      log(`agenda: ${entries.length} contacto(s) leídos, ${filled} nombre(s) vacío(s) rellenado(s)`);
    }
  }

  report.omitidos = [...skipped.entries()].map(([motivo, total]) => ({ motivo, total }));
  return report;
}
