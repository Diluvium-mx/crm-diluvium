// "Apagar bot" por conversación contra Postgres REAL: pausa con hora de regreso,
// reactivación sola (barrido del worker), "Reactivar" a mano, la regla de "solo
// mensajes nuevos", el temporizador que se respeta y el aislamiento por
// organización. Los modelos y WhatsApp son dobles; la BD, la cola (doble) y el
// envío (sendTextMessage) siguen el camino real. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("Apagar bot por conversación (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let run: typeof import("./run");
  let pause: typeof import("./pause");
  let manual: typeof import("./manual");
  let hooks: typeof import("./hooks");
  let sweep: typeof import("./sweep");
  let worker: typeof import("./worker");
  let queue: typeof import("./queue");
  let send: typeof import("@/lib/messaging/send");
  let executor: typeof import("@/lib/workflows/executor");

  const ORG = "org_ab";
  const OTHER_ORG = "org_ab_otra";
  const CONV = "conv_ab";
  const CONV2 = "conv_ab_2";
  const HOUR = 3_600_000;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    run = await import("./run");
    pause = await import("./pause");
    manual = await import("./manual");
    hooks = await import("./hooks");
    sweep = await import("./sweep");
    worker = await import("./worker");
    queue = await import("./queue");
    send = await import("@/lib/messaging/send");
    executor = await import("@/lib/workflows/executor");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);

  async function seedOrg(org: string, channel: string, convs: string[]) {
    await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
    await db.insert(s.channels).values({
      id: channel,
      organizationId: org,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: `zacc_${channel}`,
      displayName: "Diluvium",
      aiAgentMode: "auto",
    });
    for (const [i, id] of convs.entries()) {
      await db.insert(s.contacts).values({ id: `ct_${id}`, organizationId: org, firstName: "Cliente", phoneE164: `+52668111223${i}` });
      await db.insert(s.conversations).values({
        id,
        organizationId: org,
        contactId: `ct_${id}`,
        channelId: channel,
        providerConversationId: `zconv_${id}`,
        windowExpiresAt: new Date(Date.now() + 23 * HOUR),
        lastMessageAt: new Date(),
      });
    }
    await db.insert(s.aiConfig).values({ organizationId: org, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL: eres Angela." });
  }

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, ai_agent_notices, ai_model_prices, ai_knowledge, ai_config, webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@ab.mx" });
    await seedOrg(ORG, "ch_ab", [CONV, CONV2]);
  });

  let seq = 0;
  // `at` = llegada al CRM (created_at); `sentAt` = cuando el cliente lo escribió (WhatsApp).
  async function msg(conversationId: string, opts: { direction: "in" | "out"; body: string; at: Date; sentAt?: Date; org?: string }) {
    seq++;
    const id = `m_ab_${seq}`;
    await db.insert(s.messages).values({
      id,
      organizationId: opts.org ?? ORG,
      conversationId,
      direction: opts.direction,
      source: opts.direction === "in" ? "contact" : "crm",
      type: "text",
      body: opts.body,
      attachments: [],
      providerMessageId: `wamid.ab.${seq}`,
      status: opts.direction === "in" ? "received" : "sent",
      sentByUserId: opts.direction === "out" ? "u_vendedor" : null,
      sentAt: opts.sentAt ?? opts.at,
      createdAt: opts.at,
    });
    return id;
  }

  function makeDeps() {
    let brainCalls = 0;
    const callModel = async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
      void input;
      brainCalls++;
      return {
        modelId,
        provider: "anthropic",
        providerModelId: modelId,
        text: "Claro, cuesta $5,500 MXN.",
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        finishReason: "stop",
        toolCalls: [],
      };
    };
    const provider = {
      name: "zernio",
      sendText: async () => ({ providerInternalId: `z_${crypto.randomUUID()}`, providerMessageId: `wamid.out.${crypto.randomUUID()}` }),
    } as unknown as import("@/lib/messaging/provider").MessagingProvider;
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel,
      sendBubble: (p) => send.sendTextMessage(provider, { ...p, source: "ai_agent", sentByUserId: null }),
      sleep: async () => undefined,
      resolveImage: async () => null,
      startWorkflow: (input) => executor.startWorkflowRun(input),
    };
    return { deps, brainCalls: () => brainCalls };
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
    const kv: import("./queue").KvPort = {
      setNxPx: async () => true,
      setEx: async () => undefined,
      getDel: async () => null,
      delIfEquals: async () => undefined,
    };
    return { port, kv, jobs };
  }

  const conv = async (id = CONV) => (await db.select().from(s.conversations).where(eq(s.conversations.id, id)))[0];
  const agentOuts = async (id = CONV) =>
    (await db.select().from(s.messages).where(eq(s.messages.conversationId, id))).filter((m) => m.source === "ai_agent");
  const job = (conversationId = CONV, organizationId = ORG) => ({ organizationId, conversationId });
  const inbound = (conversationId: string, at: Date, q: ReturnType<typeof fakeQueue>, messageId?: string, now = at) =>
    hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId, receivedAt: at, messageId }, { queue: q.port, kv: q.kv, now });

  it("apagar → el cliente escribe → no contesta (y el job que ya estaba programado se cancela)", async () => {
    const q = fakeQueue();
    await msg(CONV, { direction: "in", body: "hola", at: ago(5_000) });
    await queue.scheduleAgentRun(q.port, q.kv, job(), 15_000);
    const now = new Date();
    expect(await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: new Date(now.getTime() + 8 * HOUR), now }, { queue: q.port })).toBe(true);
    expect(q.jobs.size).toBe(0);
    const c = await conv();
    expect(c).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: new Date(now.getTime() + 8 * HOUR), agentStateChangedAt: now });

    const at = new Date();
    const id = await msg(CONV, { direction: "in", body: "¿precio?", at });
    await inbound(CONV, at, q, id);
    expect(q.jobs.size).toBe(0);
    const { deps, brainCalls } = makeDeps();
    expect(await run.runAgent(job(), deps)).toEqual({ kind: "skipped", reason: "pausado_humano" });
    expect(brainCalls()).toBe(0);
    expect(await agentOuts()).toHaveLength(0);
  });

  it("apagarlo mientras el agente escribe: la respuesta ya no sale", async () => {
    await msg(CONV, { direction: "in", body: "¿precio?", at: ago(20_000) });
    const { deps } = makeDeps();
    const q = fakeQueue();
    const inner = deps.callModel;
    deps.callModel = async (id, input) => {
      await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: null, now: new Date() }, { queue: q.port });
      return inner(id, input);
    };
    expect(await run.runAgent(job(), deps)).toEqual({ kind: "skipped", reason: "cambio_antes_de_enviar" });
    expect(await agentOuts()).toHaveLength(0);
  });

  it("vence el tiempo → el barrido lo pasa a activo → el cliente escribe → sí contesta", async () => {
    const q = fakeQueue();
    const pausedAt = ago(8 * HOUR + 120_000);
    const until = new Date(pausedAt.getTime() + 8 * HOUR);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: pausedAt }, { queue: q.port });
    const now = new Date();
    await worker.sweepOnce(q.port, q.kv, now);
    // El corte es la hora de regreso prometida, no la del barrido.
    expect(await conv()).toMatchObject({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: until });
    expect(q.jobs.size).toBe(0); // reactivarse no contesta nada por sí solo

    const at = new Date(now.getTime() + 1_000);
    const id = await msg(CONV, { direction: "in", body: "¿siguen ahí?", at });
    await inbound(CONV, at, q, id);
    expect(q.jobs.get(CONV)).toMatchObject({ delay: 15_000 });
    const { deps } = makeDeps();
    expect(await run.runAgent(job(), deps)).toEqual({ kind: "sent", bubbles: 1 });
  });

  it("lo que el cliente escribió durante la pausa NO se contesta al reactivar, ni tras un reinicio del worker", async () => {
    const q = fakeQueue();
    const pausedAt = ago(20 * 60_000);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: ago(60_000), now: pausedAt }, { queue: q.port });
    // Durante la pausa: el gancho no programa nada.
    const during = ago(10 * 60_000);
    const duringId = await msg(CONV, { direction: "in", body: "¿me pasas el precio?", at: during });
    await inbound(CONV, during, q, duringId);
    expect(q.jobs.size).toBe(0);
    // Sin pausa, ese entrante sería un huérfano para el barrido (entre 90 s y 30 min).
    // Barrido (igual tras reiniciar el worker): reactiva y NO lo recoge.
    const now = new Date();
    await worker.sweepOnce(q.port, q.kv, now);
    expect((await conv()).agentState).toBe("activo");
    expect(q.jobs.size).toBe(0);
    // Control: lo que lo deja fuera es el corte (agent_state_changed_at = hora de regreso).
    const cut = (await conv()).agentStateChangedAt;
    await db.update(s.conversations).set({ agentStateChangedAt: pausedAt }).where(eq(s.conversations.id, CONV));
    expect(await sweep.findOrphanConversations(now)).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    await db.update(s.conversations).set({ agentStateChangedAt: cut }).where(eq(s.conversations.id, CONV));
    // Otro barrido minutos después (otro reinicio): sigue sin recogerlo.
    expect(await sweep.findOrphanConversations(new Date(now.getTime() + 5 * 60_000))).toEqual([]);
    await worker.sweepOnce(q.port, q.kv, new Date(now.getTime() + 5 * 60_000));
    expect(q.jobs.size).toBe(0);
    // A partir del siguiente mensaje del cliente, sí contesta.
    const at = new Date(now.getTime() + 1_000);
    const id = await msg(CONV, { direction: "in", body: "hola?", at });
    await inbound(CONV, at, q, id);
    expect(q.jobs.has(CONV)).toBe(true);
    const { deps } = makeDeps();
    expect((await run.runAgent(job(), deps)).kind).toBe("sent");
  });

  it("webhook retrasado: un mensaje ESCRITO con el bot apagado que llega después de la hora de regreso no se contesta", async () => {
    const q = fakeQueue();
    const until = ago(5_000);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: ago(HOUR) }, { queue: q.port });
    // Escrito 3 s antes de la hora de regreso, llega 5 s después (barrido aún sin pasar).
    const late = await msg(CONV, { direction: "in", body: "¿precio?", at: new Date(), sentAt: new Date(until.getTime() - 3_000) });
    await inbound(CONV, new Date(), q, late);
    expect((await conv()).agentState).toBe("pausado_humano"); // no lo reactiva ese mensaje
    expect(q.jobs.size).toBe(0);
    // El barrido lo reactiva con corte = hora de regreso, y el huérfano no lo recoge.
    await worker.sweepOnce(q.port, q.kv, new Date());
    expect(await conv()).toMatchObject({ agentState: "activo", agentStateChangedAt: until });
    expect(await sweep.findOrphanConversations(new Date(Date.now() + 2 * 60_000))).toEqual([]);
    // Otro escrito durante la pausa que llega ya con el bot activo: tampoco.
    const later = await msg(CONV, { direction: "in", body: "¿hola?", at: new Date(), sentAt: new Date(until.getTime() - 1_000) });
    await inbound(CONV, new Date(), q, later);
    expect(q.jobs.size).toBe(0);
    expect(await sweep.findOrphanConversations(new Date(Date.now() + 2 * 60_000))).toEqual([]);
    // Uno escrito después del regreso sí.
    const fresh = await msg(CONV, { direction: "in", body: "¿siguen?", at: new Date() });
    await inbound(CONV, new Date(), q, fresh);
    expect(q.jobs.has(CONV)).toBe(true);
  });

  it("si la cola falla justo al reactivar por un mensaje nuevo, el barrido de huérfanos lo rescata", async () => {
    const q = fakeQueue();
    const until = ago(20_000);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: ago(HOUR) }, { queue: q.port });
    const at = new Date();
    const id = await msg(CONV, { direction: "in", body: "¿precio?", at });
    const broken = { ...q.port, add: async () => { throw new Error("Redis caído"); } };
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at, messageId: id }, { queue: broken, kv: q.kv, now: at });
    } finally {
      console.error = quiet;
    }
    expect(await conv()).toMatchObject({ agentState: "activo", agentStateChangedAt: until });
    expect(q.jobs.size).toBe(0);
    // 90 s después el barrido lo recoge (el mensaje es posterior al corte).
    expect(await sweep.findOrphanConversations(new Date(at.getTime() + 2 * 60_000))).toEqual([{ conversationId: CONV, organizationId: ORG }]);
  });

  it("si el cliente escribe DESPUÉS de la hora de regreso pero antes del barrido, sí contesta", async () => {
    const q = fakeQueue();
    const until = ago(10_000);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: ago(HOUR) }, { queue: q.port });
    const at = new Date();
    const id = await msg(CONV, { direction: "in", body: "¿precio?", at });
    await inbound(CONV, at, q, id);
    expect(await conv()).toMatchObject({ agentState: "activo", agentStateChangedAt: until });
    expect(q.jobs.has(CONV)).toBe(true);
    const { deps } = makeDeps();
    expect((await run.runAgent(job(), deps)).kind).toBe("sent");
  });

  it("el vendedor escribe con el bot apagado por tiempo → la hora de regreso NO cambia; al volver, contesta", async () => {
    const q = fakeQueue();
    const pausedAt = ago(HOUR);
    const until = new Date(pausedAt.getTime() + 8 * HOUR);
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: pausedAt }, { queue: q.port });
    await msg(CONV, { direction: "in", body: "hola", at: ago(40_000) });
    await msg(CONV, { direction: "out", body: "Hola, soy Luis", at: ago(30_000) });
    await hooks.onHumanOutbound({ organizationId: ORG, conversationId: CONV }, { queue: q.port, kv: q.kv });
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: until, agentStateChangedAt: pausedAt });
    // La corrida tampoco la toca.
    await msg(CONV, { direction: "in", body: "¿precio?", at: ago(20_000) });
    const { deps } = makeDeps();
    expect((await run.runAgent(job(), deps)).kind).toBe("skipped");
    expect(await conv()).toMatchObject({ agentPausedUntil: until, agentStateChangedAt: pausedAt });

    // Se cumple la hora (se simula adelantándola): el mensaje del vendedor, anterior
    // al regreso, no lo vuelve a pausar.
    await db.update(s.conversations).set({ agentPausedUntil: ago(5_000) }).where(eq(s.conversations.id, CONV));
    expect(await pause.reactivateDuePauses(new Date())).toBe(1);
    await msg(CONV, { direction: "in", body: "¿siguen ahí?", at: new Date(Date.now() + 1_000) });
    expect((await run.runAgent(job(), makeDeps().deps)).kind).toBe("sent");
  });

  it("si el vendedor escribe después de la hora de regreso (antes del barrido), queda apagado sin tiempo, como hoy", async () => {
    const q = fakeQueue();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: ago(10_000), now: ago(HOUR) }, { queue: q.port });
    await msg(CONV, { direction: "out", body: "Yo te atiendo", at: new Date() });
    await hooks.onHumanOutbound({ organizationId: ORG, conversationId: CONV }, { queue: q.port, kv: q.kv });
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    expect(await pause.reactivateDuePauses(new Date())).toBe(0);
  });

  it("carrera: si otro vendedor eligió una hora justo antes, la pausa por respuesta humana no la borra", async () => {
    const q = fakeQueue();
    const until = new Date(Date.now() + 8 * HOUR);
    // onHumanOutbound leyó "activo", pero antes de escribir alguien apagó el bot 8 h.
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until, now: new Date() }, { queue: q.port });
    expect(await pause.pauseForHumanReply(ORG, CONV, new Date())).toBe(false);
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: until });
    // Encendido (o con la hora cumplida) sí lo apaga sin tiempo; nunca en otra organización.
    await manual.reactivateAgentInConversation(ORG, CONV, new Date());
    expect(await pause.pauseForHumanReply("org_ajena", CONV, new Date())).toBe(false);
    expect(await pause.pauseForHumanReply(ORG, CONV, new Date())).toBe(true);
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
  });

  it("el vendedor contesta sin usar el botón: se apaga sin tiempo y solo vuelve con Reactivar", async () => {
    const q = fakeQueue();
    await msg(CONV, { direction: "out", body: "Hola", at: new Date() });
    await hooks.onHumanOutbound({ organizationId: ORG, conversationId: CONV }, { queue: q.port, kv: q.kv });
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    expect(await pause.reactivateDuePauses(new Date(Date.now() + 90 * 24 * HOUR))).toBe(0);
  });

  it("'hasta que lo reactive' no vuelve solo (ni el barrido ni un mensaje nuevo)", async () => {
    const q = fakeQueue();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: null, now: ago(40 * 24 * HOUR) }, { queue: q.port });
    expect(await pause.reactivateDuePauses(new Date())).toBe(0);
    await worker.sweepOnce(q.port, q.kv, new Date());
    const at = new Date();
    const id = await msg(CONV, { direction: "in", body: "hola", at });
    await inbound(CONV, at, q, id);
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    expect(q.jobs.size).toBe(0);
  });

  it("'Reactivar' antes de tiempo funciona y el barrido ya no hace nada", async () => {
    const q = fakeQueue();
    const now = new Date();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: new Date(now.getTime() + 8 * HOUR), now: ago(60_000) }, { queue: q.port });
    expect(await manual.reactivateAgentInConversation(ORG, CONV, now)).toBe(true);
    expect(await conv()).toMatchObject({ agentState: "activo", agentPausedUntil: null, agentStateChangedAt: now });
    expect(await pause.reactivateDuePauses(new Date(now.getTime() + 9 * HOUR))).toBe(0);
    const at = new Date(now.getTime() + 1_000);
    const id = await msg(CONV, { direction: "in", body: "¿precio?", at });
    await inbound(CONV, at, q, id);
    expect(q.jobs.has(CONV)).toBe(true);
    expect((await run.runAgent(job(), makeDeps().deps)).kind).toBe("sent");
  });

  it("cambiar la hora con el bot ya apagado reemplaza la hora de regreso", async () => {
    const q = fakeQueue();
    const now = new Date();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: null, now: ago(60_000) }, { queue: q.port });
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: new Date(now.getTime() + 12 * HOUR), now }, { queue: q.port });
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: new Date(now.getTime() + 12 * HOUR) });
  });

  it("otra conversación sigue respondiendo mientras una está apagada", async () => {
    const q = fakeQueue();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: new Date(Date.now() + 8 * HOUR), now: new Date() }, { queue: q.port });
    const at = new Date();
    const a = await msg(CONV, { direction: "in", body: "¿precio?", at });
    const b = await msg(CONV2, { direction: "in", body: "¿precio?", at });
    await inbound(CONV, at, q, a);
    await inbound(CONV2, at, q, b);
    expect([...q.jobs.keys()]).toEqual([CONV2]);
    expect((await run.runAgent(job(CONV), makeDeps().deps)).kind).toBe("skipped");
    expect(await run.runAgent(job(CONV2), makeDeps().deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(await agentOuts(CONV)).toHaveLength(0);
    expect(await agentOuts(CONV2)).toHaveLength(1);
    expect((await conv(CONV2)).agentState).toBe("activo");
  });

  it("aislamiento por organización: apagar, reactivar y el barrido no cruzan organizaciones", async () => {
    await seedOrg(OTHER_ORG, "ch_ab_otra", ["conv_ab_otra"]);
    const q = fakeQueue();
    // Otra organización no puede apagar ni reactivar una conversación ajena.
    expect(await pause.pauseAgentManually({ organizationId: OTHER_ORG, conversationId: CONV, until: null, now: new Date() }, { queue: q.port })).toBe(false);
    expect((await conv()).agentState).toBe("activo");
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: ago(1_000), now: ago(HOUR) }, { queue: q.port });
    expect(await pause.reactivateDuePause(OTHER_ORG, CONV, new Date())).toBe(false);
    expect((await conv()).agentState).toBe("pausado_humano");
    // El barrido reactiva cada una en SU organización; una pausa aún vigente se queda.
    await pause.pauseAgentManually({ organizationId: OTHER_ORG, conversationId: "conv_ab_otra", until: ago(1_000), now: ago(HOUR) }, { queue: q.port });
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV2, until: new Date(Date.now() + HOUR), now: new Date() }, { queue: q.port });
    expect(await pause.reactivateDuePauses(new Date())).toBe(2);
    expect((await conv()).agentState).toBe("activo");
    expect((await conv("conv_ab_otra")).agentState).toBe("activo");
    expect((await conv(CONV2)).agentState).toBe("pausado_humano");
    // Lectura para la UI: solo con la organización dueña.
    expect(await manual.loadConversationAgent(OTHER_ORG, CONV2)).toBeNull();
    expect(await manual.loadConversationAgent(ORG, CONV2)).toMatchObject({ agentState: "pausado_humano" });
  });
});
