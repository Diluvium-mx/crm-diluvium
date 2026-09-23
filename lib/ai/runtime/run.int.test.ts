// Runtime del Agente IA contra Postgres REAL (Fase B): orquestador, compuertas,
// debounce, pausas, borrador, idempotencia, uso/costo y barrido. Los modelos y
// el proveedor de WhatsApp son dobles; la BD y el envío (sendTextMessage) son
// los reales. Solo corre con TEST_DATABASE_URL apuntando a una base
// DESECHABLE con las migraciones aplicadas. Nunca a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("runtime del Agente IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let run: typeof import("./run");
  let filter: typeof import("./filter");
  let schedule: typeof import("./schedule");
  let queue: typeof import("./queue");
  let sweep: typeof import("./sweep");
  let hooks: typeof import("./hooks");
  let state: typeof import("./state");
  let send: typeof import("@/lib/messaging/send");

  const ORG = "org_rt";
  const CONV = "conv_rt";
  const CONTACT = "contact_rt";
  const GOAL = "GOAL DE PRUEBA: eres Angela.";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    run = await import("./run");
    filter = await import("./filter");
    schedule = await import("./schedule");
    queue = await import("./queue");
    sweep = await import("./sweep");
    hooks = await import("./hooks");
    state = await import("./state");
    send = await import("@/lib/messaging/send");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, ai_model_prices, ai_knowledge, ai_config, webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_rt",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_rt",
      displayName: "Diluvium",
      aiAgentMode: "auto",
    });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Cliente", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: "ch_rt",
      providerConversationId: "zconv_rt",
      windowExpiresAt: new Date(Date.now() + 23 * 3_600_000),
      lastMessageAt: new Date(),
    });
    await db.insert(s.aiConfig).values({
      organizationId: ORG,
      modeloFiltro: "gpt-5.6-luna",
      modeloCerebro: "claude-sonnet-5",
      goal: GOAL,
    });
    await db.insert(s.aiKnowledge).values([
      { id: "k1", organizationId: ORG, ghlId: "g1", question: "¿Precio?", answer: "$5,500 MXN", position: 1 },
      { id: "k2", organizationId: ORG, ghlId: "g2", question: "¿Dónde?", answer: "Los Mochis", position: 2 },
    ]);
  });

  let seq = 0;
  async function msg(opts: {
    direction: "in" | "out";
    body: string;
    at: Date;
    source?: "contact" | "crm" | "business_app" | "ai_agent";
    attachments?: { type: string; url: string; storageKey?: string }[];
  }) {
    seq++;
    const id = `m_${seq}`;
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: CONV,
      direction: opts.direction,
      source: opts.source ?? (opts.direction === "in" ? "contact" : "crm"),
      type: "text",
      body: opts.body,
      attachments: opts.attachments ?? [],
      providerMessageId: `wamid.rt.${seq}`,
      status: opts.direction === "in" ? "received" : "sent",
      sentByUserId: opts.source === "crm" || (!opts.source && opts.direction === "out") ? "u_vendedor" : null,
      sentAt: opts.at,
      createdAt: opts.at,
    });
    return id;
  }

  type Script = {
    filter?: string; // JSON de decisión
    brain?: string[]; // una salida por llamada al cerebro
    onBrain?: (call: number) => Promise<void>; // efecto durante la generación
  };

  function fakeModels(script: Script) {
    const calls: { kind: "filtro" | "cerebro"; input: CallModelInput }[] = [];
    let brainCalls = 0;
    const callModel = async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
      if (input.system === filter.FILTER_SYSTEM) {
        calls.push({ kind: "filtro", input });
        return {
          modelId,
          provider: "openai",
          providerModelId: modelId,
          text: script.filter ?? '{"decision":"necesita_cerebro"}',
          usage: { inputTokens: 300, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
          finishReason: "stop",
        };
      }
      calls.push({ kind: "cerebro", input });
      brainCalls++;
      if (script.onBrain) await script.onBrain(brainCalls);
      const outputs = script.brain ?? ["Claro, cuesta $5,500 MXN.\n\n¿Cuánto mide tu entrada?"];
      return {
        modelId,
        provider: "anthropic",
        providerModelId: modelId,
        text: outputs[Math.min(brainCalls - 1, outputs.length - 1)],
        usage: { inputTokens: 12_000, outputTokens: 60, cacheReadTokens: 11_400, cacheWriteTokens: 0 },
        finishReason: "stop",
      };
    };
    return { calls, callModel };
  }

  function makeDeps(script: Script = {}) {
    const models = fakeModels(script);
    const sleeps: number[] = [];
    const images: string[] = [];
    const provider = {
      name: "zernio",
      sendText: async () => ({ providerInternalId: `z_${crypto.randomUUID()}`, providerMessageId: `wamid.out.${crypto.randomUUID()}` }),
    } as unknown as import("@/lib/messaging/provider").MessagingProvider;
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel: models.callModel,
      sendBubble: async (p) => {
        await send.sendTextMessage(provider, { ...p, source: "ai_agent", sentByUserId: null });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      resolveImage: async (key) => {
        images.push(key);
        return `https://bucket.test/${key}?sig=1`;
      },
    };
    return { deps, calls: models.calls, sleeps, images };
  }

  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, CONV)))[0];
  const usage = () => db.select().from(s.aiUsage);
  const agentOuts = async () =>
    (await db.select().from(s.messages).where(eq(s.messages.direction, "out"))).filter((m) => m.source === "ai_agent");

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

  it("3 mensajes en 5 s → UN job (debounce deslizante) y UNA respuesta que cubre los 3", async () => {
    const { port, kv, jobs } = fakeQueue();
    const t1 = ago(10_000);
    const texts = ["Hola", "¿cuánto cuesta?", "es para una cochera"];
    for (let i = 0; i < 3; i++) {
      const at = new Date(t1.getTime() + i * 2_000);
      await msg({ direction: "in", body: texts[i], at });
      const delay = await schedule.debounceDelayFor(CONV, at);
      expect(delay).toBe(15_000); // cada entrante reinicia la espera de 15 s
      await queue.scheduleAgentRun(port, kv, { conversationId: CONV, organizationId: ORG }, delay!);
    }
    expect(jobs.size).toBe(1);

    const { deps, calls, sleeps } = makeDeps();
    const r = await run.runAgent(CONV, deps);
    expect(r).toEqual({ kind: "sent", bubbles: 2 });
    expect(calls.map((c) => c.kind)).toEqual(["filtro", "cerebro"]);
    // El cerebro recibió los 3 pendientes juntos, en el último turno del cliente.
    const last = calls[1].input.messages.at(-1)!;
    expect(JSON.stringify(last.content)).toContain("Hola");
    expect(JSON.stringify(last.content)).toContain("es para una cochera");
    // System = Goal + FAQs (+ sufijo del CRM).
    expect(calls[1].input.system.startsWith(GOAL)).toBe(true);
    expect(calls[1].input.system).toContain("P: ¿Precio?\nR: $5,500 MXN");
    // Dos burbujas del agente con UNA pausa de 1.5 s entre ellas.
    const outs = await agentOuts();
    expect(outs.map((m) => m.body)).toEqual(["Claro, cuesta $5,500 MXN.", "¿Cuánto mide tu entrada?"]);
    expect(outs.every((m) => m.sentByUserId === null)).toBe(true);
    expect(sleeps).toEqual([run.BUBBLE_PAUSE_MS]);
    expect((await conv()).lastAgentReplyAt).not.toBeNull();
    // Uso/costo por llamada.
    const u = await usage();
    expect(u.map((x) => [x.stage, x.outcome])).toEqual(
      expect.arrayContaining([
        ["filtro", "passed"],
        ["cerebro", "sent"],
      ]),
    );
    const brainRow = u.find((x) => x.stage === "cerebro")!;
    // 600 sin caché × $2 + 11,400 caché × $0.2 + 60 × $10 = 1,200 + 2,280 + 600 = 4,080 µ$
    expect(brainRow.costUsd).toBeCloseTo(0.00408, 8);
    expect(brainRow.cacheReadTokens).toBe(11_400);
    // Una segunda corrida no vuelve a responder.
    expect((await run.runAgent(CONV, deps)).kind).toBe("noop");
  });

  it("tope máximo: si el cliente sigue escribiendo, no espera más de 60 s desde el primero", async () => {
    const t1 = ago(60_000);
    await msg({ direction: "in", body: "a", at: t1 });
    await msg({ direction: "in", body: "b", at: new Date(t1.getTime() + 55_000) });
    expect(await schedule.debounceDelayFor(CONV, new Date(t1.getTime() + 55_000))).toBe(5_000);
  });

  it("mensaje nuevo durante la generación → descarta, regenera con TODO el contexto y envía solo la nueva", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(20_000) });
    const { deps, calls } = makeDeps({
      brain: ["respuesta vieja", "Cuesta $5,500 y sí enviamos a Monterrey."],
      onBrain: async (n) => {
        if (n === 1) await msg({ direction: "in", body: "¿envían a Monterrey?", at: new Date() });
      },
    });
    const r = await run.runAgent(CONV, deps);
    expect(r).toEqual({ kind: "sent", bubbles: 1 });
    expect(calls.map((c) => c.kind)).toEqual(["filtro", "cerebro", "filtro", "cerebro"]);
    expect(JSON.stringify(calls[3].input.messages)).toContain("¿envían a Monterrey?");
    expect((await agentOuts()).map((m) => m.body)).toEqual(["Cuesta $5,500 y sí enviamos a Monterrey."]);
    const outcomes = (await usage()).filter((x) => x.stage === "cerebro").map((x) => x.outcome);
    expect(outcomes.sort()).toEqual(["discarded_stale", "sent"]);
  });

  it("respuesta manual del vendedor → el agente se calla y queda pausado (sin llamar modelos)", async () => {
    await msg({ direction: "in", body: "hola", at: ago(30_000) });
    await msg({ direction: "out", source: "crm", body: "Hola, soy Luis", at: ago(20_000) });
    await msg({ direction: "in", body: "precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect(calls).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("el eco business_app (vendedor desde el celular) también pausa", async () => {
    await msg({ direction: "out", source: "business_app", body: "te marco", at: ago(20_000) });
    await msg({ direction: "in", body: "ok", at: ago(10_000) });
    const { deps } = makeDeps();
    expect((await run.runAgent(CONV, deps)).kind).toBe("skipped");
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("hook de respuesta humana: pausa y cancela el job pendiente", async () => {
    const { port, kv, jobs } = fakeQueue();
    await queue.scheduleAgentRun(port, kv, { conversationId: CONV, organizationId: ORG }, 15_000);
    await hooks.onHumanOutbound({ conversationId: CONV }, { queue: port, kv });
    expect(jobs.size).toBe(0);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("si un vendedor responde DURANTE la generación, no se envía nada y se pausa", async () => {
    await msg({ direction: "in", body: "precio?", at: ago(20_000) });
    const { deps } = makeDeps({
      onBrain: async () => {
        await msg({ direction: "out", source: "crm", body: "Yo te atiendo", at: new Date() });
      },
    });
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect(await agentOuts()).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("reactivación manual: lo que respondió el vendedor ANTES ya no vuelve a pausar", async () => {
    await msg({ direction: "in", body: "hola", at: ago(40_000) });
    await msg({ direction: "out", source: "crm", body: "Hola", at: ago(30_000) });
    await state.setAgentState(CONV, "activo", { now: ago(20_000) }); // botón "Reactivar agente"
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    expect((await run.runAgent(CONV, deps)).kind).toBe("sent");
  });

  it("modo borrador: deja el borrador (uno vigente) y NO envía", async () => {
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "precio?", at: ago(20_000) });
    const { deps } = makeDeps();
    const r1 = await run.runAgent(CONV, deps);
    expect(r1.kind).toBe("draft");
    expect(await agentOuts()).toHaveLength(0);
    await msg({ direction: "in", body: "¿y envío?", at: ago(5_000) });
    const r2 = await run.runAgent(CONV, deps);
    expect(r2.kind).toBe("draft");
    const drafts = await db.select().from(s.aiAgentDrafts);
    expect(drafts.map((d) => d.status).sort()).toEqual(["obsoleto", "pendiente"]);
    expect(drafts.find((d) => d.status === "pendiente")!.bubbles).toEqual([
      "Claro, cuesta $5,500 MXN.",
      "¿Cuánto mide tu entrada?",
    ]);
    expect((await usage()).filter((u) => u.outcome === "draft")).toHaveLength(2);
  });

  it("interruptor apagado = silencio total (ni programa ni llama modelos)", async () => {
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "hola", at: ago(20_000) });
    expect(await schedule.debounceDelayFor(CONV, new Date())).toBeNull();
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "canal_off" });
    expect(calls).toHaveLength(0);
  });

  it("fuera de la ventana de 24 h no responde", async () => {
    await db.update(s.conversations).set({ windowExpiresAt: ago(1_000) }).where(eq(s.conversations.id, CONV));
    await msg({ direction: "in", body: "hola", at: ago(20_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "fuera_de_ventana_24h" });
    expect(calls).toHaveLength(0);
  });

  it("freno anti-bucle: 10 respuestas en la última hora → pausa + etiqueta 'revisión humana'", async () => {
    await db.insert(s.aiUsage).values(
      Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        organizationId: ORG,
        conversationId: CONV,
        stage: "cerebro" as const,
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        latencyMs: 1,
        outcome: "sent",
        createdAt: ago((i + 1) * 60_000),
      })),
    );
    await msg({ direction: "in", body: "hola?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "anti_bucle" });
    expect(calls).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_antibucle");
    const [c] = await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT));
    expect(c.tags).toContain("revisión humana");
  });

  it("los timeouts de las 3 rondas (filtro + cerebro) caben en el candado de la corrida", async () => {
    const { LOCK_TTL_MS } = await import("./process");
    expect(run.MAX_ROUNDS * (run.FILTER_TIMEOUT_MS + run.BRAIN_TIMEOUT_MS)).toBeLessThan(LOCK_TTL_MS);
  });

  it("cliente que escribe sin parar: nunca bucle inmediato y el tope de gasto lo pausa", async () => {
    await msg({ direction: "in", body: "hola", at: ago(120_000) }); // tope de 60 s ya vencido
    const { deps, calls } = makeDeps({
      onBrain: async () => {
        await msg({ direction: "in", body: "¿y?", at: new Date() }); // entra algo en cada generación
      },
    });
    const results: import("./run").RunResult[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await run.runAgent(CONV, deps);
      results.push(r);
      if (r.kind !== "reschedule") break;
      expect(r.delayMs).toBeGreaterThanOrEqual(15_000); // nunca 0 aunque el tope duro venció
    }
    expect(results.at(-1)).toEqual({ kind: "skipped", reason: "tope_de_llamadas" });
    // 40 llamadas/h (antiLoop 10 × 4) + a lo más una corrida (3 rondas × 2) de holgura.
    expect(calls.length).toBeLessThanOrEqual(46);
    expect(await agentOuts()).toEqual([]);
    expect((await conv()).agentState).toBe("pausado_antibucle");
    const [c] = await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT));
    expect(c.tags).toContain("revisión humana");
  });

  it("filtro 'pasar a humano' → etiqueta + pausa 8 h; el barrido lo reactiva al vencer", async () => {
    await msg({ direction: "in", body: "quiero hablar con una persona", at: ago(10_000) });
    const { deps, calls } = makeDeps({ filter: '{"decision":"pasar_a_humano"}' });
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "handover", reason: "filtro" });
    expect(calls.map((c) => c.kind)).toEqual(["filtro"]);
    const c1 = await conv();
    expect(c1.agentState).toBe("pausado_handover");
    const hours = (c1.agentPausedUntil!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.99);
    expect(hours).toBeLessThanOrEqual(8);
    const [ct] = await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT));
    expect(ct.tags).toContain("pasar a humano");
    expect(await sweep.reactivateExpiredHandovers(new Date())).toBe(0);
    expect(await sweep.reactivateExpiredHandovers(new Date(Date.now() + 8 * 3_600_000 + 1_000))).toBe(1);
    expect((await conv()).agentState).toBe("activo");
  });

  it("el cerebro también puede transferir ([TRANSFERIR])", async () => {
    await msg({ direction: "in", body: "mándame link para pagar con tarjeta", at: ago(10_000) });
    const { deps } = makeDeps({ brain: ["[TRANSFERIR]"] });
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "handover", reason: "cerebro" });
    expect(await agentOuts()).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_handover");
  });

  it("idempotencia: un entrante ya atendido no se vuelve a procesar", async () => {
    await msg({ direction: "in", body: "compra seguidores baratos", at: ago(10_000) });
    const { deps, calls } = makeDeps({ filter: '{"decision":"spam"}' });
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "skipped", reason: "spam" });
    expect(await run.runAgent(CONV, deps)).toEqual({ kind: "noop", reason: "ya_atendido" });
    expect(calls).toHaveLength(1);
  });

  it("precio editado por la org (sin redeploy) → cost_usd lo usa", async () => {
    await db.insert(s.aiModelPrices).values({
      organizationId: ORG,
      modelId: "claude-sonnet-5",
      inputPerMTok: 3,
      outputPerMTok: 15,
    });
    await msg({ direction: "in", body: "precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    await run.runAgent(CONV, deps);
    const brain = (await usage()).find((u) => u.stage === "cerebro")!;
    // 600 × 3 + 11,400 × 0.3 + 60 × 15 = 1,800 + 3,420 + 900 = 6,120 µ$
    expect(brain.costUsd).toBeCloseTo(0.00612, 8);
  });

  it("imágenes del cliente llegan al cerebro como URL firmada del bucket", async () => {
    await msg({
      direction: "in",
      body: "así está mi cochera",
      at: ago(10_000),
      attachments: [{ type: "image", url: "zernio://x", storageKey: "media/k1.jpg" }],
    });
    const { deps, calls, images } = makeDeps();
    await run.runAgent(CONV, deps);
    expect(images).toEqual(["media/k1.jpg"]);
    expect(JSON.stringify(calls[1].input.messages)).toContain("https://bucket.test/media/k1.jpg");
  });

  it("barrido: recoge un entrante sin atender y sin job; ignora el ya atendido", async () => {
    await msg({ direction: "in", body: "hola", at: ago(120_000) });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    const { deps } = makeDeps({ filter: '{"decision":"lead_no_sigue"}' });
    await run.runAgent(CONV, deps);
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
  });

  it("hook de entrante: marca last_inbound_at y programa con debounce", async () => {
    const { port, kv, jobs } = fakeQueue();
    const at = new Date();
    await msg({ direction: "in", body: "hola", at });
    await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at }, { queue: port, kv, now: at });
    expect((await conv()).lastInboundAt?.getTime()).toBe(at.getTime());
    expect(jobs.get(CONV)).toEqual({ state: "delayed", delay: 15_000 });
  });
});
