// Opciones del bot (sección "Opciones" de la pestaña Agente IA, 26-sep-2026) contra
// Postgres REAL: regresión (con los valores de fábrica todo es como antes) y una prueba
// por opción —espera, reactivar tras horas, asesor que pausa, horario con su apertura,
// imágenes y audios en "No", longitud, mensajes y tope con aviso amarillo—, más la caché
// del worker y el aislamiento por organización. Los modelos y WhatsApp son dobles; la BD,
// la cola (doble) y el envío (sendAgentText) siguen el camino real. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("Opciones del bot (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let run: typeof import("./run");
  let schedule: typeof import("./schedule");
  let sweep: typeof import("./sweep");
  let worker: typeof import("./worker");
  let hooks: typeof import("./hooks");
  let pause: typeof import("./pause");
  let manual: typeof import("./manual");
  let options: typeof import("./options");
  let brain: typeof import("./brain");
  let store: typeof import("@/lib/agente-ia/opciones-store");
  let opciones: typeof import("@/lib/agente-ia/opciones");
  let rules: typeof import("@/lib/scheduled/rules");
  let send: typeof import("@/lib/messaging/send");
  let executor: typeof import("@/lib/workflows/executor");
  let signals: typeof import("@/lib/contacts/funnel-signals");
  let transcribe: typeof import("@/lib/ai/transcription/transcribe");

  const ORG = "org_op";
  const OTRA = "org_op_otra";
  const CONV = "conv_op";
  const CONV2 = "conv_op_2";
  const CONTACT = "ct_op";
  const JOB = { organizationId: ORG, conversationId: CONV };
  const GOAL = "GOAL DE PRUEBA: eres Angela.";
  const HOUR = 3_600_000;
  const prevKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    run = await import("./run");
    schedule = await import("./schedule");
    sweep = await import("./sweep");
    worker = await import("./worker");
    hooks = await import("./hooks");
    pause = await import("./pause");
    manual = await import("./manual");
    options = await import("./options");
    brain = await import("./brain");
    store = await import("@/lib/agente-ia/opciones-store");
    opciones = await import("@/lib/agente-ia/opciones");
    rules = await import("@/lib/scheduled/rules");
    send = await import("@/lib/messaging/send");
    executor = await import("@/lib/workflows/executor");
    signals = await import("@/lib/contacts/funnel-signals");
    transcribe = await import("@/lib/ai/transcription/transcribe");
  });

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_config_changes, ai_usage, ai_agent_drafts, ai_agent_notices, ai_model_prices, ai_knowledge, ai_config, webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    options.clearBotOptionsCache();
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org-op", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "org-op-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_vendedor", name: "Daniel", email: "d@x.mx" });
    await db.insert(s.channels).values({ id: "ch_op", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_op", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values([
      { id: CONTACT, organizationId: ORG, firstName: "Cliente", phoneE164: "+526681112233" },
      { id: `${CONTACT}_2`, organizationId: ORG, firstName: "Otro", phoneE164: "+526681112234" },
    ]);
    for (const [id, contactId] of [
      [CONV, CONTACT],
      [CONV2, `${CONTACT}_2`],
    ]) {
      await db.insert(s.conversations).values({
        id,
        organizationId: ORG,
        contactId,
        channelId: "ch_op",
        providerConversationId: `zconv_${id}`,
        windowExpiresAt: new Date(Date.now() + 23 * HOUR),
        lastMessageAt: new Date(),
      });
    }
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", etapasModelo1: [], goal: GOAL });
    await db.insert(s.aiKnowledge).values([{ id: "k1", organizationId: ORG, ghlId: "g1", question: "¿Precio?", answer: "$5,500 MXN", position: 1 }]);
  });

  let seq = 0;
  async function msg(opts: {
    direction: "in" | "out";
    body: string;
    at: Date;
    conversationId?: string;
    source?: "contact" | "crm" | "business_app" | "ai_agent";
    attachments?: { type: string; url: string; storageKey?: string; mimeType?: string }[];
  }) {
    seq++;
    const id = `m_op_${seq}`;
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: opts.conversationId ?? CONV,
      direction: opts.direction,
      source: opts.source ?? (opts.direction === "in" ? "contact" : "crm"),
      type: "text",
      body: opts.body,
      attachments: opts.attachments ?? [],
      providerMessageId: `wamid.op.${seq}`,
      status: opts.direction === "in" ? "received" : "sent",
      sentByUserId: opts.source === "crm" || (!opts.source && opts.direction === "out") ? "u_vendedor" : null,
      sentAt: opts.at,
      createdAt: opts.at,
    });
    return id;
  }

  type Script = { brain?: string[]; toolCalls?: { toolName: string; input: unknown }[] };

  function fakeZernio() {
    const delivered: string[] = [];
    const accepted = new Map<string, { providerInternalId: string; providerMessageId: string }>();
    const provider = {
      name: "zernio",
      sendText: async ({ text, idempotencyKey }: { text: string; idempotencyKey: string }) => {
        const prev = accepted.get(idempotencyKey);
        if (prev) return prev;
        const res = { providerInternalId: `z_${crypto.randomUUID()}`, providerMessageId: `wamid.out.${crypto.randomUUID()}` };
        accepted.set(idempotencyKey, res);
        delivered.push(text);
        return res;
      },
    } as unknown as import("@/lib/messaging/provider").MessagingProvider;
    return { provider, delivered };
  }

  function makeDeps(script: Script = {}) {
    const zernio = fakeZernio();
    const calls: { modelId: string; input: CallModelInput }[] = [];
    const images: string[] = [];
    let n = 0;
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel: async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
        calls.push({ modelId, input });
        n++;
        const outputs = script.brain ?? ["Claro, cuesta $5,500 MXN.\n\n¿Cuánto mide tu entrada?"];
        return {
          modelId,
          provider: "anthropic",
          providerModelId: modelId,
          text: outputs[Math.min(n - 1, outputs.length - 1)],
          usage: { inputTokens: 1_000, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
          finishReason: "stop",
          toolCalls: script.toolCalls ?? [],
        };
      },
      sendBubble: (p) => send.sendAgentText(zernio.provider, p),
      sleep: async () => undefined,
      resolveImage: async (key) => {
        images.push(key);
        return `https://bucket.test/${key}?sig=1`;
      },
      startWorkflow: (input) => executor.startWorkflowRun(input),
      isModelAvailable: () => true,
    };
    return { deps, calls, images, delivered: zernio.delivered };
  }

  function fakeQueue() {
    const jobs = new Map<string, { state: string; delay: number }>();
    const port: import("./queue").AgentQueuePort = {
      getJob: async (id) =>
        jobs.has(id)
          ? {
              getState: async () => jobs.get(id)!.state,
              changeDelay: async (d) => {
                jobs.get(id)!.delay = d;
              },
              remove: async () => {
                jobs.delete(id);
              },
            }
          : undefined,
      add: async (_data, o) => {
        if (!jobs.has(o.jobId)) jobs.set(o.jobId, { state: o.delay > 0 ? "delayed" : "waiting", delay: o.delay });
      },
    };
    const kv: import("./queue").KvPort = { setNxPx: async () => true, setEx: async () => undefined, getDel: async () => null, delIfEquals: async () => undefined };
    return { port, kv, jobs };
  }

  const conv = async (id = CONV) => (await db.select().from(s.conversations).where(eq(s.conversations.id, id)))[0];
  const notices = () => db.select().from(s.aiAgentNotices).orderBy(s.aiAgentNotices.createdAt);
  const agentOuts = async () => (await db.select().from(s.messages).where(eq(s.messages.direction, "out"))).filter((m) => m.source === "ai_agent");
  const lastUser = (input: CallModelInput) => JSON.stringify(input.messages.at(-1)!.content);
  const set = (patch: import("@/lib/agente-ia/opciones").BotOptionsPatch, org = ORG) => store.saveBotOptions(org, "u_vendedor", patch);

  // Horario abierto/cerrado AHORA (hora de Mazatlán): el día de hoy dentro o fuera.
  function scheduleFor(open: boolean): import("@/lib/agente-ia/opciones").BotSchedule {
    const local = rules.instantToLocal(new Date());
    const [y, m, d] = local.slice(0, 10).split("-").map(Number);
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const today = js === 0 ? 7 : js;
    const other = today === 1 ? 2 : 1;
    return { days: [open ? today : other], from: "00:00", to: "23:59" };
  }

  // ── Regresión ────────────────────────────────────────────────────────────
  it("regresión: sin tocar ninguna opción, todo es como antes (15 s, 2 mensajes, pausa hasta Activar, asesor solo avisa, 24/7)", async () => {
    expect(await options.loadBotOptions(ORG)).toEqual(opciones.BOT_OPTIONS_DEFAULTS);
    expect(await options.loadBotOptions(OTRA)).toEqual(opciones.BOT_OPTIONS_DEFAULTS); // sin fila de ai_config
    const at = ago(2_000);
    await msg({ direction: "in", body: "hola, ¿precio?", at });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBe(15_000);
    const { deps, calls, delivered } = makeDeps({ toolCalls: [{ toolName: "aviso_vendedor", input: { motivo: "cliente_pide_humano", detalle: "Quiere una persona." } }] });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect(delivered).toEqual(["Claro, cuesta $5,500 MXN.", "¿Cuánto mide tu entrada?"]);
    expect(calls[0].input.system).toBe(brain.buildBrainSystemWithRuntime(GOAL, [{ question: "¿Precio?", answer: "$5,500 MXN", position: 1, enabled: true }]));
    // Pedir asesor: aviso y sigue activo.
    expect((await notices()).map((n) => n.kind)).toEqual(["cliente_pide_humano"]);
    expect((await conv()).agentState).toBe("activo");
    // Un vendedor contesta: pausa sin hora de regreso (hasta "Activar").
    await msg({ direction: "out", source: "crm", body: "Hola, soy Daniel", at: new Date() });
    await hooks.onHumanOutbound(JOB, { queue: fakeQueue().port });
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    // Sin cambios registrados.
    expect(await store.loadLastOptionsChange(ORG)).toBeNull();
  });

  // ── 1. Espera ────────────────────────────────────────────────────────────
  it("espera: con 5 s el job se programa a los 5 s; el worker relee en ≤ 60 s (caché) y el web al instante", async () => {
    await set({ responseDelaySeconds: 5 });
    const at = ago(1_000);
    await msg({ direction: "in", body: "hola", at });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBe(5_000);
    // Caché del worker: un cambio directo en la BD tarda hasta 60 s en verse…
    const t0 = new Date();
    options.clearBotOptionsCache(); // la lectura de arriba ya la había cacheado 1 s antes
    expect((await options.loadBotOptions(ORG, t0)).responseDelaySeconds).toBe(5);
    await db.update(s.aiConfig).set({ responseDelaySeconds: 30 }).where(eq(s.aiConfig.organizationId, ORG));
    expect((await options.loadBotOptions(ORG, new Date(t0.getTime() + 59_000))).responseDelaySeconds).toBe(5);
    expect((await options.loadBotOptions(ORG, new Date(t0.getTime() + 61_000))).responseDelaySeconds).toBe(30);
    // …pero guardar desde la pestaña borra la caché: se ve de inmediato.
    await set({ responseDelaySeconds: 60 });
    expect((await options.loadBotOptions(ORG, new Date(t0.getTime() + 62_000))).responseDelaySeconds).toBe(60);
    const last = await store.loadLastOptionsChange(ORG);
    expect(last).toMatchObject({ field: "responseDelaySeconds", oldValue: "30 s", newValue: "60 s", author: "Daniel" });
  });

  // ── 2. Pausa por vendedor y reactivación ─────────────────────────────────
  it("reactivar tras horas: el vendedor contesta → pausa con hora de regreso a las 8 h y el barrido lo regresa", async () => {
    await set({ humanReplyReactivateHours: 8 });
    const now = new Date();
    await msg({ direction: "out", source: "crm", body: "Hola, soy Daniel", at: now });
    await hooks.onHumanOutbound(JOB, { queue: fakeQueue().port, now });
    const c = await conv();
    expect(c.agentState).toBe("pausado_humano");
    expect(c.agentPausedUntil?.getTime()).toBe(now.getTime() + 8 * HOUR);
    // Antes de la hora no vuelve; a la hora, sí (el corte queda en la hora de regreso).
    expect(await pause.reactivateDuePauses(new Date(now.getTime() + 7 * HOUR))).toBe(0);
    expect(await pause.reactivateDuePauses(new Date(now.getTime() + 8 * HOUR + 1))).toBe(1);
    expect(await conv()).toMatchObject({ agentState: "activo", agentPausedUntil: null });
    expect((await conv()).agentStateChangedAt?.getTime()).toBe(now.getTime() + 8 * HOUR);
    // También cuando la pausa la deja la corrida del agente (vendedor contestó mientras generaba).
    await msg({ direction: "in", body: "¿precio?", at: new Date(now.getTime() + 9 * HOUR) });
    await msg({ direction: "out", source: "crm", body: "Te llamo", at: new Date(now.getTime() + 9 * HOUR + 1_000) });
    await msg({ direction: "in", body: "ok", at: new Date(now.getTime() + 9 * HOUR + 2_000) });
    const deps = makeDeps().deps;
    deps.now = () => new Date(now.getTime() + 9 * HOUR + 3_000);
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect((await conv()).agentPausedUntil?.getTime()).toBe(now.getTime() + 17 * HOUR + 3_000);
  });

  it("pausar cuando un vendedor contesta = No: el bot sigue activo y contesta lo que el cliente escriba después", async () => {
    await set({ pauseOnHumanReply: false });
    await msg({ direction: "in", body: "hola", at: ago(30_000) });
    await msg({ direction: "out", source: "crm", body: "Hola, soy Daniel", at: ago(20_000) });
    await hooks.onHumanOutbound(JOB, { queue: fakeQueue().port });
    expect((await conv()).agentState).toBe("activo");
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect(calls).toHaveLength(1);
    expect((await conv()).agentState).toBe("activo");
  });

  // ── 3. Pedir asesor ──────────────────────────────────────────────────────
  it("asesor que pausa 1 hora: avisa, le contesta al cliente y luego se pausa en ese chat hasta dentro de 1 h", async () => {
    await set({ handoverPauseHours: 1 });
    await msg({ direction: "in", body: "quiero hablar con una persona", at: ago(20_000) });
    const { deps, delivered } = makeDeps({ brain: ["Claro, en un momento te atiende un asesor."], toolCalls: [{ toolName: "aviso_vendedor", input: { motivo: "cliente_pide_humano", detalle: "Quiere una persona." } }] });
    const before = Date.now();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(delivered).toEqual(["Claro, en un momento te atiende un asesor."]);
    expect((await notices()).map((n) => n.kind)).toEqual(["cliente_pide_humano"]);
    const c = await conv();
    expect(c.agentState).toBe("pausado_humano");
    expect(c.agentPausedUntil!.getTime()).toBeGreaterThanOrEqual(before + HOUR);
    expect(c.agentPausedUntil!.getTime()).toBeLessThan(before + HOUR + 60_000);
    // Mientras, no contesta; a la hora, el barrido lo regresa.
    await msg({ direction: "in", body: "¿sigues ahí?", at: new Date() });
    expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "skipped", reason: "pausado_humano" });
    expect(await pause.reactivateDuePauses(new Date(before + HOUR + 60_000))).toBe(1);
    // Una respuesta SIN pedir asesor no pausa.
    await manual.reactivateAgentInConversation(ORG, CONV, new Date());
    await msg({ direction: "in", body: "¿precio?", at: new Date(Date.now() + 1_000) });
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
    expect((await conv()).agentState).toBe("activo");
  });

  // ── 4. Horario ───────────────────────────────────────────────────────────
  it("horario cerrado: no se programa ni contesta; al abrir, el barrido reparte los pendientes (hasta 24 h) cada 5 s", async () => {
    await set({ schedule: scheduleFor(false) });
    const m1 = await msg({ direction: "in", body: "hola", at: ago(2 * HOUR) }); // llegó con el bot cerrado
    await msg({ direction: "in", body: "buenas", at: ago(120_000), conversationId: CONV2 });
    expect(await schedule.debounceDelayFor(ORG, CONV, new Date())).toBeNull();
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "fuera_de_horario" });
    expect(calls).toHaveLength(0);
    expect((await conv()).agentState).toBe("activo"); // fuera de horario NO es pausa
    // Con horario, los huérfanos no los toca el barrido de siempre; sí los ve el de apertura.
    const now = new Date();
    expect(await sweep.findOrphanConversations(now)).toEqual([]);
    expect((await sweep.findPendingAtOpening(now)).map((o) => o.conversationId).sort()).toEqual([CONV, CONV2]);
    // Cerrado: el barrido no programa nada.
    const q = fakeQueue();
    await worker.sweepOnce(q.port, q.kv, now);
    expect(q.jobs.size).toBe(0);
    // Abre el horario: dos pendientes → uno ya y el otro 5 s después; el siguiente barrido no los empuja.
    await set({ schedule: scheduleFor(true) });
    await worker.sweepOnce(q.port, q.kv, new Date());
    expect([...q.jobs.values()].map((j) => j.delay).sort((a, b) => a - b)).toEqual([0, sweep.OPENING_STAGGER_MS]);
    await worker.sweepOnce(q.port, q.kv, new Date());
    expect([...q.jobs.values()].map((j) => j.delay).sort((a, b) => a - b)).toEqual([0, sweep.OPENING_STAGGER_MS]);
    // Y al correr, contesta el mensaje que llegó cerrado.
    const open = makeDeps();
    expect(await run.runAgent(JOB, open.deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect(open.calls[0].input.messages.at(-1)!.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("hola") })]));
    expect((await db.select().from(s.aiUsage).where(eq(s.aiUsage.messageId, m1))).map((u) => u.outcome)).toEqual(["sent"]);
    // Ya atendida, el barrido de apertura no la vuelve a listar; con la ventana cerrada tampoco.
    expect((await sweep.findPendingAtOpening(new Date())).map((o) => o.conversationId)).toEqual([CONV2]);
    await db.update(s.conversations).set({ windowExpiresAt: ago(1) }).where(eq(s.conversations.id, CONV2));
    expect(await sweep.findPendingAtOpening(new Date())).toEqual([]);
  });

  // ── 5. Imágenes y notas de voz ───────────────────────────────────────────
  it("imágenes en No: el modelo ve «[imagen]», no se firma la URL; audios en No: «[nota de voz]», sin esperar ni transcribir", async () => {
    await set({ readImages: false, transcribeAudio: false });
    await msg({ direction: "in", body: "mira mi cochera", at: ago(20_000), attachments: [{ type: "image", url: "/api/media/x", storageKey: "org/foto.jpg" }] });
    const audioId = await msg({ direction: "in", body: "", at: ago(10_000), attachments: [{ type: "audio", url: "/api/media/a", mimeType: "audio/ogg", storageKey: "org/nota.ogg" }] });
    const { deps, calls, images } = makeDeps();
    deps.transcriptionEnabled = true;
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 2 }); // sin "esperando_transcripcion"
    expect(images).toEqual([]);
    const last = lastUser(calls[0].input);
    expect(last).not.toContain('"type":"image"');
    expect(last).toContain("[imagen]");
    expect(last).toContain("[nota de voz]");
    expect(last).not.toContain("sin transcribir");
    // El worker tampoco transcribe (ni paga): queda "omitida" con su motivo.
    process.env.OPENAI_API_KEY = "sk-prueba";
    const storage = { getBytes: async () => { throw new Error("no debe leer el audio"); } } as unknown as import("@/lib/storage/s3").ObjectStorage;
    const t = await transcribe.transcribeMessageAudio(storage, audioId);
    expect(t).toMatchObject({ kind: "terminada", estado: "omitida" });
    const [m] = await db.select().from(s.messages).where(eq(s.messages.id, audioId));
    expect((m.metadata as { transcripcion: { estado: string; motivo: string } }).transcripcion).toMatchObject({ estado: "omitida", motivo: expect.stringContaining("apagadas") });
    expect(await db.select().from(s.aiUsage).where(eq(s.aiUsage.stage, "transcripcion"))).toEqual([]);
  });

  it("imágenes en Sí (fábrica): la imagen sí va al modelo como archivo", async () => {
    await msg({ direction: "in", body: "mira", at: ago(20_000), attachments: [{ type: "image", url: "/api/media/x", storageKey: "org/foto.jpg" }] });
    const { deps, calls, images } = makeDeps();
    expect((await run.runAgent(JOB, deps)).kind).toBe("sent");
    expect(images).toEqual(["org/foto.jpg"]);
    expect(lastUser(calls[0].input)).toContain('"type":"image"');
  });

  // ── 6. Longitud y mensajes ───────────────────────────────────────────────
  it("longitud: 'detallada' agrega una sola línea al final del system; 'corta' otra; el Goal y las FAQs no cambian", async () => {
    await set({ responseLength: "detallada" });
    await msg({ direction: "in", body: "¿precio?", at: ago(20_000) });
    const a = makeDeps();
    expect((await run.runAgent(JOB, a.deps)).kind).toBe("sent");
    const faqs = [{ question: "¿Precio?", answer: "$5,500 MXN", position: 1, enabled: true }];
    expect(a.calls[0].input.system).toBe(`${brain.buildBrainSystemWithRuntime(GOAL, faqs)}\n${brain.LENGTH_LINES.detallada}`);
    await set({ responseLength: "corta" });
    await msg({ direction: "in", body: "¿y el envío?", at: new Date(Date.now() + 1_000) });
    const b = makeDeps();
    expect((await run.runAgent(JOB, b.deps)).kind).toBe("sent");
    expect(b.calls[0].input.system.endsWith(brain.LENGTH_LINES.corta!)).toBe(true);
  });

  it("mensajes: con 1, la información y la pregunta salen en un solo mensaje", async () => {
    await set({ maxBubbles: 1 });
    await msg({ direction: "in", body: "¿precio?", at: ago(20_000) });
    const { deps, delivered } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(delivered).toEqual(["Claro, cuesta $5,500 MXN.\n\n¿Cuánto mide tu entrada?"]);
    expect(await agentOuts()).toHaveLength(1);
  });

  // ── 7. Tope de respuestas ────────────────────────────────────────────────
  it("tope de 2 respuestas: a la tercera se pausa hasta «Activar», deja el aviso 🤖 y la tarjeta del Embudo queda amarilla; «Activar» reinicia la cuenta", async () => {
    await set({ maxRepliesPerContact: 2 });
    for (let i = 1; i <= 2; i++) {
      await msg({ direction: "in", body: `pregunta ${i}`, at: new Date(Date.now() + i * 1_000) });
      expect((await run.runAgent(JOB, makeDeps({ brain: [`respuesta ${i}`] }).deps)).kind).toBe("sent");
    }
    await msg({ direction: "in", body: "pregunta 3", at: new Date(Date.now() + 3_000) });
    const third = makeDeps();
    expect(await run.runAgent(JOB, third.deps)).toEqual({ kind: "skipped", reason: "tope_respuestas" });
    expect(third.calls).toHaveLength(0); // no se paga otra llamada
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    const n = (await notices()).filter((x) => x.kind === "tope_respuestas");
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain("máximo de respuestas (2)");
    expect((await signals.funnelSignalsForOrg(ORG))[CONTACT]).toMatchObject({ urgent: true });
    expect(signals.URGENT_NOTICE_KINDS).toContain("tope_respuestas");
    // Otra corrida (barrido, cola) no repite el aviso ni llama al modelo.
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("skipped");
    expect((await notices()).filter((x) => x.kind === "tope_respuestas")).toHaveLength(1);
    // «Activar»: la cuenta empieza de cero desde el corte; el siguiente mensaje se contesta.
    await manual.reactivateAgentInConversation(ORG, CONV, new Date());
    await msg({ direction: "in", body: "pregunta 4", at: new Date(Date.now() + 5_000) });
    expect((await run.runAgent(JOB, makeDeps({ brain: ["respuesta 4"] }).deps)).kind).toBe("sent");
    expect((await conv()).agentState).toBe("activo");
    // Sin tope (fábrica) no pasa nada aunque haya muchas respuestas.
    await set({ maxRepliesPerContact: null });
    await msg({ direction: "in", body: "pregunta 5", at: new Date(Date.now() + 7_000) });
    expect((await run.runAgent(JOB, makeDeps({ brain: ["respuesta 5"] }).deps)).kind).toBe("sent");
  });

  // ── Aislamiento por organización ─────────────────────────────────────────
  it("aislamiento: las opciones y los cambios de una organización no tocan a la otra", async () => {
    await set({ responseDelaySeconds: 5, maxRepliesPerContact: 3 });
    expect(await options.loadBotOptions(OTRA)).toEqual(opciones.BOT_OPTIONS_DEFAULTS);
    expect(await store.loadBotOptionsRow(OTRA)).toEqual(opciones.BOT_OPTIONS_DEFAULTS);
    expect(await store.loadLastOptionsChange(OTRA)).toBeNull();
    await set({ responseDelaySeconds: 20 }, OTRA); // crea su propia fila de ai_config
    expect((await options.loadBotOptions(ORG)).responseDelaySeconds).toBe(5);
    expect((await options.loadBotOptions(OTRA)).responseDelaySeconds).toBe(20);
    const changes = await db.select().from(s.aiConfigChanges);
    expect(changes.filter((c) => c.organizationId === ORG).map((c) => c.field).sort()).toEqual(["maxRepliesPerContact", "responseDelaySeconds"]);
    expect(changes.filter((c) => c.organizationId === OTRA).map((c) => c.field)).toEqual(["responseDelaySeconds"]);
    // Guardar el mismo valor no deja registro.
    await set({ responseDelaySeconds: 5 });
    expect((await db.select().from(s.aiConfigChanges)).length).toBe(changes.length);
    // Un valor imposible en la BD (editado a mano) cae al de fábrica, nunca rompe al bot.
    await db.update(s.aiConfig).set({ responseLength: "rara", maxBubbles: 7, responseDelaySeconds: 999 }).where(eq(s.aiConfig.organizationId, ORG));
    options.clearBotOptionsCache();
    expect(await options.loadBotOptions(ORG)).toMatchObject({ responseLength: "balanceada", maxBubbles: 2, responseDelaySeconds: 15 });
  });
});
