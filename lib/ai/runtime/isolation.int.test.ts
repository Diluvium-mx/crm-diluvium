// Aislamiento del Agente IA contra Postgres REAL: ni un fallo del agente ni el
// agente APAGADO pueden afectar la ingesta de WhatsApp ni el envío normal del
// vendedor (texto, plantilla, reintento, programado). Se simula "la BD del
// agente caída" haciendo fallar loadSnapshot, la primera lectura de todos los
// ganchos. Sin Redis: con el canal apagado nada debe intentar tocarlo.
// Solo con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingProvider, SendResult } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.REDIS_URL;

const ORG = "org_iso";
const fail = vi.hoisted(() => ({ agent: false }));
const current = vi.hoisted(() => ({ provider: null as unknown }));

vi.mock("./context", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./context")>();
  return {
    ...orig,
    loadSnapshot: async (...args: Parameters<typeof orig.loadSnapshot>) => {
      if (fail.agent) throw new Error("BD del agente caída (simulada)");
      return orig.loadSnapshot(...args);
    },
  };
});
// Las Server Actions de la bandeja resuelven sesión y proveedor: se fijan aquí.
vi.mock("@/lib/auth/active-organization", () => ({
  requireActiveMembership: async () => ({ organizationId: "org_iso", userId: "u_iso", role: "agent" }),
}));
vi.mock("@/lib/messaging", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/messaging")>();
  return { ...orig, messagingProvider: () => current.provider };
});

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("aislamiento del Agente IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let ingest: typeof import("@/lib/messaging/ingest");
  let zernio: typeof import("@/lib/messaging/zernio");
  let webhookProvider: MessagingProvider;
  let hooks: typeof import("./hooks");
  let actions: typeof import("@/lib/inbox/actions");
  let store: typeof import("@/lib/scheduled/store");
  let dispatch: typeof import("@/lib/scheduled/dispatch");
  let events: typeof import("@/lib/inbox/events");
  let errors: ReturnType<typeof vi.spyOn>;
  const CONV = "conv_iso";
  const agentGlobals = globalThis as unknown as { agentQueue?: unknown; agentRedis?: unknown };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    ingest = await import("@/lib/messaging/ingest");
    zernio = await import("@/lib/messaging/zernio");
    webhookProvider = new zernio.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    hooks = await import("./hooks");
    actions = await import("@/lib/inbox/actions");
    store = await import("@/lib/scheduled/store");
    dispatch = await import("@/lib/scheduled/dispatch");
    events = await import("@/lib/inbox/events");
  });

  afterAll(async () => {
    await events.__resetInboxHubForTests();
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    fail.agent = false;
    current.provider = fakeProvider();
    errors?.mockRestore();
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, scheduled_messages, webhook_events, messages, conversations, templates, channels, contacts, member, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "iso", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_iso", name: "Vendedor", email: "v@iso.mx" });
    await db.insert(s.member).values({ id: "m_iso", organizationId: ORG, userId: "u_iso", role: "agent", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_iso",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_iso",
      displayName: "Sandbox",
      aiAgentMode: "off",
    });
    await db.insert(s.contacts).values({ id: "ct_iso", organizationId: ORG, firstName: "Ana", phoneE164: "+526681234599" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: "ct_iso",
      channelId: "ch_iso",
      providerConversationId: "zconv_iso",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
    });
    await db.insert(s.templates).values({
      id: "tpl_iso",
      organizationId: ORG,
      channelId: "ch_iso",
      name: "seguimiento",
      language: "es_MX",
      body: "Hola {{1}}",
      status: "APPROVED",
    });
  });

  function fakeProvider(): MessagingProvider {
    let n = 0;
    const send = async (): Promise<SendResult> => {
      n++;
      return { providerInternalId: `pint_iso_${n}`, providerMessageId: `wamid.iso.out.${n}.${randomUUID()}` };
    };
    return { name: "zernio", sendText: send, sendTemplate: send } as unknown as MessagingProvider;
  }

  let seq = 0;
  function msgEvent(opts: { direction?: "incoming" | "outgoing"; source?: string } = {}) {
    seq++;
    const phone = "5216682419999";
    const outgoing = opts.direction === "outgoing";
    const at = new Date().toISOString();
    return {
      id: `evt_iso_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: at,
      message: {
        id: `zmsg_iso_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: `wamid.iso.${seq}.${randomUUID()}`,
        direction: opts.direction ?? "incoming",
        text: `mensaje ${seq}`,
        attachments: [],
        sender: outgoing ? { id: "zacc_iso" } : { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: at,
        source: opts.source,
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: "zacc_iso", platform: "whatsapp" },
    };
  }

  async function deliver(payload: { id: string; event: string }, hk: import("@/lib/messaging/ingest").IngestHooks) {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    const outcome = await ingest.processWebhookEvent(webhookProvider, id, hk);
    const [row] = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, id));
    return { outcome, processedAt: row.processedAt };
  }

  const countMessages = async (direction: "in" | "out") =>
    (await db.select().from(s.messages).where(eq(s.messages.direction, direction))).length;

  async function failedCrmMessage(): Promise<string> {
    const [m] = await db
      .insert(s.messages)
      .values({
        id: `msg_iso_${randomUUID()}`,
        organizationId: ORG,
        conversationId: CONV,
        direction: "out",
        type: "text",
        source: "crm",
        body: "¿Pudo medir la entrada?",
        status: "failed",
        errorCode: "provider_rejected",
        sentByUserId: "u_iso",
      })
      .returning({ id: s.messages.id });
    return m.id;
  }

  async function sendEverything() {
    const text = await actions.sendMessage(CONV, "Hola, ¿cómo le va?");
    const template = await actions.sendTemplate(CONV, "tpl_iso", ["Ana"]);
    const retry = await actions.retryMessage(await failedCrmMessage());
    const now = new Date();
    const row = await store.createScheduled({
      organizationId: ORG,
      userId: "u_iso",
      conversationId: CONV,
      cancelIfInbound: false,
      now,
      kind: "text",
      text: "Le escribo para seguimiento",
      sendAt: new Date(now.getTime() + 60_000),
    });
    const scheduled = await dispatch.dispatchScheduled(current.provider as MessagingProvider, row.id, row.sendAt.getTime());
    const [after] = await db.select().from(s.scheduledMessages).where(eq(s.scheduledMessages.id, row.id));
    return { text, template, retry, scheduled, scheduledStatus: after.status };
  }

  // ── Agente APAGADO: todo igual que sin agente, y nada toca Redis ─────────
  it("apagado: la ingesta guarda y los cuatro envíos salen, sin errores ni Redis", async () => {
    const inbound = await deliver(msgEvent(), hooks.agentIngestHooks);
    const echo = await deliver(msgEvent({ direction: "outgoing", source: "whatsapp_business_app" }), hooks.agentIngestHooks);
    expect(inbound.outcome).toContain("entrante guardado");
    expect(inbound.processedAt).not.toBeNull();
    expect(echo.processedAt).not.toBeNull();

    const r = await sendEverything();
    expect(r.text).toMatchObject({ ok: true });
    expect(r.template).toMatchObject({ ok: true });
    expect(r.retry).toMatchObject({ ok: true });
    expect(r.scheduled).toBe("sent");
    expect(r.scheduledStatus).toBe("sent");

    expect(errors).not.toHaveBeenCalled();
    expect(agentGlobals.agentQueue).toBeUndefined();
    expect(agentGlobals.agentRedis).toBeUndefined();
    expect(await db.select().from(s.aiUsage)).toEqual([]);
    const [c] = await db.select().from(s.conversations).where(eq(s.conversations.id, CONV));
    expect(c.agentState).toBe("activo");
  });

  // ── Agente con la BD caída (apagado y encendido): se registra y se sigue ──
  for (const mode of ["off", "auto"] as const) {
    it(`agente ${mode} con falla interna: la ingesta y los envíos no se enteran`, async () => {
      await db.update(s.channels).set({ aiAgentMode: mode }).where(eq(s.channels.id, "ch_iso"));
      fail.agent = true;
      const before = await countMessages("in");
      const inbound = await deliver(msgEvent(), hooks.agentIngestHooks);
      const echo = await deliver(msgEvent({ direction: "outgoing", source: "whatsapp_business_app" }), hooks.agentIngestHooks);
      expect(inbound.outcome).toContain("entrante guardado");
      expect(inbound.processedAt).not.toBeNull();
      expect(echo.processedAt).not.toBeNull();
      expect(await countMessages("in")).toBe(before + 1);

      const r = await sendEverything();
      expect(r).toMatchObject({
        text: { ok: true },
        template: { ok: true },
        retry: { ok: true },
        scheduled: "sent",
        scheduledStatus: "sent",
      });
      // La falla sí queda registrada (no se traga en silencio).
      expect(errors).toHaveBeenCalled();
      expect(String(errors.mock.calls[0][0])).toContain("[agente]");
    });
  }

  // ── Frontera de la ingesta: aunque un gancho LANCE, el mensaje queda ─────
  it("un gancho que lanza (síncrono o async) no tumba ni reencola la ingesta", async () => {
    const boom = () => {
      throw new Error("gancho roto");
    };
    const inbound = await deliver(msgEvent(), { onInboundMessage: boom });
    expect(inbound.outcome).toContain("entrante guardado");
    expect(inbound.processedAt).not.toBeNull();
    const echo = await deliver(msgEvent({ direction: "outgoing", source: "whatsapp_business_app" }), {
      onHumanOutbound: async () => Promise.reject(new Error("gancho roto")),
    });
    expect(echo.processedAt).not.toBeNull();
    expect(await countMessages("in")).toBe(1);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(String(errors.mock.calls[0][0])).toContain("[ingest] gancho del Agente IA");
  });
});
