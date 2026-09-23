// Enganche del Agente IA con el resto del CRM contra Postgres REAL: ganchos de
// la ingesta, pausa por mensaje humano (manual o PROGRAMADO), pausa manual y
// lecturas para la UI, y aviso SSE de los borradores. Solo con TEST_DATABASE_URL
// (base DESECHABLE con migraciones). Sin Redis: la cancelación del job falla
// rápido y se registra, sin afectar la pausa (que va primero).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingProvider, SendResult } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.REDIS_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("enganche del Agente IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let ingest: typeof import("@/lib/messaging/ingest");
  let zernio: typeof import("@/lib/messaging/zernio");
  let provider: MessagingProvider;
  let manual: typeof import("./manual");
  let state: typeof import("./state");
  let hooks: typeof import("./hooks");
  let store: typeof import("@/lib/scheduled/store");
  let dispatch: typeof import("@/lib/scheduled/dispatch");
  let events: typeof import("@/lib/inbox/events");
  const ORG = "org_eng";
  const CONV = "conv_eng";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    ingest = await import("@/lib/messaging/ingest");
    zernio = await import("@/lib/messaging/zernio");
    provider = new zernio.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    manual = await import("./manual");
    state = await import("./state");
    hooks = await import("./hooks");
    store = await import("@/lib/scheduled/store");
    dispatch = await import("@/lib/scheduled/dispatch");
    events = await import("@/lib/inbox/events");
    vi.spyOn(console, "error").mockImplementation(() => undefined); // cancelación sin Redis
  });

  afterAll(async () => {
    await events.__resetInboxHubForTests();
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, scheduled_messages, webhook_events, messages, conversations, templates, channels, contacts, member, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "eng", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_eng", name: "Vendedor", email: "v@eng.mx" });
    await db.insert(s.member).values({ id: "m_eng", organizationId: ORG, userId: "u_eng", role: "agent", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_eng",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_eng",
      displayName: "Sandbox",
      aiAgentMode: "auto",
    });
  });

  async function openConversation() {
    await db.insert(s.contacts).values({ id: "ct_eng", organizationId: ORG, firstName: "Ana", phoneE164: "+526681234567" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: "ct_eng",
      channelId: "ch_eng",
      providerConversationId: "zconv_eng",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
    });
  }
  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, CONV)))[0];

  // ── Ganchos de la ingesta ────────────────────────────────────────────────
  let seq = 0;
  function msgEvent(opts: { direction?: "incoming" | "outgoing"; source?: string; wamid?: string }) {
    seq++;
    const phone = "5216682410001";
    const outgoing = opts.direction === "outgoing";
    const at = new Date().toISOString();
    return {
      id: `evt_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: at,
      message: {
        id: `zmsg_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: opts.wamid ?? `wamid.eng.${seq}.${randomUUID()}`,
        direction: opts.direction ?? "incoming",
        text: `mensaje ${seq}`,
        attachments: [],
        sender: outgoing ? { id: "zacc_eng" } : { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: at,
        source: opts.source,
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: "zacc_eng", platform: "whatsapp" },
    };
  }

  async function deliver(payload: { id: string; event: string }, hk: import("@/lib/messaging/ingest").IngestHooks) {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    return ingest.processWebhookEvent(provider, id, hk);
  }

  it("ingesta: un entrante NUEVO avisa al agente una vez; el duplicado no", async () => {
    const onInboundMessage = vi.fn();
    const onHumanOutbound = vi.fn();
    const e = msgEvent({ wamid: "wamid.dup.1" });
    await deliver(e, { onInboundMessage, onHumanOutbound });
    expect(onInboundMessage).toHaveBeenCalledTimes(1);
    const [arg] = onInboundMessage.mock.calls[0] as [{ organizationId: string; conversationId: string; messageId: string }];
    const [m] = await db.select().from(s.messages).where(eq(s.messages.id, arg.messageId));
    expect(arg.organizationId).toBe(ORG);
    expect(m).toMatchObject({ direction: "in", conversationId: arg.conversationId });
    // El mismo wamid otra vez (reintento del proveedor): no vuelve a avisar.
    await deliver({ ...e, id: `evt_re_${randomUUID()}` }, { onInboundMessage, onHumanOutbound });
    expect(onInboundMessage).toHaveBeenCalledTimes(1);
    expect(onHumanOutbound).not.toHaveBeenCalled();
  });

  it("ingesta: el eco del vendedor desde el celular (business_app) avisa como humano; other_api no", async () => {
    const onInboundMessage = vi.fn();
    const onHumanOutbound = vi.fn();
    await deliver(msgEvent({}), { onInboundMessage, onHumanOutbound }); // crea la conversación
    await deliver(msgEvent({ direction: "outgoing", source: "whatsapp_business_app" }), { onInboundMessage, onHumanOutbound });
    expect(onHumanOutbound).toHaveBeenCalledTimes(1);
    await deliver(msgEvent({ direction: "outgoing", source: "api" }), { onInboundMessage, onHumanOutbound });
    expect(onHumanOutbound).toHaveBeenCalledTimes(1);
  });

  // ── Pausa por mensaje humano (sleepOnManualMessage) ──────────────────────
  function fakeProvider(): MessagingProvider {
    let n = 0;
    const send = async (): Promise<SendResult> => {
      n++;
      return { providerInternalId: `pint_eng_${n}`, providerMessageId: `wamid.eng.out.${n}.${randomUUID()}` };
    };
    return { name: "zernio", sendText: send, sendTemplate: send } as unknown as MessagingProvider;
  }

  it("un mensaje PROGRAMADO del vendedor pausa al agente y deja viejo el borrador vigente", async () => {
    await openConversation();
    await state.saveDraft({ organizationId: ORG, conversationId: CONV, bubbles: ["hola"], triggerMessageId: null, now: new Date() });
    const now = new Date();
    const row = await store.createScheduled({
      organizationId: ORG,
      userId: "u_eng",
      conversationId: CONV,
      cancelIfInbound: false,
      now,
      kind: "text",
      text: "¿Pudo medir la entrada?",
      sendAt: new Date(now.getTime() + 60_000),
    });
    expect(await dispatch.dispatchScheduled(fakeProvider(), row.id, row.sendAt.getTime())).toBe("sent");
    const c = await conv();
    expect(c.agentState).toBe("pausado_humano");
    const drafts = await db.select().from(s.aiAgentDrafts);
    expect(drafts.map((d) => d.status)).toEqual(["obsoleto"]);
  });

  it("con el canal apagado, un mensaje humano no pausa ni toca nada (apagarlo ya dejó viejos los borradores)", async () => {
    await openConversation();
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_eng"));
    await hooks.pauseAgentOnManualMessage(CONV);
    const c = await conv();
    expect(c.agentState).toBe("activo");
    expect(c.agentStateChangedAt).toBeNull();
  });

  // ── Pausa manual y lecturas para la UI ───────────────────────────────────
  it("interruptor del contacto: pausa y reactiva; las lecturas para la UI reflejan el estado y el borrador", async () => {
    await openConversation();
    expect(await manual.pauseAgentInConversation(ORG, CONV, new Date())).toBe(true);
    expect(await manual.pauseAgentInConversation(ORG, CONV, new Date())).toBe(false); // ya pausado
    expect(await manual.pauseAgentInConversation("otra_org", CONV, new Date())).toBe(false);
    const [row] = await manual.loadContactAgents(ORG, "ct_eng");
    expect(row).toMatchObject({ conversationId: CONV, channelName: "Sandbox", channelMode: "auto", agentState: "pausado_humano" });
    expect(await manual.loadContactAgents("otra_org", "ct_eng")).toEqual([]);

    await manual.reactivateAgentInConversation(ORG, CONV, new Date());
    await state.saveDraft({ organizationId: ORG, conversationId: CONV, bubbles: ["a", "b"], triggerMessageId: null, now: new Date() });
    const view = await manual.loadConversationAgent(ORG, CONV);
    expect(view).toMatchObject({ channelMode: "auto", agentState: "activo", pausedUntil: null });
    expect(view!.draft!.bubbles).toEqual(["a", "b"]);
    expect(await manual.loadConversationAgent("otra_org", CONV)).toBeNull();
  });

  it("guardar un borrador avisa a la bandeja por SSE (conversation.updated)", async () => {
    await openConversation();
    const got: { type: string; conversationId?: string }[] = [];
    const off = await events.subscribeToInbox(ORG, (e) => got.push(e as { type: string; conversationId?: string }));
    try {
      await state.saveDraft({ organizationId: ORG, conversationId: CONV, bubbles: ["hola"], triggerMessageId: null, now: new Date() });
      for (let i = 0; i < 50 && !got.some((e) => e.type === "conversation.updated" && e.conversationId === CONV); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(got.some((e) => e.type === "conversation.updated" && e.conversationId === CONV)).toBe(true);
    } finally {
      off();
    }
  });
});
