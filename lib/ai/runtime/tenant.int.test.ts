// Multi-tenant del runtime del Agente IA contra Postgres REAL: con los ids de
// una conversación de la organización A y la organización B, NINGUNA lectura
// encuentra nada y NINGUNA escritura cambia nada (ni llama modelos ni programa).
// Control positivo: las mismas llamadas con A sí funcionan. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("el runtime del agente no cruza organizaciones (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let ctx: typeof import("./context");
  let state: typeof import("./state");
  let schedule: typeof import("./schedule");
  let hooks: typeof import("./hooks");
  let run: typeof import("./run");
  const A = "org_a";
  const B = "org_b";
  const CONV = "conv_a";
  const CONTACT = "ct_a";
  const MSG = "msg_a_in";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    ctx = await import("./context");
    state = await import("./state");
    schedule = await import("./schedule");
    hooks = await import("./hooks");
    run = await import("./run");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, ai_knowledge, ai_config, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: A, name: "A", slug: "a", createdAt: new Date() },
      { id: B, name: "B", slug: "b", createdAt: new Date() },
    ]);
    // Ambas organizaciones con el agente encendido y Goal: B podría responder si cruzara.
    await db.insert(s.aiConfig).values([
      { organizationId: A, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL A" },
      { organizationId: B, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL B" },
    ]);
    await db.insert(s.channels).values({
      id: "ch_a",
      organizationId: A,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_a",
      displayName: "A",
      aiAgentMode: "auto",
    });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: A, firstName: "Cliente A" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: A,
      contactId: CONTACT,
      channelId: "ch_a",
      providerConversationId: "zconv_a",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
    });
    const at = new Date(Date.now() - 120_000);
    await db.insert(s.messages).values([
      { id: "msg_a_out", organizationId: A, conversationId: CONV, direction: "out", source: "ai_agent", type: "text", body: "hola", status: "sent", sentAt: new Date(at.getTime() - 60_000), createdAt: new Date(at.getTime() - 60_000) },
      { id: MSG, organizationId: A, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "precio?", status: "received", sentAt: at, createdAt: at },
    ]);
    await db.insert(s.aiUsage).values({
      id: "u_a",
      organizationId: A,
      conversationId: CONV,
      messageId: MSG,
      stage: "cerebro",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      inputTokens: 100,
      latencyMs: 1,
      outcome: "draft",
    });
  });

  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, CONV)))[0];
  const contact = async () => (await db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT)))[0];

  it("lecturas: con la organización B no encuentra nada de A (y con A sí)", async () => {
    const since = new Date(Date.now() - 3_600_000);
    expect(await ctx.loadSnapshot(B, CONV)).toBeNull();
    expect(await ctx.lastOutbound(B, CONV)).toBeNull();
    expect(await ctx.pendingInbound(B, CONV)).toEqual([]);
    expect(await ctx.recentMessages(B, CONV, 20)).toEqual([]);
    expect(await ctx.inboundCount(B, CONV)).toBe(0);
    expect(await ctx.alreadyHandled(B, MSG)).toBe(false);
    expect(await ctx.lastHandledInboundAt(B, CONV)).toBeNull();
    expect(await ctx.agentRepliesSince(B, CONV, since)).toBe(0);
    expect(await ctx.modelCallsSince(B, CONV, since)).toBe(0);
    expect(await ctx.agentRepliesToContact(B, CONTACT)).toBe(0);
    expect(await schedule.debounceDelayFor(B, CONV, new Date())).toBeNull();
    expect(await schedule.rescheduleDelayFor(B, CONV, new Date())).toBe(0);
    // Control positivo: con A sí.
    expect(await ctx.loadSnapshot(A, CONV)).not.toBeNull();
    expect(await ctx.pendingInbound(A, CONV)).toHaveLength(1);
    expect(await ctx.alreadyHandled(A, MSG)).toBe(true);
    expect(await ctx.modelCallsSince(A, CONV, since)).toBe(1);
    expect(await ctx.agentRepliesToContact(A, CONTACT)).toBe(1);
  });

  it("escrituras: con la organización B no cambia nada de A (y con A sí)", async () => {
    const now = new Date();
    // Un borrador vigente de A: los "obsoletar" de B no deben tocarlo.
    await db.insert(s.aiAgentDrafts).values({ id: "d_a", organizationId: A, conversationId: CONV, bubbles: ["hola"], status: "pendiente" });
    await state.setAgentState(B, CONV, "pausado_humano", { now });
    await state.markAgentReply(B, CONV, now);
    await state.addContactTag(B, CONTACT, "cruce");
    await expect(
      state.saveDraft({ organizationId: B, conversationId: CONV, bubbles: ["x"], triggerMessageId: MSG, now }),
    ).rejects.toThrow("no pertenece");
    expect(await state.obsoletePendingDrafts(B, CONV, now)).toBe(0);
    expect(await state.obsoleteChannelDrafts(B, "ch_a", now)).toBe(0);
    const c = await conv();
    expect(c).toMatchObject({ agentState: "activo", agentStateChangedAt: null, lastAgentReplyAt: null });
    expect((await contact()).tags).not.toContain("cruce");
    expect((await db.select().from(s.aiAgentDrafts)).map((d) => [d.id, d.status])).toEqual([["d_a", "pendiente"]]);
    // Control positivo: las mismas escrituras con A sí cambian.
    await state.setAgentState(A, CONV, "pausado_humano", { now });
    await state.markAgentReply(A, CONV, now);
    await state.addContactTag(A, CONTACT, "cruce");
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", lastAgentReplyAt: now });
    expect((await contact()).tags).toContain("cruce");
    expect(await state.obsoleteChannelDrafts(A, "ch_a", now)).toBe(1);
    await state.saveDraft({ organizationId: A, conversationId: CONV, bubbles: ["x"], triggerMessageId: MSG, now });
    expect((await db.select().from(s.aiAgentDrafts)).filter((d) => d.status === "pendiente")).toHaveLength(1);
    expect(await state.obsoletePendingDrafts(A, CONV, now)).toBe(1);
  });

  it("ganchos y corrida: la organización B no programa, no pausa y no llama modelos sobre A", async () => {
    const jobs: string[] = [];
    const port: import("./queue").AgentQueuePort = {
      getJob: async () => undefined,
      add: async (d) => void jobs.push(d.conversationId),
    };
    const kv: import("./queue").KvPort = {
      setNxPx: async () => true,
      setEx: async () => undefined,
      getDel: async () => null,
      delIfEquals: async () => undefined,
    };
    await hooks.onInboundCustomerMessage({ organizationId: B, conversationId: CONV, receivedAt: new Date() }, { queue: port, kv });
    await hooks.onHumanOutbound({ organizationId: B, conversationId: CONV }, { queue: port, kv });
    await hooks.pauseAgentForManualSend(B, CONV);
    await hooks.pauseAgentOnManualMessageId(B, MSG);
    expect(jobs).toEqual([]);
    expect(await conv()).toMatchObject({ agentState: "activo", lastInboundAt: null });

    const callModel = vi.fn(async (): Promise<CallModelResult> => {
      throw new Error("no debería llamarse");
    }) as unknown as (id: string, input: CallModelInput) => Promise<CallModelResult>;
    const sendBubble = vi.fn(async () => undefined);
    const r = await run.runAgent(
      { organizationId: B, conversationId: CONV },
      { now: () => new Date(), callModel, sendBubble, sleep: async () => undefined, resolveImage: async () => null },
    );
    expect(r).toEqual({ kind: "noop", reason: "conversacion_no_existe" });
    expect(callModel).not.toHaveBeenCalled();
    expect(sendBubble).not.toHaveBeenCalled();
    expect(await db.select().from(s.aiUsage)).toHaveLength(1); // solo la fila del fixture
  });
});
