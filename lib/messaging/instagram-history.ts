// Historial de Instagram (2-oct-2026, docs/instagram.md): al conectar la cuenta, Zernio
// copia los últimos 500 chats (hasta 500 mensajes c/u) SIN mandar webhooks. Aquí se leen
// (solo GET, con el cliente del historial de WhatsApp: ritmo, reintentos y paginación sin
// huecos) y se guardan como HISTORIAL (lib/messaging/history.ts): sin Agente IA, workflows
// ni no leídos; con su fecha, dirección y adjuntos, y la marca de importado.
// - Un cliente = un contacto por su id de Instagram; si ya escribió en vivo, el chat se
//   pega a su conversación y lo repetido (mismo `mid`) no se duplica.
// - La ventana de 24 h sí se calcula con su último mensaje (ver HistoryChat).
// - Reanudable: el punto de reanudación guarda solo ids de chats ya terminados.
// - --simular: SOLO lectura de Zernio y de la base; arma el reporte y no escribe nada.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, messages } from "@/lib/db/schema";
import { BULK_SIGNAL_MESSAGES, BULK_SIGNAL_MS, BulkSignal } from "./history-import";
import { ingestHistoryPage, type HistoryChat } from "./history";
import type { HistoryImportState, HistoryStateStore } from "./history-state";
import type { NormalizedMessageEvent } from "./provider";
import { instagramHistoryEventFromRest, type RestConversation, type ZernioHistoryClient, type ZernioHistoryStats } from "./zernio-history";

export type InstagramHistoryReport = {
  modo: "simulacion" | "importacion";
  cuenta: string;
  canal: string;
  /** Chats de Instagram de la cuenta en Zernio. */
  conversaciones: number;
  procesadas: number;
  /** Saltados por estar terminados en una corrida anterior que se cortó. */
  reanudadas: number;
  mensajes: number;
  /** Nuevos (en simulación: los que entrarían, sin contar los que ya están en el CRM). */
  importados: number;
  /** Ya estaban en el CRM (mismo id de Meta: entraron en vivo). */
  duplicados: number;
  omitidos: { motivo: string; total: number }[];
  contactos: { nuevos: number; existentes: number };
  /** Chats de Zernio sin id de cliente: no se importan. */
  sinCliente: number;
  rango: { desde: string | null; hasta: string | null };
  adjuntos: { recientes: number; viejos: number };
  avisosEnLote: number;
  cortado: boolean;
  terminado: boolean;
  errores: string[];
  peticiones: ZernioHistoryStats;
  duracionMs: number;
};

export type InstagramHistoryOptions = {
  dryRun?: boolean;
  log?: (line: string) => void;
  state?: HistoryStateStore;
  fromScratch?: boolean;
  signal?: AbortSignal;
  now?: () => number;
};

function emitBulk(organizationId: string) {
  return async (mensajes: number, contactos: number) => {
    const payload = JSON.stringify({ org: organizationId, type: "inbox.bulk", mensajes, contactos });
    await db.execute(sql`select pg_notify('inbox_events', ${payload})`);
  };
}

/** Ids de Meta (mid) que ya están en el CRM, de una página (para la simulación). */
async function existingMids(organizationId: string, mids: string[]): Promise<Set<string>> {
  if (mids.length === 0) return new Set();
  const rows = await db
    .select({ id: messages.providerMessageId })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), inArray(messages.providerMessageId, mids)));
  return new Set(rows.map((r) => r.id).filter((id): id is string => !!id));
}

export async function importInstagramHistory(
  client: ZernioHistoryClient,
  accountId: string,
  opts: InstagramHistoryOptions = {},
): Promise<InstagramHistoryReport> {
  const now = opts.now ?? Date.now;
  const started = now();
  const log = opts.log ?? (() => undefined);
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId), eq(channels.type, "instagram")))
    .limit(1);
  if (!channel || !channel.isActive || channel.archivedAt) {
    throw new Error(`No hay canal de Instagram activo para la cuenta ${accountId} (npm run canal:instagram)`);
  }

  const report: InstagramHistoryReport = {
    modo: opts.dryRun ? "simulacion" : "importacion",
    cuenta: accountId,
    canal: channel.id,
    conversaciones: 0,
    procesadas: 0,
    reanudadas: 0,
    mensajes: 0,
    importados: 0,
    duplicados: 0,
    omitidos: [],
    contactos: { nuevos: 0, existentes: 0 },
    sinCliente: 0,
    rango: { desde: null, hasta: null },
    adjuntos: { recientes: 0, viejos: 0 },
    avisosEnLote: 0,
    cortado: false,
    terminado: false,
    errores: [],
    peticiones: client.stats,
    duracionMs: 0,
  };
  const skipped = new Map<string, number>();
  const skip = (motivo: string) => skipped.set(motivo, (skipped.get(motivo) ?? 0) + 1);
  const track = (at: Date) => {
    const iso = at.toISOString();
    if (!report.rango.desde || iso < report.rango.desde) report.rango.desde = iso;
    if (!report.rango.hasta || iso > report.rango.hasta) report.rango.hasta = iso;
  };

  log("leyendo la lista de chats de Instagram en Zernio…");
  const all: RestConversation[] = [];
  for await (const conversation of client.conversations(accountId, "instagram")) all.push(conversation);
  report.conversaciones = all.length;
  log(`${all.length} chats de Instagram en Zernio`);

  let state: HistoryImportState | null = opts.state && !opts.fromScratch ? await opts.state.load() : null;
  if (state && (state.accountId !== accountId || state.finished)) state = null;
  const current: HistoryImportState = state ?? {
    version: 1,
    accountId,
    startedAt: new Date(started).toISOString(),
    updatedAt: new Date(started).toISOString(),
    finished: false,
    done: [],
  };
  const done = new Set(current.done);

  const bulk = new BulkSignal(emitBulk(channel.organizationId), {
    messages: BULK_SIGNAL_MESSAGES,
    ms: BULK_SIGNAL_MS,
    now,
    onError: (error) => report.errores.push(`aviso en lote: ${error instanceof Error ? error.message : String(error)}`),
  });

  // Contactos de Instagram ya en el CRM (para el reporte de la simulación).
  const ids = all.map((c) => c.participantId).filter((id): id is string => !!id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: contacts.instagramId })
      .from(contacts)
      .where(and(eq(contacts.organizationId, channel.organizationId), inArray(contacts.instagramId, ids.slice(i, i + 500))));
    for (const r of rows) if (r.id) known.add(r.id);
  }

  let lastProgress = now();
  for (const [index, conversation] of all.entries()) {
    if (opts.signal?.aborted) {
      report.cortado = true;
      break;
    }
    if (done.has(conversation.id)) {
      report.reanudadas++;
      continue;
    }
    if (!conversation.participantId) {
      report.sinCliente++;
      continue;
    }
    const chat: HistoryChat = {
      providerConversationId: conversation.id,
      phone: null,
      bsuid: null,
      instagramId: conversation.participantId,
      username: conversation.participantUsername ?? null,
      name: conversation.participantName ?? undefined,
    };
    if (known.has(conversation.participantId)) report.contactos.existentes++;
    else report.contactos.nuevos++;
    known.add(conversation.participantId);

    try {
      for await (const page of client.messagePages(accountId, conversation.id)) {
        const events: NormalizedMessageEvent[] = [];
        for (const raw of page) {
          const mapped = instagramHistoryEventFromRest(accountId, conversation, raw, new Date(now()));
          if ("skip" in mapped) {
            skip(mapped.skip);
            continue;
          }
          events.push(mapped.event);
          track(mapped.event.sentAt);
          for (const a of mapped.event.attachments) {
            if (a.unavailable) report.adjuntos.viejos++;
            else report.adjuntos.recientes++;
          }
        }
        report.mensajes += events.length;
        if (opts.dryRun) {
          const already = await existingMids(channel.organizationId, events.map((e) => e.providerMessageId));
          report.duplicados += already.size;
          report.importados += events.length - already.size;
          continue;
        }
        // Una página = una transacción (todo o nada); el `mid` único evita duplicados.
        const result = await ingestHistoryPage(channel, chat, events, { batchNotify: true });
        report.importados += result.inserted.length;
        report.duplicados += result.duplicates;
        await bulk.add(result.inserted.length, result.contact === "nuevo" ? 1 : 0);
      }
    } catch (error) {
      // Lo de los chats ya terminados quedó guardado (y en el punto de reanudación): el
      // MISMO comando sigue desde este chat.
      await bulk.flush();
      throw error;
    }
    report.procesadas++;
    if (!opts.dryRun && opts.state) {
      done.add(conversation.id);
      current.done = [...done];
      current.updatedAt = new Date(now()).toISOString();
      await opts.state.save(current);
    }
    if (index + 1 === all.length || now() - lastProgress > 30_000 || (index + 1) % 25 === 0) {
      lastProgress = now();
      log(`chat ${index + 1} de ${all.length} · ${report.importados} mensajes ${opts.dryRun ? "por importar" : "importados"}`);
    }
  }

  await bulk.flush();
  report.avisosEnLote = bulk.sent;
  report.omitidos = [...skipped.entries()].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total);
  report.terminado = !report.cortado;
  if (!opts.dryRun && opts.state && report.terminado) {
    current.finished = true;
    current.updatedAt = new Date(now()).toISOString();
    await opts.state.save(current);
  }
  report.duracionMs = now() - started;
  return report;
}

const fmt = new Intl.NumberFormat("es-MX");

/** Resumen de pocas líneas para la terminal (simulación o importación). */
export function instagramHistorySummary(r: InstagramHistoryReport): string[] {
  const n = (v: number) => fmt.format(v);
  const sim = r.modo === "simulacion";
  return [
    `Chats: ${n(r.conversaciones)} de Instagram en Zernio; ${n(r.procesadas)} recorridos${r.reanudadas ? `, ${n(r.reanudadas)} ya terminados antes` : ""}${r.sinCliente ? `, ${n(r.sinCliente)} sin cliente (no se importan)` : ""}.`,
    `Mensajes: ${n(r.mensajes)} leídos; ${n(r.importados)} ${sim ? "entrarían" : "nuevos"}; ${n(r.duplicados)} ya estaban (no se duplican).`,
    `Contactos: ${n(r.contactos.nuevos)} ${sim ? "se crearían" : "nuevos"}, ${n(r.contactos.existentes)} ya existían.`,
    `Fechas: ${r.rango.desde?.slice(0, 10) ?? "—"} a ${r.rango.hasta?.slice(0, 10) ?? "—"}. Adjuntos: ${n(r.adjuntos.recientes)} se copian, ${n(r.adjuntos.viejos)} viejos o sin archivo (se ven en la app).`,
    `Omitidos: ${r.omitidos.length ? r.omitidos.map((o) => `${o.total} ${o.motivo}`).join("; ") : "ninguno"}. Zernio: ${n(r.peticiones.requests)} peticiones, ${n(r.peticiones.throttled)} esperas, ${n(r.peticiones.retries)} reintentos.`,
    r.cortado ? "CORTADO: el avance quedó guardado; corre el MISMO comando para seguir." : `Terminado en ${Math.max(1, Math.round(r.duracionMs / 60_000))} min.`,
  ];
}
