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
    filter?: string; // JSON de la limpieza del anuncio (Luna)
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
          text: script.filter ?? '{"mensaje":"Hola","anuncio":"Compuertas contra inundaciones"}',
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
      sendBubble: (p) => send.sendTextMessage(provider, { ...p, source: "ai_agent", sentByUserId: null }),
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
  const notices = () => db.select().from(s.aiAgentNotices).orderBy(s.aiAgentNotices.createdAt);
  const contactTags = async () => (await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT)))[0].tags ?? [];

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
    // Sin anuncio no hay limpieza: el filtro no se llama (ni frena nada).
    expect(calls.map((c) => c.kind)).toEqual(["cerebro"]);
    // El cerebro recibió los 3 pendientes juntos, en el último turno del cliente.
    const last = calls[0].input.messages.at(-1)!;
    expect(JSON.stringify(last.content)).toContain("Hola");
    expect(JSON.stringify(last.content)).toContain("es para una cochera");
    // System = Goal + FAQs (+ sufijo del CRM).
    expect(calls[0].input.system.startsWith(GOAL)).toBe(true);
    expect(calls[0].input.system).toContain("P: ¿Precio?\nR: $5,500 MXN");
    // Información y pregunta como 2 mensajes con UNA pausa corta (1.5 s) entre ellos.
    const outs = await agentOuts();
    expect(outs.map((m) => m.body)).toEqual(["Claro, cuesta $5,500 MXN.", "¿Cuánto mide tu entrada?"]);
    expect(outs.every((m) => m.sentByUserId === null)).toBe(true);
    expect(sleeps).toEqual([run.BUBBLE_PAUSE_MS]);
    expect((await conv()).lastAgentReplyAt).not.toBeNull();
    // Uso/costo por llamada.
    const u = await usage();
    expect(u.map((x) => [x.stage, x.outcome])).toEqual(
      expect.arrayContaining([["cerebro", "sent"]]),
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
    expect(calls.map((c) => c.kind)).toEqual(["cerebro", "cerebro"]);
    expect(JSON.stringify(calls[1].input.messages)).toContain("¿envían a Monterrey?");
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

  it("un canal viejo en 'borrador' se trata como apagado: ni programa ni llama modelos", async () => {
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_rt"));
    await msg({ direction: "in", body: "precio?", at: ago(20_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, new Date())).toBeNull();
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "canal_off" });
    expect(calls).toHaveLength(0);
    expect(await db.select().from(s.aiAgentDrafts)).toEqual([]);
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

  it("sin freno anti-bucle: aunque el agente lleve 40 respuestas en la hora, contesta (sin pausa ni etiqueta)", async () => {
    await db.insert(s.aiUsage).values(
      Array.from({ length: 40 }, (_, i) => ({
        id: `u${i}`,
        organizationId: ORG,
        conversationId: CONV,
        stage: "cerebro" as const,
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        inputTokens: 100,
        latencyMs: 1,
        outcome: "sent",
        createdAt: ago((i + 1) * 60_000),
      })),
    );
    await msg({ direction: "in", body: "hola?", at: ago(10_000) });
    expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect((await conv()).agentState).toBe("activo");
    expect(await contactTags()).not.toContain("revisión humana");
    expect(await notices()).toEqual([]);
  });

  it("los timeouts de las 3 rondas (filtro + cerebro) caben en el candado de la corrida", async () => {
    const { LOCK_TTL_MS } = await import("./process");
    expect(run.MAX_ROUNDS * (run.FILTER_TIMEOUT_MS + run.BRAIN_TIMEOUT_MS)).toBeLessThan(LOCK_TTL_MS);
  });

  it("cliente que escribe sin parar: nunca bucle inmediato (vuelve al debounce ≥ 15 s) y contesta cuando hace una pausa", async () => {
    await msg({ direction: "in", body: "hola", at: ago(120_000) }); // tope de 60 s ya vencido
    const writing = makeDeps({
      onBrain: async () => {
        await msg({ direction: "in", body: "¿y?", at: new Date() }); // entra algo en cada generación
      },
    });
    const r = await run.runAgent(JOB, writing.deps);
    expect(r.kind).toBe("reschedule");
    if (r.kind === "reschedule") expect(r.delayMs).toBeGreaterThanOrEqual(15_000); // nunca 0
    expect(writing.calls).toHaveLength(run.MAX_ROUNDS); // acotado por corrida
    expect(await agentOuts()).toEqual([]);
    // El cliente para de escribir: la siguiente corrida contesta TODO.
    expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect((await conv()).agentState).toBe("activo");
  });

  it("cliente que llega por anuncio: Luna limpia la metadata, el cerebro recibe solo lo que escribió y la limpieza se guarda", async () => {
    const adMsg = await msg({
      direction: "in",
      body: "Hola\nbody: Compuertas contra inundaciones desde $5,500\nctwaClid: ARsecreto\nsourceType: ad",
      at: ago(10_000),
    });
    await db
      .update(s.messages)
      .set({ adReferral: { headline: "Compuertas contra inundaciones", ctwa_clid: "ARsecreto" } })
      .where(eq(s.messages.id, adMsg));
    const { deps, calls } = makeDeps({ filter: '{"mensaje":"Hola","anuncio":"Compuertas contra inundaciones desde $5,500"}' });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect(calls.map((c) => c.kind)).toEqual(["filtro", "cerebro"]);
    expect(JSON.stringify(calls[0].input.messages)).not.toContain("ARsecreto"); // ids de rastreo nunca van al modelo
    const brainInput = JSON.stringify(calls[1].input.messages);
    expect(brainInput).not.toContain("ctwaClid");
    expect(brainInput).not.toContain("desde $5,500");
    expect(calls[1].input.messages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "Hola" }] });
    const [m] = await db.select().from(s.messages).where(eq(s.messages.id, adMsg));
    expect((m.metadata as Record<string, unknown>).agenteAnuncio).toEqual({
      mensaje: "Hola",
      anuncio: "Compuertas contra inundaciones desde $5,500",
    });
    expect((await usage()).find((u) => u.stage === "filtro")).toMatchObject({ filterDecision: "limpieza_anuncio", outcome: "passed" });
    // La siguiente respuesta reutiliza la limpieza guardada (no vuelve a pagar a Luna).
    await msg({ direction: "in", body: "¿envían a Culiacán?", at: new Date(Date.now() + 1_000) });
    const again = makeDeps();
    expect((await run.runAgent(JOB, again.deps)).kind).toBe("sent");
    expect(again.calls.map((c) => c.kind)).toEqual(["cerebro"]);
  });

  it("si Luna falla al limpiar el anuncio, el cliente igual recibe respuesta (respaldo sin modelo)", async () => {
    await msg({ direction: "in", body: "Quiero info\nbody: Texto del anuncio\nctwaClid: X1", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    const real = deps.callModel;
    deps.callModel = async (id, input) => {
      if (input.system === filter.FILTER_SYSTEM) throw new Error("Luna caída");
      return real(id, input);
    };
    expect((await run.runAgent(JOB, deps)).kind).toBe("sent");
    expect(calls.map((c) => c.kind)).toEqual(["cerebro"]);
    expect(JSON.stringify(calls[0].input.messages)).not.toContain("ctwaClid");
    expect(JSON.stringify(calls[0].input.messages)).toContain("Quiero info");
  });

  it("lee TODA la conversación (no solo los últimos 20 mensajes)", async () => {
    for (let i = 0; i < 40; i++) {
      await msg({ direction: i % 2 ? "out" : "in", source: i % 2 ? "ai_agent" : undefined, body: `m${i}-texto`, at: ago((60 - i) * 60_000) });
    }
    await msg({ direction: "in", body: "¿y el envío?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect((await run.runAgent(JOB, deps)).kind).toBe("sent");
    const seen = JSON.stringify(calls[0].input.messages);
    expect(seen).toContain("m0-texto");
    expect(seen).toContain("m39-texto");
  });

  it("el cerebro también puede pedir a un vendedor ([TRANSFERIR]): la señal no llega al cliente y se avisa", async () => {
    await msg({ direction: "in", body: "mándame link para pagar con tarjeta", at: ago(10_000) });
    const { deps } = makeDeps({ brain: ["Con gusto, un asesor te envía el enlace en un momento.\n[TRANSFERIR]"] });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect((await agentOuts()).map((m) => m.body)).toEqual(["Con gusto, un asesor te envía el enlace en un momento."]);
    expect((await notices()).map((n) => n.kind)).toEqual(["pasar_a_humano"]);
    expect((await conv()).agentState).toBe("activo");
  });

  it("[TRANSFERIR] sin texto: el cliente igual recibe respuesta (el agente siempre contesta)", async () => {
    const { HANDOVER_FALLBACK_TEXT } = await import("./brain");
    await msg({ direction: "in", body: "quiero una persona", at: ago(10_000) });
    expect(await run.runAgent(JOB, makeDeps({ brain: ["[TRANSFERIR]"] }).deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect((await agentOuts()).map((m) => m.body)).toEqual([HANDOVER_FALLBACK_TEXT]);
  });

  it("idempotencia: un entrante ya atendido no se vuelve a procesar", async () => {
    await msg({ direction: "in", body: "hola", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    expect((await run.runAgent(JOB, deps)).kind).toBe("sent");
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "sin_pendientes" });
    expect(calls).toHaveLength(1);
  });

  it("responde TODO: un 'gracias' o un 'ok' también se contesta (el filtro ya no salta mensajes)", async () => {
    await msg({ direction: "in", body: "ok gracias", at: ago(10_000) });
    const { deps, calls } = makeDeps({ brain: ["¡Con gusto! Aquí estoy si necesitas algo más."] });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(calls.map((c) => c.kind)).toEqual(["cerebro"]);
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
    expect(JSON.stringify(calls[0].input.messages)).toContain("https://bucket.test/media/k1.jpg");
  });

  it("barrido: recoge un entrante sin atender y sin job; ignora el ya atendido", async () => {
    await msg({ direction: "in", body: "hola", at: ago(120_000) });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    await run.runAgent(JOB, makeDeps().deps);
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
  it("un mensaje viejo ya atendido no rompe el debounce del siguiente mensaje", async () => {
    await msg({ direction: "in", body: "gracias", at: ago(3 * 86_400_000) });
    await run.runAgent(JOB, makeDeps().deps);
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

  it("un plan ya enviado cuenta como atendido aunque su fila de ai_usage no exista", async () => {
    const id = await msg({ direction: "in", body: "precio?", at: ago(120_000) });
    await db.insert(s.aiAgentDrafts).values({ id: "plan_ok", organizationId: ORG, conversationId: CONV, bubbles: ["a", "b"], triggerMessageId: id, status: "enviado" });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "ya_atendido" });
    expect(calls).toHaveLength(0);
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
    expect(brain.error).toContain("detenido tras 1 mensaje(s): respuesta_humana");
  });

  it("AUTO: si el CLIENTE escribe en la pausa entre burbujas, la 2ª no sale y su mensaje queda pendiente", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    let nuevo = "";
    const { deps } = makeDeps({
      onSleep: async () => {
        nuevo = await msg({ direction: "in", body: "¿y hacen envíos?", at: new Date(Date.now() + 1_000) });
      },
    });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(await agentOuts()).toHaveLength(1);
    const { pendingInbound } = await import("./context");
    expect((await pendingInbound(ORG, CONV)).map((m) => m.id)).toEqual([nuevo]); // la siguiente corrida lo atiende
    const brain = (await usage()).find((u) => u.stage === "cerebro")!;
    expect(brain.error).toContain("detenido tras 1 mensaje(s): entrante_nuevo");
  });

  // ── Envíos del agente sin confirmar o fallidos (re-revisiones de Codex) ────
  async function agentMsg(opts: { status: "queued" | "sent" | "failed"; errorCode?: string; at?: Date; source?: "ai_agent" | "crm" }) {
    const id = `m_${opts.source ?? "ai"}_${crypto.randomUUID()}`;
    const at = opts.at ?? new Date();
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: CONV,
      direction: "out",
      source: opts.source ?? "ai_agent",
      type: "text",
      body: "x",
      status: opts.status,
      errorCode: opts.errorCode ?? null,
      sentByUserId: opts.source === "crm" ? "u_vendedor" : null,
      sentAt: at,
      createdAt: at,
    });
    return id;
  }

  it("AUTO → 1ª burbuja sin confirmar: la 2ª no sale, queda en un AVISO y el agente sigue activo", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    deps.sendBubble = async () => {
      await agentMsg({ status: "queued" });
      return { status: "pending" as const };
    };
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    const brain = (await usage()).find((u) => u.stage === "cerebro")!;
    expect(brain).toMatchObject({ outcome: "sent", error: "1 mensaje(s) sin confirmar; 1 sin enviar (aviso)" });
    expect((await db.select().from(s.aiAgentDrafts)).map((d) => d.status)).toEqual(["enviado"]);
    const [n] = await notices();
    expect(n).toMatchObject({ kind: "envio" });
    expect(n.body).toContain("¿Cuánto mide tu entrada?");
    expect((await conv()).agentState).toBe("activo");
    expect(await contactTags()).not.toContain("revisión humana");
  });

  it("AUTO → una sola burbuja sin confirmar: espera; si vence sin confirmar, el barrido AVISA (una vez) y el agente sigue", async () => {
    const { SEND_UNCONFIRMED } = await import("@/lib/messaging/rules");
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps({ brain: ["Claro, cuesta $5,500 MXN."] });
    let pendingId = "";
    deps.sendBubble = async () => {
      pendingId = await agentMsg({ status: "queued" });
      return { status: "pending" as const };
    };
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(await db.select().from(s.aiAgentDrafts)).toEqual([]); // una burbuja: sin plan
    // En camino: sin aviso, y el agente no responde encima de un envío sin resolver.
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(0);
    await msg({ direction: "in", body: "¿hola?", at: new Date(Date.now() + 1_000) });
    const busy = makeDeps();
    expect(await run.runAgent(JOB, busy.deps)).toEqual({ kind: "skipped", reason: "envio_sin_confirmar" });
    expect(busy.calls).toHaveLength(0);
    // Vence sin confirmar → aviso al vendedor, sin reenviar; el agente sigue contestando.
    await db.update(s.messages).set({ status: "failed", errorCode: SEND_UNCONFIRMED }).where(eq(s.messages.id, pendingId));
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(1);
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(0);
    expect((await notices())[0].body).toContain("no confirmó");
    expect((await conv()).agentState).toBe("activo");
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
  });

  it("un saliente humano que entra DESPUÉS del inicio de la ronda detiene el envío aunque la revisión fresca no lo vea", async () => {
    await agentMsg({ status: "sent", at: ago(60_000) }); // último saliente: del agente
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps({
      // Eco del vendedor desde el celular con hora de WhatsApp MÁS VIEJA que el último
      // saliente: freshLastOut no cambia, pero el conteo humano sí.
      onBrain: async () => {
        await agentMsg({ status: "sent", source: "crm", at: ago(120_000) });
      },
    });
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "respuesta_humana" });
    expect(calls.filter((c) => c.kind === "cerebro")).toHaveLength(1);
    expect((await agentOuts()).filter((m) => m.createdAt > ago(30_000))).toEqual([]);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("plan durable: mientras salen las burbujas existe como 'enviando' y al terminar queda 'enviado'", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const seen: string[] = [];
    const { deps } = makeDeps();
    const real = deps.sendBubble;
    deps.sendBubble = async (p) => {
      const [plan] = await db.select().from(s.aiAgentDrafts);
      seen.push(plan.status);
      return real(p);
    };
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 2 });
    expect(seen).toEqual(["enviando", "enviando"]);
    expect((await db.select().from(s.aiAgentDrafts))[0].status).toBe("enviado");
  });

  it("AUTO: si falla la 2ª burbuja, lo que faltó queda en un AVISO y el agente sigue activo", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    const real = deps.sendBubble;
    let n = 0;
    deps.sendBubble = async (p) => {
      n++;
      if (n === 2) throw new Error("se cayó el proveedor");
      return real(p);
    };
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect((await db.select().from(s.aiAgentDrafts)).map((d) => d.status)).toEqual(["enviado"]);
    const [aviso] = await notices();
    expect(aviso.body).toContain("Salieron 1 de 2");
    expect(aviso.body).toContain("¿Cuánto mide tu entrada?");
    expect((await conv()).agentState).toBe("activo");
  });

  it("AUTO: si falla la 1ª burbuja, el plan queda obsoleto y el reintento de la cola sí responde", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps } = makeDeps();
    deps.sendBubble = async () => {
      throw new Error("se cayó el proveedor");
    };
    await expect(run.runAgent(JOB, deps)).rejects.toThrow("se cayó el proveedor");
    expect((await db.select().from(s.aiAgentDrafts))[0].status).toBe("obsoleto");
    expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "sent", bubbles: 2 });
  });

  it("barrido (reinicio del worker): un plan interrumpido a la mitad queda 'enviado' y lo que faltó en un AVISO", async () => {
    const trigger = await msg({ direction: "in", body: "¿precio?", at: ago(25 * 60_000) });
    const claimed = ago(20 * 60_000);
    await db.insert(s.aiAgentDrafts).values({
      id: "plan_x",
      organizationId: ORG,
      conversationId: CONV,
      bubbles: ["Primera", "Segunda"],
      triggerMessageId: trigger,
      status: "enviando",
      resolvedAt: claimed,
    });
    await agentMsg({ status: "sent", at: new Date(claimed.getTime() + 1_000) }); // salió solo la 1ª
    expect(await sweep.reconcileStuckDrafts(new Date())).toBe(1);
    expect((await db.select().from(s.aiAgentDrafts))[0].status).toBe("enviado");
    const [n] = await notices();
    expect(n.body).toContain("salieron 1 de 2");
    expect(n.body).toContain("Segunda");
    expect((await conv()).agentState).toBe("activo");
    expect(await sweep.reconcileStuckDrafts(new Date())).toBe(0); // no repite el aviso
  });

  it("barrido (reinicio del worker): un plan sin ninguna burbuja enviada queda obsoleto y el entrante se vuelve a atender", async () => {
    const trigger = await msg({ direction: "in", body: "¿precio?", at: ago(12 * 60_000) });
    await db.insert(s.aiAgentDrafts).values({
      id: "plan_nada",
      organizationId: ORG,
      conversationId: CONV,
      bubbles: ["Primera", "Segunda"],
      triggerMessageId: trigger,
      status: "enviando",
      resolvedAt: ago(11 * 60_000),
    });
    expect(await sweep.reconcileStuckDrafts(new Date())).toBe(1);
    expect((await db.select().from(s.aiAgentDrafts))[0].status).toBe("obsoleto");
    expect(await notices()).toEqual([]);
    expect(await sweep.findOrphanConversations(new Date())).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "sent", bubbles: 2 });
  });

  it("un plan 'enviando' en la conversación bloquea nuevas corridas (la conciliación no se mezcla)", async () => {
    const trigger = await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    await db.insert(s.aiAgentDrafts).values({
      id: "plan_vivo",
      organizationId: ORG,
      conversationId: CONV,
      bubbles: ["a", "b"],
      triggerMessageId: trigger,
      status: "enviando",
      resolvedAt: new Date(),
    });
    await msg({ direction: "in", body: "¿hola?", at: new Date(Date.now() + 1_000) });
    const { deps, calls } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "envio_sin_confirmar" });
    expect(calls).toHaveLength(0);
  });

  it("un plan OBSOLETO (la 1ª burbuja falló) no impide que el barrido rescate el entrante", async () => {
    const trigger = await msg({ direction: "in", body: "¿precio?", at: ago(120_000) });
    await db.insert(s.aiAgentDrafts).values({
      id: "plan_muerto",
      organizationId: ORG,
      conversationId: CONV,
      bubbles: ["a", "b"],
      triggerMessageId: trigger,
      status: "obsoleto",
    });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([{ conversationId: CONV, organizationId: ORG }]);
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
  });

  it("pending → confirmado: sin aviso ni pausa", async () => {
    const id = await agentMsg({ status: "queued" });
    await db.update(s.messages).set({ status: "sent" }).where(eq(s.messages.id, id));
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(0);
    expect((await conv()).agentState).toBe("activo");
  });

  it("rechazo definitivo de una respuesta del agente → aviso con el código (sin pausa)", async () => {
    await agentMsg({ status: "failed", errorCode: "131047" });
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(1);
    expect((await notices())[0].body).toContain("131047");
    expect((await conv()).agentState).toBe("activo");
  });

  it("una burbuja ambigua que NO es el último saliente también avisa (la 2ª sí salió)", async () => {
    const { SEND_UNCONFIRMED } = await import("@/lib/messaging/rules");
    await agentMsg({ status: "failed", errorCode: SEND_UNCONFIRMED, at: ago(5_000) });
    await agentMsg({ status: "sent", at: ago(3_000) });
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(1);
  });

  it("un envío fallido de hace más de 24 h no genera aviso (no se avisa historia al desplegar)", async () => {
    const { SEND_UNCONFIRMED } = await import("@/lib/messaging/rules");
    await agentMsg({ status: "failed", errorCode: SEND_UNCONFIRMED, at: ago(2 * 86_400_000) });
    expect(await sweep.noticeFailedAgentSends(new Date())).toBe(0);
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


  it("sin presupuesto diario: con mucho gasto en las últimas 24 h igual contesta", async () => {
    await db.insert(s.aiUsage).values({
      id: "u_gasto",
      organizationId: ORG,
      conversationId: CONV,
      stage: "cerebro",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      inputTokens: 100,
      latencyMs: 1,
      costUsd: 500,
      outcome: "sent",
      createdAt: ago(3 * 3_600_000),
    });
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
    expect(await notices()).toEqual([]);
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

  it("con el agente pausado no se programa nada (ninguna pausa vence sola)", async () => {
    const at = new Date();
    await msg({ direction: "in", body: "hola", at });
    await state.setAgentState(ORG, CONV, "pausado_humano", { now: ago(60_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBeNull();
    await state.setAgentState(ORG, CONV, "pausado_handover", { now: ago(60_000), pausedUntil: ago(1_000) });
    expect(await schedule.debounceDelayFor(ORG, CONV, at)).toBeNull();
  });

  it("pendientes acotados: con 60 entrantes sin respuesta solo se leen los 50 más recientes, en orden", async () => {
    const { pendingInbound, MAX_PENDING } = await import("./context");
    for (let i = 0; i < 60; i++) await msg({ direction: "in", body: `spam ${i}`, at: ago((60 - i) * 1_000) });
    const rows = await pendingInbound(ORG, CONV);
    expect(rows).toHaveLength(MAX_PENDING);
    expect(rows[0].body).toBe("spam 10");
    expect(rows.at(-1)!.body).toBe("spam 59");
  });

  // ── Sin guardia: nada se interpone entre el agente y el cliente ──────────

  it("sin guardia: la respuesta del cerebro sale tal cual (montos, enlaces, promociones), sin avisos ni pausa", async () => {
    await msg({ direction: "in", body: "¿me haces descuento?", at: ago(10_000) });
    const text = "Va, te la dejo en $4,200 con 10% de descuento: https://pagos.ejemplo.com/x";
    expect(await run.runAgent(JOB, makeDeps({ brain: [text] }).deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect((await agentOuts()).map((m) => m.body)).toEqual([text]);
    expect(await notices()).toEqual([]);
    expect(await db.select().from(s.aiAgentDrafts)).toEqual([]);
    expect((await conv()).agentState).toBe("activo");
  });

  it("el cerebro recibe el Goal completo + TODAS las FAQs activas + instrucciones del CRM sin reglas de montos", async () => {
    await msg({ direction: "in", body: "¿precio?", at: ago(10_000) });
    const { deps, calls } = makeDeps();
    await run.runAgent(JOB, deps);
    const brain = calls.find((c) => c.kind === "cerebro")!;
    expect(brain.input.system.startsWith(GOAL)).toBe(true);
    expect(brain.input.system).toContain("P: ¿Precio?\nR: $5,500 MXN");
    expect(brain.input.system).toContain("P: ¿Dónde?\nR: Los Mochis");
    expect(brain.input.system).toContain("INSTRUCCIONES DEL CRM");
    expect(brain.input.system).not.toContain("desglos");
    const [cfg] = await db.select().from(s.aiConfig).where(eq(s.aiConfig.organizationId, ORG));
    expect(cfg.goal).toBe(GOAL);
  });
});
