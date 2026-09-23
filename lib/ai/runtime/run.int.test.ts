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
  const JOB = { organizationId: ORG, conversationId: CONV };
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
    onSleep?: () => Promise<void>; // efecto durante la pausa entre burbujas
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
        if (script.onSleep) await script.onSleep();
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
      const delay = await schedule.debounceDelayFor(ORG, CONV, at);
      expect(delay).toBe(15_000); // cada entrante reinicia la espera de 15 s
      await queue.scheduleAgentRun(port, kv, { conversationId: CONV, organizationId: ORG }, delay!);
    }
    expect(jobs.size).toBe(1);

    const { deps, calls, sleeps } = makeDeps();
    const r = await run.runAgent(JOB, deps);
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
    expect((await run.runAgent(JOB, deps)).kind).toBe("noop");
  });

  it("tope máximo: si el cliente sigue escribiendo, no espera más de 60 s desde el primero", async () => {
    const t1 = ago(60_000);
    await msg({ direction: "in", body: "a", at: t1 });
    await msg({ direction: "in", body: "b", at: new Date(t1.getTime() + 55_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, new Date(t1.getTime() + 55_000))).toBe(5_000);
  });

  it("mensaje nuevo durante la generación → descarta, regenera con TODO el contexto y envía solo la nueva", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(20_000) });
    const { deps, calls } = makeDeps({
      brain: ["respuesta vieja", "Cuesta $5,500 y sí enviamos a Monterrey."],
      onBrain: async (n) => {
        if (n === 1) await msg({ direction: "in", body: "¿envían a Monterrey?", at: new Date() });
      },
    });
    const r = await run.runAgent(JOB, deps);
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
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect(calls).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("el eco business_app (vendedor desde el celular) también pausa", async () => {
    await msg({ direction: "out", source: "business_app", body: "te marco", at: ago(20_000) });
    await msg({ direction: "in", body: "ok", at: ago(10_000) });
    const { deps } = makeDeps();
    expect((await run.runAgent(JOB, deps)).kind).toBe("skipped");
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("hook de respuesta humana: pausa y cancela el job pendiente", async () => {
    const { port, kv, jobs } = fakeQueue();
    await queue.scheduleAgentRun(port, kv, { conversationId: CONV, organizationId: ORG }, 15_000);
    await hooks.onHumanOutbound({ organizationId: ORG, conversationId: CONV }, { queue: port, kv });
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
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect(await agentOuts()).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("reactivación manual: lo que respondió el vendedor ANTES ya no vuelve a pausar", async () => {
    await msg({ direction: "in", body: "hola", at: ago(40_000) });
    await msg({ direction: "out", source: "crm", body: "Hola", at: ago(30_000) });
    await state.setAgentState(ORG, CONV, "activo", { now: ago(20_000) }); // botón "Reactivar agente"
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    expect((await run.runAgent(JOB, deps)).kind).toBe("sent");
  });

  it("modo borrador: deja el borrador (uno vigente) y NO envía", async () => {
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "precio?", at: ago(20_000) });
    const { deps } = makeDeps();
    const r1 = await run.runAgent(JOB, deps);
    expect(r1.kind).toBe("draft");
    expect(await agentOuts()).toHaveLength(0);
    await msg({ direction: "in", body: "¿y envío?", at: ago(5_000) });
    const r2 = await run.runAgent(JOB, deps);
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
    expect(await schedule.debounceDelayFor(ORG, CONV, new Date())).toBeNull();
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "canal_off" });
    expect(calls).toHaveLength(0);
  });

  it("fuera de la ventana de 24 h no responde", async () => {
    await db.update(s.conversations).set({ windowExpiresAt: ago(1_000) }).where(eq(s.conversations.id, CONV));
    await msg({ direction: "in", body: "hola", at: ago(20_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "fuera_de_ventana_24h" });
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
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "anti_bucle" });
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
      const r = await run.runAgent(JOB, deps);
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
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "handover", reason: "filtro" });
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
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "handover", reason: "cerebro" });
    expect(await agentOuts()).toHaveLength(0);
    expect((await conv()).agentState).toBe("pausado_handover");
  });

  it("idempotencia: un entrante ya atendido no se vuelve a procesar", async () => {
    await msg({ direction: "in", body: "compra seguidores baratos", at: ago(10_000) });
    const { deps, calls } = makeDeps({ filter: '{"decision":"spam"}' });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "spam" });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "ya_atendido" });
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
    await run.runAgent(JOB, deps);
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
    await run.runAgent(JOB, deps);
    expect(images).toEqual(["media/k1.jpg"]);
    expect(JSON.stringify(calls[1].input.messages)).toContain("https://bucket.test/media/k1.jpg");
  });

  it("barrido: recoge un entrante sin atender y sin job; ignora el ya atendido", async () => {
    await msg({ direction: "in", body: "hola", at: ago(120_000) });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    const { deps } = makeDeps({ filter: '{"decision":"lead_no_sigue"}' });
    await run.runAgent(JOB, deps);
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

  // ── Revisión adversarial (P1/P2) ─────────────────────────────────────────
  it("un 'gracias' que el filtro saltó días atrás no rompe el debounce del siguiente mensaje", async () => {
    await msg({ direction: "in", body: "gracias", at: ago(3 * 86_400_000) });
    await run.runAgent(JOB, makeDeps({ filter: '{"decision":"lead_no_sigue"}' }).deps);
    const at = new Date();
    await msg({ direction: "in", body: "Hola, quiero info", at });
    // Antes: firstPendingAt = el "gracias" viejo → tope vencido → 0 (dispara al instante).
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBe(15_000);
  });

  it("encender el canal o reactivar al agente no contesta lo escrito antes (barrido y debounce)", async () => {
    await msg({ direction: "in", body: "hola", at: ago(10 * 60_000) });
    expect(await sweep.findOrphanConversations(new Date())).toHaveLength(1);
    // Se encendió el canal DESPUÉS de ese mensaje.
    await db.update(s.channels).set({ aiAgentModeChangedAt: ago(60_000) }).where(eq(s.channels.id, "ch_rt"));
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    // Igual con una reactivación manual posterior al mensaje.
    await db.update(s.channels).set({ aiAgentModeChangedAt: null }).where(eq(s.channels.id, "ch_rt"));
    await db.update(s.conversations).set({ agentStateChangedAt: ago(60_000) }).where(eq(s.conversations.id, CONV));
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    // El siguiente mensaje del cliente sí espera su debounce completo (no 0).
    const at = new Date();
    await msg({ direction: "in", body: "¿siguen ahí?", at });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBe(15_000);
  });

  it("el barrido no contesta historia: un entrante de hace más de 30 min se queda", async () => {
    await msg({ direction: "in", body: "hola", at: ago(31 * 60_000) });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
  });

  it("un borrador ya generado cuenta como atendido aunque su fila de ai_usage no exista", async () => {
    const id = await msg({ direction: "in", body: "precio?", at: ago(120_000) });
    await state.saveDraft({ organizationId: ORG, conversationId: CONV, bubbles: ["hola"], triggerMessageId: id, now: new Date() });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "ya_atendido" });
    expect(calls).toHaveLength(0);
  });

  it("un mensaje nuevo del cliente deja viejo el borrador vigente", async () => {
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_rt"));
    const first = await msg({ direction: "in", body: "precio?", at: ago(60_000) });
    await state.saveDraft({ organizationId: ORG, conversationId: CONV, bubbles: ["Cuesta X"], triggerMessageId: first, now: new Date() });
    const { port, kv } = fakeQueue();
    const at = new Date();
    await msg({ direction: "in", body: "ya no, gracias", at });
    await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at }, { queue: port, kv, now: at });
    const drafts = await db.select().from(s.aiAgentDrafts);
    expect(drafts.map((d) => d.status)).toEqual(["obsoleto"]);
  });

  it("canal apagado: el gancho de entrante no escribe nada ni programa", async () => {
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_rt"));
    const { port, kv, jobs } = fakeQueue();
    const at = new Date();
    await msg({ direction: "in", body: "hola", at });
    await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at }, { queue: port, kv, now: at });
    expect((await conv()).lastInboundAt).toBeNull();
    expect(jobs.size).toBe(0);
  });

  it("el contexto del cerebro no incluye salientes que fallaron", async () => {
    await msg({ direction: "in", body: "hola", at: ago(60_000) });
    await db.insert(s.messages).values({
      id: "m_fallido",
      organizationId: ORG,
      conversationId: CONV,
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "RESPUESTA QUE NUNCA LLEGÓ",
      status: "failed",
      createdAt: ago(50_000),
    });
    await msg({ direction: "in", body: "¿hola?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    await run.runAgent(JOB, deps);
    expect(JSON.stringify(calls.find((c) => c.kind === "cerebro")!.input.messages)).not.toContain("NUNCA LLEGÓ");
  });

  // ── Gate de entrada a main (medios de las revisiones) ────────────────────
  it("AUTO: si un vendedor responde en la pausa entre burbujas, la 2ª ya no sale y el agente se pausa", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps({
      onSleep: async () => {
        await msg({ direction: "out", source: "crm", body: "Yo le atiendo", at: new Date() });
      },
    });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect((await agentOuts()).map((m) => m.body)).toEqual(["Claro, cuesta $5,500 MXN."]);
    expect((await conv()).agentState).toBe("pausado_humano");
    const brain = (await usage()).find((u) => u.stage === "cerebro")!;
    expect(brain.error).toContain("detenido tras 1 burbuja(s): respuesta_humana");
  });

  it("AUTO: si apagan el canal en la pausa entre burbujas, la 2ª ya no sale", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps({
      onSleep: async () => {
        await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_rt"));
      },
    });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(await agentOuts()).toHaveLength(1);
  });


  it("presupuesto diario de la organización: al llegar, no llama modelos (y no pausa la conversación)", async () => {
    await db.update(s.aiConfig).set({ dailyBudgetUsd: 1 }).where(eq(s.aiConfig.organizationId, ORG));
    await db.insert(s.aiUsage).values({
      id: "u_gasto",
      organizationId: ORG,
      conversationId: CONV,
      stage: "cerebro",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      inputTokens: 100,
      latencyMs: 1,
      costUsd: 1.25,
      outcome: "sent",
      createdAt: ago(3 * 3_600_000),
    });
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "presupuesto_diario" });
    expect(calls).toHaveLength(0);
    expect((await conv()).agentState).toBe("activo");
    // Gasto de hace más de 24 h ya no cuenta.
    await db.update(s.aiUsage).set({ createdAt: ago(25 * 3_600_000) }).where(eq(s.aiUsage.id, "u_gasto"));
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
  });

  it("encender el canal es corte: una respuesta humana de ANTES no pausa la conversación", async () => {
    await msg({ direction: "in", body: "hola", at: ago(10 * 86_400_000) });
    await msg({ direction: "out", source: "crm", body: "Hola, soy Luis", at: ago(9 * 86_400_000) });
    await db.update(s.channels).set({ aiAgentModeChangedAt: ago(60_000) }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "¿siguen vendiendo?", at: ago(10_000) });
    const r = await run.runAgent(JOB, makeDeps().deps);
    expect(r.kind).toBe("sent");
    expect((await conv()).agentState).toBe("activo");
  });

  it("con el agente pausado no se programa nada; un pase a humano VENCIDO sí", async () => {
    const at = new Date();
    await msg({ direction: "in", body: "hola", at });
    await state.setAgentState(ORG, CONV, "pausado_humano", { now: ago(60_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBeNull();
    await state.setAgentState(ORG, CONV, "pausado_handover", { now: ago(60_000), pausedUntil: ago(1_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).not.toBeNull();
  });

  it("pendientes acotados: con 60 entrantes sin respuesta solo se leen los 50 más recientes, en orden", async () => {
    const { pendingInbound, MAX_PENDING } = await import("./context");
    for (let i = 0; i < 60; i++) await msg({ direction: "in", body: `spam ${i}`, at: ago((60 - i) * 1_000) });
    const rows = await pendingInbound(ORG, CONV);
    expect(rows).toHaveLength(MAX_PENDING);
    expect(rows[0].body).toBe("spam 10");
    expect(rows.at(-1)!.body).toBe("spam 59");
  });

  // ── Guardia de salida (modo auto) ────────────────────────────────────────
  async function heldDraft() {
    const [d] = await db.select().from(s.aiAgentDrafts);
    return d;
  }

  it("auto: un monto que no está en el Goal ni en las FAQs NO se envía → borrador + 'revisión humana' + motivo", async () => {
    await msg({ direction: "in", body: "¿me haces descuento?", at: ago(10_000) });
    const { deps } = makeDeps({ brain: ["Va, te la dejo en $4,200 si confirmas hoy."] });
    const r = await run.runAgent(JOB, deps);
    expect(r).toMatchObject({ kind: "held", reason: "Monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: $4,200" });
    expect(await agentOuts()).toEqual([]);
    const d = await heldDraft();
    expect(d).toMatchObject({ status: "pendiente", bubbles: ["Va, te la dejo en $4,200 si confirmas hoy."] });
    expect(d.reviewReason).toContain("$4,200");
    const [c] = await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT));
    expect(c.tags).toContain("revisión humana");
    const brain = (await usage()).find((u) => u.stage === "cerebro")!;
    expect(brain.outcome).toBe("draft");
    expect(brain.error).toMatch(/^guardia de salida: /);
    // La tarjeta lo muestra (misma lectura que usa la Bandeja).
    const { loadConversationAgent } = await import("./manual");
    expect((await loadConversationAgent(ORG, CONV))!.draft!.reviewReason).toContain("$4,200");
    // Pausa en "revisión humana": el agente no sigue solo.
    expect((await conv()).agentState).toBe("pausado_antibucle");
  });

  it("retenida: el siguiente mensaje del cliente NO borra la tarjeta ni el agente responde solo; tras Reactivar, sí", async () => {
    await msg({ direction: "in", body: "¿descuento?", at: ago(20_000) });
    expect((await run.runAgent(JOB, makeDeps({ brain: ["Te la dejo en $4,200."] }).deps)).kind).toBe("held");
    const { port, kv } = fakeQueue();
    let at = new Date();
    await msg({ direction: "in", body: "¿entonces?", at });
    await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at }, { queue: port, kv, now: at });
    expect((await heldDraft()).status).toBe("pendiente");
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "pausado_antibucle" });
    expect(calls).toHaveLength(0);
    // Un vendedor revisa y reactiva: el siguiente mensaje ya reemplaza la tarjeta.
    await state.setAgentState(ORG, CONV, "activo", { now: new Date() });
    at = new Date(Date.now() + 1_000);
    await msg({ direction: "in", body: "hola?", at });
    await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: CONV, receivedAt: at }, { queue: port, kv, now: at });
    expect((await heldDraft()).status).toBe("obsoleto");
  });

  it("la regla de montos (cifras y $) llega en el system del cerebro; el Goal guardado no cambia", async () => {
    const { MONEY_FORMAT_RULE } = await import("./brain");
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    await run.runAgent(JOB, deps);
    const brain = calls.find((c) => c.kind === "cerebro")!;
    expect(brain.input.system.startsWith(GOAL)).toBe(true);
    expect(brain.input.system).toContain(MONEY_FORMAT_RULE);
    const [cfg] = await db.select().from(s.aiConfig).where(eq(s.aiConfig.organizationId, ORG));
    expect(cfg.goal).toBe(GOAL);
  });

  it("auto: total SIN desglose → retenido aunque sea 2 × $5,500; con desglose correcto → se envía", async () => {
    await msg({ direction: "in", body: "¿y dos?", at: ago(10_000) });
    expect(await run.runAgent(JOB, makeDeps({ brain: ["Las dos te salen en $11,000 MXN."] }).deps)).toMatchObject({
      kind: "held",
      reason: "Monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: $11,000",
    });
    await state.setAgentState(ORG, CONV, "activo", { now: new Date() }); // un vendedor revisó y reactivó
    await msg({ direction: "in", body: "¿entonces?", at: new Date(Date.now() + 1_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["Serían 2 × $5,500 = $11,000 MXN."] }).deps);
    expect(r).toEqual({ kind: "sent", bubbles: 1 });
  });

  it("auto: desglose con cuentas mal hechas → retenido con su motivo", async () => {
    await msg({ direction: "in", body: "¿cuánto las dos?", at: ago(10_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["Son 2 × $5,500 = $10,000."] }).deps);
    expect(r).toMatchObject({ kind: "held", reason: expect.stringContaining("Desglose que no cuadra") });
    expect(await agentOuts()).toEqual([]);
    expect((await heldDraft()).reviewReason).toContain("2 × $5,500 = $10,000");
  });

  it("auto: descuento inventado → retenido; anticipo escrito tal cual en la base → se envía", async () => {
    await db.insert(s.aiKnowledge).values({
      id: "k_anticipo",
      organizationId: ORG,
      ghlId: "g_anticipo",
      question: "¿Anticipo de medida especial?",
      answer: "Anticipo de $3,500 y liquidación de $3,500 antes del envío.",
      position: 3,
    });
    await msg({ direction: "in", body: "¿me la dejas más barata?", at: ago(20_000) });
    expect((await run.runAgent(JOB, makeDeps({ brain: ["Te la dejo en $5,000."] }).deps)).kind).toBe("held");
    await state.setAgentState(ORG, CONV, "activo", { now: new Date() });
    await msg({ direction: "in", body: "¿y el anticipo?", at: new Date(Date.now() + 1_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["El anticipo es de $3,500."] }).deps);
    expect(r).toEqual({ kind: "sent", bubbles: 1 });
  });

  it("auto: promoción inventada (10%) → retenida; meses sin intereses escritos en la base → se envía", async () => {
    await db.insert(s.aiKnowledge).values({
      id: "k_msi",
      organizationId: ORG,
      ghlId: "g_msi",
      question: "¿Meses sin intereses?",
      answer: "Sí, a 6 meses sin intereses con tarjeta participante.",
      position: 3,
    });
    await msg({ direction: "in", body: "¿algún descuento?", at: ago(20_000) });
    expect(await run.runAgent(JOB, makeDeps({ brain: ["Te doy 10% de descuento si pagas hoy."] }).deps)).toMatchObject({
      kind: "held",
      reason: "Promoción que no está en el Goal ni en las FAQs: 10%",
    });
    await state.setAgentState(ORG, CONV, "activo", { now: new Date() });
    await msg({ direction: "in", body: "¿y a meses?", at: new Date(Date.now() + 1_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["Sí, puedes pagar a 6 meses sin intereses."] }).deps);
    expect(r).toEqual({ kind: "sent", bubbles: 1 });
  });

  it("auto: un enlace fuera de la lista NO se envía; diluvium.com.mx sí", async () => {
    await msg({ direction: "in", body: "¿dónde pago?", at: ago(10_000) });
    const held = await run.runAgent(JOB, makeDeps({ brain: ["Paga aquí: https://pagos-rapidos.com/x"] }).deps);
    expect(held).toMatchObject({ kind: "held", reason: "Enlace fuera de la lista permitida: https://pagos-rapidos.com/x" });
    expect(await agentOuts()).toEqual([]);

    await state.setAgentState(ORG, CONV, "activo", { now: new Date() }); // un vendedor revisó y reactivó
    await msg({ direction: "in", body: "¿tienen página?", at: new Date(Date.now() + 1_000) });
    const ok = await run.runAgent(JOB, makeDeps({ brain: ["Sí: https://www.diluvium.com.mx/compuertas"] }).deps);
    expect(ok).toEqual({ kind: "sent", bubbles: 1 });
  });

  it("auto: un monto que solo está en una FAQ DESACTIVADA también se retiene", async () => {
    await db.insert(s.aiKnowledge).values({
      id: "k3",
      organizationId: ORG,
      ghlId: "g3",
      question: "¿Promo?",
      answer: "Solo este mes $4,999",
      position: 3,
      enabled: false,
    });
    await msg({ direction: "in", body: "¿promo?", at: ago(10_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["Este mes queda en $4,999."] }).deps);
    expect(r.kind).toBe("held");
  });

  it("borrador: la guardia no cambia el flujo pero deja el motivo visible (sin etiqueta)", async () => {
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "¿descuento?", at: ago(10_000) });
    const r = await run.runAgent(JOB, makeDeps({ brain: ["Te lo dejo en $4,200."] }).deps);
    expect(r.kind).toBe("draft");
    expect((await heldDraft()).reviewReason).toContain("$4,200");
    const [c] = await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT));
    expect(c.tags ?? []).not.toContain("revisión humana");
  });
});
