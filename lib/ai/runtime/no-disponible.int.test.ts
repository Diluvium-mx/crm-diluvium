// Agente IA ante el primer mensaje que WhatsApp no pasó al CRM (caso SDA, 29-sep-2026;
// lib/messaging/unavailable.ts) contra Postgres REAL: texto fijo del dueño sin llamar al
// modelo, mismas reglas que cualquier respuesta, y nada de contestar avisos en
// verificación. Modelos y Zernio son dobles. Solo con TEST_DATABASE_URL (base desechable).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("Agente IA: primer mensaje no disponible (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let run: typeof import("./run");
  let sweep: typeof import("./sweep");
  let send: typeof import("@/lib/messaging/send");
  let executor: typeof import("@/lib/workflows/executor");
  let rules: typeof import("@/lib/messaging/unavailable");
  let store: typeof import("@/lib/agente-ia/opciones-store");
  let dates: typeof import("@/lib/scheduled/rules");

  const ORG = "org_ndia";
  const CONV = "conv_ndia";
  const CONTACT = "contact_ndia";
  const JOB = { organizationId: ORG, conversationId: CONV };
  const NOTICE = { code: 131060, title: "This message is unavailable.", details: "This message is currently unavailable." };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    run = await import("./run");
    sweep = await import("./sweep");
    send = await import("@/lib/messaging/send");
    executor = await import("@/lib/workflows/executor");
    rules = await import("@/lib/messaging/unavailable");
    store = await import("@/lib/agente-ia/opciones-store");
    dates = await import("@/lib/scheduled/rules");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);

  beforeEach(async () => {
    // Opciones del bot en caché (≤ 60 s): el horario de una prueba no pasa a la siguiente.
    (await import("./options")).clearBotOptionsCache();
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, ai_knowledge, ai_config, webhook_events, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_ndia",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_ndia",
      displayName: "Diluvium",
      aiAgentMode: "auto",
    });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Cliente", phoneE164: "+526680000101" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: "ch_ndia",
      providerConversationId: "zconv_ndia",
      windowExpiresAt: new Date(Date.now() + 23 * 3_600_000),
      lastMessageAt: new Date(),
    });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", modelo1: "claude-sonnet-5", goal: "GOAL: eres Angela." });
  });

  let seq = 0;
  async function inbound(opts: { body: string; at: Date; estado?: "verificando" | "sin_contenido" }) {
    seq++;
    const id = `m_nd_${seq}`;
    const base = opts.estado ? { unsupported: NOTICE } : null;
    const metadata = !opts.estado
      ? null
      : opts.estado === "verificando"
        ? rules.verifyingMetadata(base, opts.at)
        : rules.resolvedMetadata(rules.verifyingMetadata(base, opts.at), "sin_contenido", opts.at);
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: CONV,
      direction: "in",
      source: "contact",
      type: "text",
      body: opts.body,
      attachments: [],
      providerMessageId: `wamid.ndia.${seq}`,
      status: "received",
      metadata,
      sentAt: opts.at,
      createdAt: opts.at,
    });
    return id;
  }

  function makeDeps() {
    const delivered: string[] = [];
    const brain: CallModelInput[] = [];
    const provider = {
      name: "zernio",
      sendText: async ({ text }: { text: string }) => {
        delivered.push(text);
        return { providerInternalId: `z_${crypto.randomUUID()}`, providerMessageId: `wamid.out.${crypto.randomUUID()}` };
      },
    } as unknown as import("@/lib/messaging/provider").MessagingProvider;
    const callModel = async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
      brain.push(input);
      return {
        modelId,
        provider: "anthropic",
        providerModelId: modelId,
        text: "¡Hola! Claro, ¿en qué te ayudo?",
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        finishReason: "stop",
        toolCalls: [],
      };
    };
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel,
      sendBubble: (p) => send.sendAgentText(provider, p),
      sleep: async () => {},
      resolveImage: async (key) => `https://bucket.test/${key}`,
      startWorkflow: (input) => executor.startWorkflowRun(input),
      isModelAvailable: () => true,
    };
    return { deps, delivered, brain };
  }

  const agentOuts = async () =>
    (await db.select().from(s.messages).where(eq(s.messages.direction, "out"))).filter((m) => m.source === "ai_agent");

  it("confirmado sin contenido: sale el texto EXACTO del dueño, sin llamar al modelo, y queda atendido", async () => {
    await inbound({ body: "[Unsupported message]", at: ago(30_000), estado: "sin_contenido" });
    const { deps, delivered, brain } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    expect(delivered).toEqual([
      "¡Hola! Gracias por escribirnos 😊 Tuvimos una falla técnica y su mensaje no nos llegó. ¿Nos ayudas escribiéndolo de nuevo para seguir con su atención?",
    ]);
    expect(brain).toHaveLength(0);
    expect((await agentOuts()).map((m) => m.body)).toEqual([rules.UNAVAILABLE_REPLY_TEXT]);
    expect(await db.select().from(s.aiUsage)).toHaveLength(0); // sin modelo, sin gasto de IA
    // Una segunda corrida (o el barrido) no lo repite.
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "sin_pendientes" });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    expect(delivered).toHaveLength(1);
  });

  it("si el contenido real llega DESPUÉS del texto fijo, el Agente IA contesta lo que dice (sin repetir el texto fijo)", async () => {
    const id = await inbound({ body: "[Unsupported message]", at: ago(90_000), estado: "sin_contenido" });
    const { deps, delivered, brain } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "sent", bubbles: 1 });
    await new Promise((r) => setTimeout(r, 50));
    // Lo que hace la ingesta al llegar el real con el mismo wamid (completeUnavailableMessage).
    const [row] = await db.select().from(s.messages).where(eq(s.messages.id, id));
    await db
      .update(s.messages)
      .set({ body: "¿Cuánto cuesta la compuerta para 90 cm?", metadata: rules.completedMetadata(row.metadata, {}, new Date()) })
      .where(eq(s.messages.id, id));
    expect(await run.runAgent(JOB, deps)).toMatchObject({ kind: "sent" });
    expect(brain).toHaveLength(1);
    const seen = JSON.stringify(brain[0].messages);
    expect(seen).toContain("¿Cuánto cuesta la compuerta para 90 cm?");
    expect(seen).toContain("Tuvimos una falla técnica"); // sabe que ya se le mandó el texto fijo
    expect(delivered).toEqual([rules.UNAVAILABLE_REPLY_TEXT, "¡Hola! Claro, ¿en qué te ayudo?"]);
    // Ya contestado: no se repite.
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "sin_pendientes" });
  });

  it("en verificación: el Agente IA no lo contesta y el barrido no lo toma (antes improvisaba a los 90 s)", async () => {
    await inbound({ body: "[Unsupported message]", at: ago(120_000), estado: "verificando" });
    const { deps, delivered, brain } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "noop", reason: "sin_pendientes" });
    expect(await sweep.findOrphanConversations(new Date())).toEqual([]);
    expect(delivered).toEqual([]);
    expect(brain).toHaveLength(0);
  });

  it("fuera de horario: no sale nada (como cualquier mensaje); lo atiende la apertura", async () => {
    const local = dates.instantToLocal(new Date());
    const [y, m, d] = local.slice(0, 10).split("-").map(Number);
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const today = js === 0 ? 7 : js;
    await store.saveBotOptions(ORG, "u_vendedor", { schedule: { days: [today === 1 ? 2 : 1], from: "00:00", to: "23:59" } });
    await inbound({ body: "[Unsupported message]", at: ago(30_000), estado: "sin_contenido" });
    const { deps, delivered } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toEqual({ kind: "skipped", reason: "fuera_de_horario" });
    expect(delivered).toEqual([]);
  });

  it("si el cliente ya escribió algo más, contesta el modelo (sabe que el primero no llegó) y no el texto fijo", async () => {
    await inbound({ body: "[Unsupported message]", at: ago(60_000), estado: "sin_contenido" });
    await inbound({ body: "¿Siguen ahí?", at: ago(20_000) });
    const { deps, delivered, brain } = makeDeps();
    expect(await run.runAgent(JOB, deps)).toMatchObject({ kind: "sent" });
    expect(delivered).not.toContain(rules.UNAVAILABLE_REPLY_TEXT);
    const seen = JSON.stringify(brain.at(-1)?.messages ?? []);
    expect(seen).toContain("no llegó por una falla técnica de WhatsApp");
    expect(seen).not.toContain("[Unsupported message]");
  });
});
