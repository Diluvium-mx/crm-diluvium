// Corrida del importador del historial del celular (docs/go-live.md, día del número
// oficial; docs/numero-prueba.md, paso 5): recorre TODAS las conversaciones de la
// cuenta en Zernio, importa SOLO los mensajes del historial (coexistence_history) y
// después rellena nombres vacíos con la agenda.
//
// Escala (1,000+ chats, decenas de miles de mensajes):
// - un INSERT por página de Zernio (≤100 mensajes), no uno por mensaje;
// - avance "chat 350 de 1,200" con tiempo restante;
// - punto de reanudación por chat terminado (history-state.ts): Ctrl+C, red caída o
//   límite de Zernio → se vuelve a correr el MISMO comando y sigue donde se quedó;
// - tiempo real: las transacciones del importador apagan el aviso por fila (migración
//   0039) y se manda UNA señal `inbox.bulk` cada 500 mensajes o cada 5 s.
// Regla del dueño: NINGÚN contacto duplicado. Cada chat se pega al contacto que ya
// tiene ese teléfono (normalizado, +52 y 10 dígitos); si hay más de uno, NO se adivina:
// el chat no se importa y se reporta. Solo se crea contacto si no hay ninguno.
// --simular: SOLO lectura (Zernio y base), nada se escribe; arma el reporte previo.
// Idempotente (wamid único): se puede repetir hasta que Zernio termine de copiar.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages } from "@/lib/db/schema";
import { canonicalPhone, normalizePhone } from "@/lib/phone";
import { DeadLetterIngestError } from "./ingest";
import {
  AmbiguousContactError,
  fillEmptyContactNames,
  HISTORY_MEDIA_MAX_AGE_DAYS,
  ingestHistoryPage,
  isEmptyContactName,
  type HistoryChat,
  type HistoryContactMatch,
} from "./history";
import type { HistoryImportState, HistoryStateStore } from "./history-state";
import type { NormalizedMessageEvent } from "./provider";
import { historyEventFromRest, restPhone, type RestConversation, type ZernioHistoryClient, type ZernioHistoryStats } from "./zernio-history";

/** Señal de tiempo real por lote: cada tantos mensajes o cada tantos ms, lo que pase primero. */
export const BULK_SIGNAL_MESSAGES = 500;
export const BULK_SIGNAL_MS = 5_000;
/** Consultas por página de la importación real (candados, INSERT, orden de la lista): para estimar. */
const DB_ROUND_TRIPS_PER_PAGE = 6;

export type HistoryImportReport = {
  modo: "simulacion" | "importacion";
  cuenta: string;
  canal: string;
  /** Chats de la cuenta en Zernio (activos y archivados). */
  conversaciones: number;
  /** Recorridos en esta corrida. */
  procesadas: number;
  /** Saltados por estar terminados en una corrida anterior que se cortó. */
  reanudadas: number;
  /** Mensajes del historial vistos en esta corrida. */
  mensajesHistorial: number;
  /** Nuevos (en simulación: los que entrarían). */
  importados: number;
  /** Ya estaban en el CRM (mismo wamid). */
  duplicados: number;
  /** Mensajes de Zernio que no son del historial (los vivos entran por el webhook). */
  noHistorial: number;
  omitidos: { motivo: string; total: number }[];
  /** A qué se pegó cada chat (en simulación: a qué se pegaría). */
  contactos: { existentesGhl: number; existentes: number; nuevos: number; conversacionExistente: number };
  /** Chats cuyo teléfono coincide con VARIOS contactos: no se importan. */
  ambiguos: { conversacion: string; telefono: string; contactos: string[] }[];
  /** Chats sin un teléfono que se pueda normalizar: no se importan. */
  sinTelefono: { conversacion: string; participante: string | null }[];
  grupos: number;
  /** Chats de Zernio con el mismo teléfono que otro chat de la corrida (van al MISMO contacto). */
  chatsMismoTelefono: number;
  /** Contactos del CRM que ya comparten teléfono normalizado (posibles duplicados de hoy; solo simulación). */
  duplicadosEnCrm: { telefono: string; contactos: string[] }[];
  rango: { desde: string | null; hasta: string | null };
  adjuntos: { recientesConArchivo: number; viejosConArchivo: number; sinArchivo: number };
  agenda: { leidos: number; rellenados: number; rellenables: number; sinContacto: number };
  nombresRellenados: number;
  avisosEnLote: number;
  /** Se detuvo antes de terminar (Ctrl+C): el mismo comando reanuda. */
  cortado: boolean;
  terminado: boolean;
  errores: string[];
  /** Primeros mensajes vistos (fecha, dirección, tipo) para cotejar con el celular. */
  muestra: { conversacion: string; fecha: string; direccion: "in" | "out"; tipo: string }[];
  peticiones: ZernioHistoryStats;
  duracionMs: number;
  /** Solo simulación: cuánto tardaría la importación real. */
  estimacionMs: number | null;
};

export type HistoryImportOptions = {
  dryRun?: boolean;
  withContacts?: boolean;
  log?: (line: string) => void;
  /** Punto de reanudación (importación real). Sin él, la corrida no se puede reanudar. */
  state?: HistoryStateStore;
  /** Ignora una corrida anterior sin terminar y empieza desde el primer chat. */
  fromScratch?: boolean;
  /** Ctrl+C: termina la página en curso, guarda el avance y regresa con `cortado`. */
  signal?: AbortSignal;
  bulkSignal?: { messages?: number; ms?: number };
  now?: () => number;
  /** Cada cuántos chats se muestra el avance (además de cada 30 s). */
  progressEvery?: number;
};

const fmt = new Intl.NumberFormat("es-MX");

function minutes(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Señal `inbox.bulk` por lote: la Bandeja y el Embudo abiertos se ponen al día una vez por lote. */
export class BulkSignal {
  private messages = 0;
  private contacts = 0;
  private last: number;
  sent = 0;
  failed = 0;

  constructor(
    private readonly emit: (messages: number, contacts: number) => Promise<void>,
    private readonly opts: { messages: number; ms: number; now: () => number; onError?: (error: unknown) => void },
  ) {
    this.last = opts.now();
  }

  async add(messages: number, contacts: number): Promise<void> {
    this.messages += messages;
    this.contacts += contacts;
    if (this.messages >= this.opts.messages) await this.flush();
    else await this.tick();
  }

  /** Lo pendiente sale si ya pasaron `ms` desde la última señal. */
  async tick(): Promise<void> {
    if (this.opts.now() - this.last >= this.opts.ms) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.messages === 0 && this.contacts === 0) return;
    const [m, c] = [this.messages, this.contacts];
    this.messages = 0;
    this.contacts = 0;
    this.last = this.opts.now();
    try {
      await this.emit(m, c);
      this.sent++;
    } catch (error) {
      // Lo importado ya está guardado; solo la pantalla abierta se queda atrás hasta la
      // siguiente señal (o su recarga). No se reintenta el mismo aviso.
      this.failed++;
      this.opts.onError?.(error);
    }
  }
}

function emitBulk(organizationId: string) {
  return async (mensajes: number, contactos: number) => {
    const payload = JSON.stringify({ org: organizationId, type: "inbox.bulk", mensajes, contactos });
    await db.execute(sql`select pg_notify('inbox_events', ${payload})`);
  };
}

type IndexedContact = { id: string; source: string | null; ghlContactId: string | null; firstName: string; lastName: string | null; phoneE164: string };

/** Teléfonos de TODOS los contactos de la organización (una lectura): la simulación clasifica en memoria. */
async function contactIndex(organizationId: string): Promise<Map<string, IndexedContact[]>> {
  const rows = await db
    .select({
      id: contacts.id,
      source: contacts.source,
      ghlContactId: contacts.ghlContactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      phoneE164: contacts.phoneE164,
    })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), isNotNull(contacts.phoneE164)));
  const index = new Map<string, IndexedContact[]>();
  for (const r of rows) {
    const key = canonicalPhone(r.phoneE164!);
    index.set(key, [...(index.get(key) ?? []), { ...r, phoneE164: r.phoneE164! }]);
  }
  return index;
}

/**
 * ¿Es un grupo aunque Zernio no lo marque? Id de grupo de WhatsApp (…@g.us) o, sin
 * participante, entrantes de MÁS de un remitente: nunca se pega a uno de sus miembros.
 */
function looksLikeGroup(conversation: RestConversation, events: readonly NormalizedMessageEvent[]): boolean {
  if (conversation.isGroup || /@g\.us$/i.test(conversation.participantId ?? "")) return true;
  if (conversation.participantId) return false;
  return new Set(events.filter((e) => e.direction === "in" && e.contactPhone).map((e) => e.contactPhone)).size > 1;
}

/**
 * Identidad del chat: teléfono del participante, con la función única del CRM. Solo si
 * Zernio no da participante se usa el remitente de los entrantes (uno solo). Un
 * participante que no es teléfono (usuario, id raro) NO cae al remitente: se reporta.
 */
function chatIdentity(conversation: RestConversation, events: readonly NormalizedMessageEvent[]): { chat: HistoryChat; raw: string | null } {
  const firstIn = events.find((e) => e.direction === "in");
  const raw = conversation.participantId ? restPhone(conversation.participantId) : (firstIn?.contactPhone ?? null);
  let phone: string | null = null;
  if (raw) {
    try {
      phone = normalizePhone(raw);
    } catch {
      phone = null;
    }
  }
  return {
    chat: { providerConversationId: conversation.id, phone, bsuid: null, name: conversation.participantName ?? firstIn?.contactName },
    raw: conversation.participantId ?? raw,
  };
}

function freshState(accountId: string, now: number): HistoryImportState {
  const at = new Date(now).toISOString();
  return { version: 1, accountId, startedAt: at, updatedAt: at, finished: false, done: [] };
}

export async function importPhoneHistory(
  client: ZernioHistoryClient,
  accountId: string,
  opts: HistoryImportOptions = {},
): Promise<HistoryImportReport> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const started = now();
  const dryRun = opts.dryRun === true;
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.providerAccountId, accountId)))
    .limit(1);
  if (!channel) throw new Error(`No hay canal para la cuenta ${accountId}: dalo de alta primero`);
  if (!channel.isActive || channel.archivedAt) throw new Error(`El canal ${channel.id} está inactivo o archivado: no se importa`);
  const orgId = channel.organizationId;

  const report: HistoryImportReport = {
    modo: dryRun ? "simulacion" : "importacion",
    cuenta: accountId,
    canal: channel.id,
    conversaciones: 0,
    procesadas: 0,
    reanudadas: 0,
    mensajesHistorial: 0,
    importados: 0,
    duplicados: 0,
    noHistorial: 0,
    omitidos: [],
    contactos: { existentesGhl: 0, existentes: 0, nuevos: 0, conversacionExistente: 0 },
    ambiguos: [],
    sinTelefono: [],
    grupos: 0,
    chatsMismoTelefono: 0,
    duplicadosEnCrm: [],
    rango: { desde: null, hasta: null },
    adjuntos: { recientesConArchivo: 0, viejosConArchivo: 0, sinArchivo: 0 },
    agenda: { leidos: 0, rellenados: 0, rellenables: 0, sinContacto: 0 },
    nombresRellenados: 0,
    avisosEnLote: 0,
    cortado: false,
    terminado: false,
    errores: [],
    muestra: [],
    peticiones: client.stats,
    duracionMs: 0,
    estimacionMs: null,
  };
  const skipped = new Map<string, number>();
  const phonesSeen = new Set<string>();
  /** Simulación: teléfono de un contacto que NACERÍA por su chat → ¿nace sin nombre? (la agenda lo rellenaría). */
  const plannedNew = new Map<string, boolean>();
  const mediaCutoff = now() - HISTORY_MEDIA_MAX_AGE_DAYS * 86_400_000;
  const countMatch = (match: HistoryContactMatch) => {
    if (match === "existente_ghl") report.contactos.existentesGhl++;
    else if (match === "existente") report.contactos.existentes++;
    else if (match === "nuevo") report.contactos.nuevos++;
    else report.contactos.conversacionExistente++;
  };

  // Simulación: índice de teléfonos del CRM (una lectura) y posibles duplicados de HOY.
  const index = dryRun ? await contactIndex(orgId) : null;
  if (index) {
    for (const [telefono, list] of index) {
      if (list.length > 1) report.duplicadosEnCrm.push({ telefono, contactos: list.map((c) => c.id) });
    }
  }

  /** Simulación de una página: clasifica el chat (1.ª página) y cuenta nuevos/ya guardados. false = no se importaría. */
  const simulatePage = async (chat: HistoryChat, events: readonly NormalizedMessageEvent[], first: boolean): Promise<boolean> => {
    if (first) {
      const phone = chat.phone!;
      const list = index!.get(canonicalPhone(phone)) ?? [];
      const [known] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.channelId, channel.id), eq(conversations.providerConversationId, chat.providerConversationId)))
        .limit(1);
      if (!known && list.length > 1) {
        report.ambiguos.push({ conversacion: chat.providerConversationId, telefono: phone, contactos: list.map((c) => c.id) });
        return false;
      }
      if (known) countMatch("conversacion_existente");
      else if (list.length === 1) countMatch(list[0].source === "ghl_import" || list[0].ghlContactId ? "existente_ghl" : "existente");
      else if (phonesSeen.has(phone)) report.chatsMismoTelefono++;
      else {
        countMatch("nuevo");
        plannedNew.set(phone, !chat.name?.trim());
      }
      phonesSeen.add(phone);
    }
    const stored = await db
      .select({ id: messages.providerMessageId })
      .from(messages)
      .where(and(eq(messages.organizationId, orgId), inArray(messages.providerMessageId, events.map((e) => e.providerMessageId))));
    report.duplicados += stored.length;
    report.importados += events.length - stored.length;
    return true;
  };

  // Punto de reanudación (solo importación real).
  let state: HistoryImportState | null = null;
  if (!dryRun && opts.state) {
    const previous = opts.fromScratch ? null : await opts.state.load();
    if (previous && previous.accountId !== accountId) throw new Error(`El estado guardado es de otra cuenta (${previous.accountId})`);
    state = previous && !previous.finished ? previous : freshState(accountId, now());
    if (previous && !previous.finished) log(`reanudando: ${fmt.format(previous.done.length)} chat(s) ya terminados se saltan`);
  }
  const done = new Set(state?.done ?? []);
  const saveState = async () => {
    if (!state || !opts.state) return;
    state.done = [...done];
    state.updatedAt = new Date(now()).toISOString();
    await opts.state.save(state);
  };

  const signal = dryRun
    ? null
    : new BulkSignal(emitBulk(orgId), {
        messages: opts.bulkSignal?.messages ?? BULK_SIGNAL_MESSAGES,
        ms: opts.bulkSignal?.ms ?? BULK_SIGNAL_MS,
        now,
        onError: (error) => log(`aviso de tiempo real NO enviado (la Bandeja abierta se pone al día con el siguiente): ${error instanceof Error ? error.message : String(error)}`),
      });
  // Mientras se espera a Zernio también sale lo pendiente (a los 5 s aunque no llegue nada nuevo).
  const ticker = signal ? setInterval(() => void signal.tick(), 1_000) : null;
  ticker?.unref?.();

  let dbWriteMs = 0;
  let pagesWithHistory = 0;
  try {
    // 1. Listado completo primero (barato: 100 por página) para saber el total.
    log("leyendo la lista de chats en Zernio…");
    const all: RestConversation[] = [];
    for await (const conversation of client.conversations(accountId)) all.push(conversation);
    report.conversaciones = all.length;
    log(`${fmt.format(all.length)} chat(s) en Zernio`);

    let lastLog = now();
    let workStarted: number | null = null;
    let worked = 0;
    const every = opts.progressEvery ?? 10;
    const progress = (i: number) => {
      const t = now();
      if (i !== all.length - 1 && (i + 1) % every !== 0 && t - lastLog < 30_000) return;
      lastLog = t;
      const left = all.length - (i + 1);
      const eta = workStarted !== null && worked > 0 && left > 0 ? ` · faltan ~${minutes(((t - workStarted) / worked) * left)}` : "";
      const verb = dryRun ? "entrarían" : "nuevos";
      log(
        `chat ${fmt.format(i + 1)} de ${fmt.format(all.length)} · ${fmt.format(report.importados)} mensajes ${verb}` +
          `${report.duplicados ? ` · ${fmt.format(report.duplicados)} ya estaban` : ""}${eta}`,
      );
    };

    for (let i = 0; i < all.length; i++) {
      const conversation = all[i];
      if (done.has(conversation.id)) {
        report.reanudadas++;
        continue;
      }
      if (opts.signal?.aborted) {
        report.cortado = true;
        break;
      }
      workStarted ??= now();
      report.procesadas++;
      if (conversation.isGroup) {
        report.grupos++;
        done.add(conversation.id);
        continue;
      }

      let identity: { chat: HistoryChat; raw: string | null } | null = null;
      let firstPage = true;
      let stop = false;
      let aborted = false;
      for await (const page of client.messagePages(accountId, conversation.id)) {
        const events: NormalizedMessageEvent[] = [];
        for (const raw of page) {
          const parsed = historyEventFromRest(accountId, conversation, raw);
          if ("skip" in parsed) {
            if (parsed.skip === "no es historial") report.noHistorial++;
            else skipped.set(parsed.skip, (skipped.get(parsed.skip) ?? 0) + 1);
            continue;
          }
          events.push(parsed.event);
        }
        if (events.length > 0) {
          if (looksLikeGroup(conversation, events)) {
            report.grupos++;
            break;
          }
          identity ??= chatIdentity(conversation, events);
          const { chat } = identity;
          const wasFirst = firstPage;
          firstPage = false;
          if (!chat.phone) {
            report.sinTelefono.push({ conversacion: conversation.id, participante: identity.raw });
            stop = true;
          } else if (dryRun) {
            stop = !(await simulatePage(chat, events, wasFirst));
          } else {
            try {
              const t0 = now();
              const result = await ingestHistoryPage(channel, chat, events, { batchNotify: true });
              dbWriteMs += now() - t0;
              if (wasFirst) countMatch(result.contact);
              report.importados += result.inserted.length;
              report.duplicados += result.duplicates;
              await signal!.add(result.inserted.length, wasFirst && result.contact === "nuevo" ? 1 : 0);
            } catch (error) {
              if (error instanceof AmbiguousContactError) {
                report.ambiguos.push({ conversacion: conversation.id, telefono: error.identity, contactos: error.contactIds });
                stop = true;
              } else if (error instanceof DeadLetterIngestError) {
                if (report.errores.length < 50) report.errores.push(`${conversation.id}: ${error.message}`);
                stop = true;
              } else throw error; // error de base: se detiene; el mismo comando reanuda
            }
          }
          if (!stop) {
            pagesWithHistory++;
            report.mensajesHistorial += events.length;
            for (const event of events) {
              const at = event.sentAt.toISOString();
              if (!report.rango.desde || at < report.rango.desde) report.rango.desde = at;
              if (!report.rango.hasta || at > report.rango.hasta) report.rango.hasta = at;
              for (const a of event.attachments) {
                if (!a.url || a.unavailable) report.adjuntos.sinArchivo++;
                else if (event.sentAt.getTime() < mediaCutoff) report.adjuntos.viejosConArchivo++;
                else report.adjuntos.recientesConArchivo++;
              }
              if (report.muestra.length < 20) {
                report.muestra.push({ conversacion: conversation.id, fecha: at, direccion: event.direction, tipo: event.type });
              }
            }
          }
        }
        if (stop) break;
        if (opts.signal?.aborted) {
          aborted = true;
          break;
        }
      }
      if (aborted) {
        // El chat a medias NO se marca: la reanudación lo repite (el wamid evita duplicados).
        report.cortado = true;
        break;
      }
      done.add(conversation.id);
      worked++;
      await saveState();
      progress(i);
    }

    // 2. Agenda del celular: solo rellena nombres vacíos de contactos que ya existen.
    if (!report.cortado && opts.withContacts !== false) {
      const entries: { phoneE164: string; name: string }[] = [];
      for await (const entry of client.contacts(accountId)) entries.push(entry);
      report.agenda.leidos = entries.length;
      if (dryRun) {
        for (const entry of entries) {
          const key = canonicalPhone(entry.phoneE164);
          const list = index!.get(key) ?? [];
          if (list.length > 0) {
            if (list.some((c) => isEmptyContactName(c.firstName, c.lastName, c.phoneE164))) report.agenda.rellenables++;
          } else if (plannedNew.has(key)) {
            if (plannedNew.get(key)) report.agenda.rellenables++; // nace por su chat con el teléfono como nombre
          } else report.agenda.sinContacto++;
        }
        log(
          `agenda: ${fmt.format(entries.length)} contacto(s) con nombre; ${fmt.format(report.agenda.rellenables)} rellenarían un nombre vacío; ` +
            `${fmt.format(report.agenda.sinContacto)} sin chat ni contacto en el CRM (no se crean)`,
        );
      } else {
        const { filled } = await fillEmptyContactNames(orgId, entries);
        report.agenda.rellenados = filled;
        report.nombresRellenados = filled;
        if (filled > 0) await signal!.add(0, filled);
        log(`agenda: ${fmt.format(entries.length)} contacto(s) leídos, ${fmt.format(filled)} nombre(s) vacío(s) rellenado(s)`);
      }
    }

    report.terminado = !report.cortado;
    if (state) state.finished = report.terminado;
  } finally {
    if (ticker) clearInterval(ticker);
    await signal?.flush();
    report.avisosEnLote = signal?.sent ?? 0;
    await saveState();
  }

  report.omitidos = [...skipped.entries()].map(([motivo, total]) => ({ motivo, total }));
  report.duracionMs = now() - started;
  if (dryRun) {
    // La importación real hace las MISMAS lecturas de Zernio más sus escrituras.
    report.estimacionMs = report.duracionMs + pagesWithHistory * DB_ROUND_TRIPS_PER_PAGE * (await dbRoundTripMs());
  } else if (pagesWithHistory > 0) {
    log(`base: ${fmt.format(Math.round(dbWriteMs / 1000))} s escribiendo ${fmt.format(pagesWithHistory)} página(s)`);
  }
  return report;
}

async function dbRoundTripMs(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await db.execute(sql`select 1`);
    total += performance.now() - t0;
  }
  return total / 3;
}

/** Resumen del reporte de simulación en 10 líneas, en lenguaje simple. */
export function simulationSummary(r: HistoryImportReport): string[] {
  const n = (v: number) => fmt.format(v);
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  const chats = r.contactos.existentesGhl + r.contactos.existentes + r.contactos.nuevos + r.contactos.conversacionExistente + r.chatsMismoTelefono;
  return [
    `1. Chats en Zernio: ${n(r.conversaciones)} (${n(r.grupos)} grupos, no se importan). Mensajes del historial: ${n(r.mensajesHistorial)}.`,
    `2. Entrarían ${n(r.importados)} mensajes nuevos; ${n(r.duplicados)} ya están en el CRM (mismo wamid, no se duplican).`,
    `3. De ${n(chats)} chats con historial: ${n(r.contactos.existentesGhl)} se pegan a contactos de GHL; ${n(r.contactos.existentes)} a otros contactos existentes; ${n(r.contactos.conversacionExistente)} a una conversación que ya está en el CRM.`,
    `4. Contactos nuevos (nacen en Inbox, source historial_celular, sin marca Prueba): ${n(r.contactos.nuevos)}; más ${n(r.chatsMismoTelefono)} chat(s) con un teléfono ya visto en otro chat (van al mismo contacto).`,
    `5. Teléfonos que no se pudieron normalizar (esos chats no se importan): ${n(r.sinTelefono.length)}.`,
    `6. Posibles duplicados: ${n(r.duplicadosEnCrm.length)} teléfono(s) que YA comparten dos o más contactos del CRM; ${n(r.ambiguos.length)} chat(s) que coinciden con más de un contacto (NO se importan; se revisan a mano).`,
    `7. Rango de fechas del historial: ${date(r.rango.desde)} a ${date(r.rango.hasta)}.`,
    `8. Adjuntos: ${n(r.adjuntos.recientesConArchivo)} de las últimas 2 semanas con archivo (se descargan poco a poco); ${n(r.adjuntos.viejosConArchivo + r.adjuntos.sinArchivo)} quedan "no disponible" con su tipo (${n(r.adjuntos.viejosConArchivo)} viejos, ${n(r.adjuntos.sinArchivo)} sin archivo).`,
    `9. Agenda del celular: ${n(r.agenda.leidos)} contactos; rellenarían ${n(r.agenda.rellenables)} nombre(s) vacío(s) (nunca cambian uno puesto); ${n(r.agenda.sinContacto)} sin chat ni contacto en el CRM (no se crean).`,
    `10. Duración: la lectura tomó ${minutes(r.duracionMs)} (${n(r.peticiones.requests)} peticiones a Zernio, ${n(r.peticiones.throttled)} esperas por límite); la importación real tardaría ~${minutes(r.estimacionMs ?? r.duracionMs)}.`,
  ];
}
