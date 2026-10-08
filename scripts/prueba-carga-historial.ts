// Uso: DATABASE_URL=postgresql://…@localhost:…/<base>_carga npm run historial:prueba-carga
// Prueba de carga LOCAL del importador del historial del celular (docs/go-live.md):
// 1,500 chats y 50,000 mensajes con la forma de la API de Zernio, servidos por HTTP real
// (test/zernio-historial-falso.ts) contra una base con 10,901 contactos tipo GHL.
// - 60 % de los chats son clientes de GHL (teléfono escrito distinto: con y sin +52, con
//   521, con espacios), 40 % nuevos (incluye 1 grupo y 1 sin teléfono), 20 contactos de
//   agenda sin chat, 429 y 5xx inyectados;
// - simulación → importación cortada a la mitad (Ctrl+C) → reanudación → segunda corrida completa;
// - mide duración, memoria, avisos de tiempo real y la Bandeja (lista, señales del Embudo)
//   MIENTRAS importa; verifica CERO duplicados.
// BORRA la base que recibe: se niega si no es local o si su nombre no dice "carga".
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, organization } from "@/lib/db/schema";
import { importPhoneHistory, simulationSummary, type HistoryImportReport } from "@/lib/messaging/history-import";
import { memoryStateStore } from "@/lib/messaging/history-state";
import { ZernioHistoryClient } from "@/lib/messaging/zernio-history";
import { listConversationsForOrg, listMessagesForOrg } from "@/lib/inbox/queries";
import { funnelSignalsForOrg } from "@/lib/contacts/funnel-signals";
import { fakeZernioFetch, type FakeAttachment, type FakeChat, type FakeMessage, type FakeWorld } from "@/test/zernio-historial-falso";
import { logError } from "@/lib/log/safe-error";

const ORG = "org_carga";
const ACCOUNT = "zacc_oficial_carga";
const CHATS = 1_500;
const MESSAGES = 50_000;
const GHL_CONTACTS = 10_901;
const DAY = 86_400_000;

function assertLocal(url: string) {
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error(`La prueba de carga BORRA la base: solo corre en local (host ${u.hostname})`);
  if (!u.pathname.includes("carga")) throw new Error(`La prueba de carga BORRA la base: su nombre debe decir "carga" (${u.pathname})`);
}

// PRNG determinista (mulberry32): la misma corrida siempre genera el mismo mundo.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Seeded = { phones: string[]; placeholders: string[] };

async function seedDatabase(): Promise<Seeded> {
  await db.execute(sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
  await db.insert(organization).values({ id: ORG, name: "Diluvium (carga)", slug: "diluvium-carga", createdAt: new Date() });
  await db.insert(channels).values({
    id: "ch_zernio_oficial_carga",
    organizationId: ORG,
    type: "whatsapp",
    provider: "zernio",
    providerAccountId: ACCOUNT,
    displayName: "WhatsApp Diluvium",
    connectedAt: new Date(),
  });
  const phones: string[] = [];
  const placeholders: string[] = [];
  const rows: (typeof contacts.$inferInsert)[] = [];
  for (let i = 0; i < GHL_CONTACTS; i++) {
    const national = `668${String(1_000_000 + i).padStart(7, "0")}`;
    phones.push(national);
    const placeholder = i >= 100 && i < 110; // 10 con nombre vacío: la agenda los rellena
    if (placeholder) placeholders.push(national);
    rows.push({
      id: `ghl_${i}`,
      organizationId: ORG,
      firstName: placeholder ? "Cliente de WhatsApp" : `Cliente GHL ${i}`,
      // Algunos se guardaron con el 1 heredado (+521), como antes del backfill.
      phoneE164: i % 25 === 0 ? `+521${national}` : `+52${national}`,
      source: "ghl_import",
      ghlContactId: `GHL${i}`,
      stage: (["inbox", "prospecto", "interesado", "cerca_compra", "compra"] as const)[i % 5],
      createdAt: new Date(Date.now() - 9 * DAY),
    });
  }
  rows.push({ id: "n2_contacto", organizationId: ORG, firstName: "Contacto N2", phoneE164: "+526681448962", source: "whatsapp" });
  for (let i = 0; i < rows.length; i += 1_000) await db.insert(contacts).values(rows.slice(i, i + 1_000));
  return { phones, placeholders };
}

function buildWorld(seeded: Seeded, now: number): { world: FakeWorld; historyMessages: number; newPhones: number } {
  const rand = rng(20260926);
  // Tamaños sesgados (pocos chats enormes, muchos chicos) que suman exactamente MESSAGES.
  const weights = Array.from({ length: CHATS }, () => Math.exp(rand() * 5.5));
  // Unos cuantos chats ENORMES (clientes de años): muchas páginas de 100 por chat.
  weights[3] = weights[450] = weights[1200] = 0;
  const bigTotal = weights.reduce((a, b) => a + b, 0) / 0.9;
  weights[3] = bigTotal * 0.05;
  weights[450] = bigTotal * 0.03;
  weights[1200] = bigTotal * 0.02;
  const total = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(1, Math.floor((w / total) * MESSAGES)));
  let diff = MESSAGES - sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % CHATS) {
    if (diff > 0) {
      sizes[i]++;
      diff--;
    } else if (sizes[i] > 1) {
      sizes[i]--;
      diff++;
    }
  }
  const existingCount = Math.round(CHATS * 0.6);
  const formats = [
    (n: string) => `521${n}`,
    (n: string) => `+52${n}`,
    (n: string) => `52${n}`,
    (n: string) => `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`,
    (n: string) => `+521 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`,
  ];
  const ladas = ["667", "669", "55", "33", "81", "668"];
  const chats: FakeChat[] = [];
  const agenda: FakeWorld["contacts"] = [];
  let historyMessages = 0;
  let newPhones = 0;
  let seq = 0;
  for (let i = 0; i < CHATS; i++) {
    let participantId: string | null;
    let participantName: string | null = `Perfil ${i}`;
    let isGroup = false;
    if (i < existingCount) {
      const national = seeded.phones[200 + i * 7]; // clientes de GHL distintos
      participantId = formats[i % formats.length](national);
      if (i % 3 === 0) agenda.push({ name: `Agenda ${i}`, platformIdentifier: participantId }); // ya tienen nombre: no se pisa
    } else if (i === existingCount) {
      participantId = "120363040000000001@g.us"; // grupo (Zernio no manda isGroup: se reconoce por el id)
      isGroup = true;
    } else if (i === existingCount + 1) {
      participantId = "usuario.sin.telefono";
    } else {
      const lada = ladas[i % ladas.length];
      const national = `${lada}${String(3_000_000 + i).padStart(10 - lada.length, "0")}`.slice(0, 10);
      participantId = i % 20 === 0 ? `1480${String(2_000_000 + i).slice(-7)}` : formats[i % formats.length](national);
      newPhones++;
      if (i % 7 === 0) {
        participantName = null; // nace con el teléfono como nombre…
        agenda.push({ name: `Agenda nuevo ${i}`, platformIdentifier: participantId }); // …y la agenda lo rellena
      }
    }
    const messages: FakeMessage[] = [];
    const span = 180 * DAY * (0.2 + rand() * 0.8);
    const start = now - span - DAY;
    for (let j = 0; j < sizes[i]; j++) {
      seq++;
      const at = start + (span * j) / sizes[i];
      const live = at > now - 2 * DAY && rand() < 0.05; // un poco de tráfico vivo mezclado (lo salta)
      const attachments: FakeAttachment[] = [];
      if (rand() < 0.12) {
        const r = rand();
        const type: FakeAttachment["type"] = r < 0.5 ? "image" : r < 0.75 ? "audio" : r < 0.9 ? "file" : "video";
        attachments.push({
          id: `media_${seq}`,
          type,
          url: rand() < 0.9 ? `https://zernio.test/api/v1/whatsapp/media/media_${seq}` : null,
          mimeType: type === "image" ? "image/jpeg" : type === "audio" ? "audio/ogg" : type === "file" ? "application/pdf" : "video/mp4",
          ...(type === "file" ? { filename: `archivo_${seq}.pdf` } : {}),
        });
      }
      messages.push({
        id: `wamid.CARGA.${seq}`,
        direction: rand() < 0.55 ? "incoming" : "outgoing",
        message: attachments.length && rand() < 0.5 ? null : `mensaje ${seq} del chat ${i}`,
        sentAt: new Date(at).toISOString(),
        attachments,
        history: !live,
      });
      if (!live && !isGroup && participantId !== "usuario.sin.telefono") historyMessages++;
    }
    chats.push({ id: `zconv_${i}`, participantId, participantName, archived: i % 97 === 0, messages });
  }
  // 20 de la agenda SIN chat: 10 rellenan nombres vacíos de GHL, 10 no tienen contacto (no se crean).
  for (const national of seeded.placeholders) agenda.push({ name: `Agenda GHL ${national}`, platformIdentifier: `521${national}` });
  for (let k = 0; k < 10; k++) agenda.push({ name: `Solo agenda ${k}`, platformIdentifier: `+52667${String(9_000_000 + k)}` });
  return { world: { accountId: ACCOUNT, chats, contacts: agenda }, historyMessages, newPhones };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  assertLocal(url);
  const t0 = Date.now();
  console.log("sembrando 10,901 contactos tipo GHL…");
  const seeded = await seedDatabase();
  const { world, historyMessages, newPhones } = buildWorld(seeded, Date.now());
  const worldMessages = world.chats.reduce((a, c) => a + c.messages.length, 0);
  console.log(`mundo: ${world.chats.length} chats, ${worldMessages} mensajes (${historyMessages} del historial importables), ${world.contacts.length} de agenda`);

  // Zernio falso por HTTP real (fetch, JSON y encabezados de verdad), con 429 y 502 inyectados.
  let cutAt: (() => void) | null = null;
  const chatsRequested = new Set<string>();
  const handler = fakeZernioFetch(world, {
    throttleEvery: 150,
    failEvery: 233,
    onRequest: (u) => {
      const m = u.pathname.match(/conversations\/([^/]+)\/messages$/);
      if (m) chatsRequested.add(m[1]);
      if (cutAt && chatsRequested.size >= CHATS / 2) {
        cutAt();
        cutAt = null;
      }
    },
  });
  const server = createServer(async (req, res) => {
    const response = await handler(`http://127.0.0.1${req.url}`);
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(response.status, headers);
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const client = () =>
    new ZernioHistoryClient({ apiKey: "local", baseUrl: `http://127.0.0.1:${port}/api`, pacing: { minIntervalMs: 0 } });

  // Tiempo real: se cuentan los avisos que recibiría la Bandeja abierta.
  const listener = postgres(url, { max: 1 });
  const notices: Record<string, number> = {};
  await listener.listen("inbox_events", (payload) => {
    const type = (JSON.parse(payload) as { type: string }).type;
    notices[type] = (notices[type] ?? 0) + 1;
  });

  // Memoria y Bandeja mientras importa.
  const baseline = process.memoryUsage();
  let peakRss = baseline.rss;
  let peakHeap = baseline.heapUsed;
  const memTimer = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  }, 250);
  const probe = { list: [] as number[], signals: [] as number[], errors: 0 };
  let probing = true;
  const probeLoop = (async () => {
    while (probing) {
      try {
        const a = performance.now();
        await listConversationsForOrg(ORG);
        probe.list.push(performance.now() - a);
        const b = performance.now();
        await funnelSignalsForOrg(ORG);
        probe.signals.push(performance.now() - b);
      } catch {
        probe.errors++;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  })();

  const runs: Record<string, { ms: number; report: HistoryImportReport }> = {};
  const log = (line: string) => console.log(`  ${line}`);
  const run = async (name: string, opts: Parameters<typeof importPhoneHistory>[2]) => {
    console.log(`\n== ${name}`);
    const start = Date.now();
    const report = await importPhoneHistory(client(), ACCOUNT, { log, progressEvery: 100, ...opts });
    runs[name] = { ms: Date.now() - start, report };
    console.log(`  → ${Math.round((Date.now() - start) / 1000)} s · nuevos ${report.importados} · ya estaban ${report.duplicados} · reanudadas ${report.reanudadas} · avisos en lote ${report.avisosEnLote} · 429 ${report.peticiones.throttled} · reintentos ${report.peticiones.retries}`);
    return report;
  };

  const beforeSample = await db.execute<{ n: number }>(sql`select count(*)::int as n from messages`);
  const sample = await run("0. muestra (--simular --muestra 50)", { dryRun: true, sample: 50 });
  const afterSample = await db.execute<{ n: number }>(sql`select count(*)::int as n from messages`);
  if (beforeSample[0].n !== afterSample[0].n) throw new Error("la muestra escribió mensajes");
  const simulation = await run("1. simulación (--simular)", { dryRun: true });
  const store = memoryStateStore();
  const controller = new AbortController();
  cutAt = () => controller.abort();
  chatsRequested.clear();
  const noticesBefore = { ...notices };
  await run("2. importación cortada a la mitad (Ctrl+C)", { state: store, signal: controller.signal });
  await run("3. reanudación (mismo comando)", { state: store });
  const noticesDuringImport = Object.fromEntries(Object.entries(notices).map(([k, v]) => [k, v - (noticesBefore[k] ?? 0)]));
  await run("4. segunda corrida completa", { state: store });

  probing = false;
  await probeLoop;
  clearInterval(memTimer);

  // Verificación: CERO duplicados.
  const [check] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from contacts where organization_id = ${ORG})::int as contactos,
      (select count(*) from contacts where organization_id = ${ORG} and source = 'historial_celular')::int as contactos_nuevos,
      (select count(*) from (select regexp_replace(phone_e164, '^\\+521(\\d{10})$', '+52\\1') p from contacts
         where organization_id = ${ORG} and phone_e164 is not null group by 1 having count(*) > 1) d)::int as telefonos_duplicados,
      (select count(*) from contacts where organization_id = ${ORG} and source = 'historial_celular' and phone_e164 like '+521%')::int as nuevos_con_521,
      (select count(*) from contacts where organization_id = ${ORG} and source = 'historial_celular' and es_prueba)::int as nuevos_prueba,
      (select count(*) from contacts where organization_id = ${ORG} and source = 'historial_celular' and stage <> 'inbox')::int as nuevos_fuera_de_inbox,
      (select count(*) from conversations where organization_id = ${ORG})::int as conversaciones,
      (select count(*) from (select contact_id from conversations where organization_id = ${ORG} group by channel_id, contact_id having count(*) > 1) d)::int as conversaciones_duplicadas,
      (select count(*) from messages where organization_id = ${ORG})::int as mensajes,
      (select count(*) from (select provider_message_id from messages group by 1 having count(*) > 1) d)::int as wamids_duplicados,
      (select count(*) from conversations where organization_id = ${ORG} and (unread_count > 0 or window_expires_at is not null or first_response_seconds is not null))::int as conversaciones_tocadas,
      (select count(*) from messages where organization_id = ${ORG} and jsonb_array_length(attachments) > 0 and not exists (
         select 1 from jsonb_array_elements(attachments) a where a->>'downloadError' is not null))::int as adjuntos_pendientes_de_descarga,
      (select count(*) from contacts where organization_id = ${ORG} and first_name like 'Agenda%')::int as nombres_de_agenda,
      (select count(*) from contacts where organization_id = ${ORG} and first_name like 'Solo agenda%')::int as creados_solo_por_agenda`);

  // La Bandeja DESPUÉS: primera página, el hilo más grande y las señales del Embudo.
  const after = { list: 0, thread: 0, signals: 0 };
  let a = performance.now();
  const page = await listConversationsForOrg(ORG);
  after.list = Math.round(performance.now() - a);
  const [biggest] = await db.execute<{ id: string; n: number }>(sql`
    select conversation_id as id, count(*)::int as n from messages where organization_id = ${ORG} group by 1 order by 2 desc limit 1`);
  a = performance.now();
  await listMessagesForOrg(ORG, biggest.id);
  after.thread = Math.round(performance.now() - a);
  a = performance.now();
  await funnelSignalsForOrg(ORG);
  after.signals = Math.round(performance.now() - a);

  const results = {
    fecha: new Date().toISOString(),
    mundo: { chats: world.chats.length, mensajes: worldMessages, historialImportable: historyMessages, telefonosNuevos: newPhones, agenda: world.contacts.length, contactosGhl: GHL_CONTACTS },
    corridas: Object.fromEntries(
      Object.entries(runs).map(([k, { ms, report }]) => [
        k,
        {
          segundos: Math.round(ms / 1000),
          conversaciones: report.conversaciones,
          procesadas: report.procesadas,
          reanudadas: report.reanudadas,
          importados: report.importados,
          duplicados: report.duplicados,
          contactos: report.contactos,
          ambiguos: report.ambiguos.length,
          sinTelefono: report.sinTelefono.length,
          grupos: report.grupos,
          agenda: report.agenda,
          avisosEnLote: report.avisosEnLote,
          peticiones: report.peticiones,
          cortado: report.cortado,
          terminado: report.terminado,
        },
      ]),
    ),
    resumenSimulacion: simulationSummary(simulation),
    resumenMuestra: simulationSummary(sample),
    verificacion: check,
    tiempoReal: { avisosDuranteImportacion: noticesDuringImport },
    bandejaDuranteImportacion: {
      muestras: probe.list.length,
      listaP50ms: percentile(probe.list, 50),
      listaP95ms: percentile(probe.list, 95),
      listaMaxMs: percentile(probe.list, 100),
      senalesEmbudoP95ms: percentile(probe.signals, 95),
      errores: probe.errors,
    },
    bandejaDespues: { primeraPaginaMs: after.list, filas: page.items.length, hiloMasGrande: { mensajes: biggest.n, ms: after.thread }, senalesEmbudoMs: after.signals },
    memoria: {
      rssBaseMB: Math.round(baseline.rss / 1e6),
      rssPicoMB: Math.round(peakRss / 1e6),
      heapBaseMB: Math.round(baseline.heapUsed / 1e6),
      heapPicoMB: Math.round(peakHeap / 1e6),
    },
    duracionTotalSegundos: Math.round((Date.now() - t0) / 1000),
    // Con Zernio real el cuello es su límite (60/min con 2 cuentas; el importador va a 40/min).
    estimacionConZernioReal: {
      peticionesPorCorrida: runs["1. simulación (--simular)"].report.peticiones.requests,
      minutosA40PorMinuto: Math.round(runs["1. simulación (--simular)"].report.peticiones.requests / 40),
      peticionesMuestra50: sample.peticiones.requests,
      minutosMuestra50A40PorMinuto: Math.round((sample.peticiones.requests / 40) * 10) / 10,
    },
  };
  mkdirSync(".historial", { recursive: true, mode: 0o700 });
  const out = `.historial/prueba-carga-${results.fecha.replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log("\n== resultados");
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nguardado en ${out}`);

  await listener.end();
  server.close();
  await (db.$client as unknown as { end: () => Promise<void> }).end();
}

main().catch((error: unknown) => {
  logError("[historial:prueba-carga]", error);
  process.exit(1);
});
