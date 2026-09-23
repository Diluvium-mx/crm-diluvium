// Envío de texto del Agente IA (source "ai_agent", sin usuario) contra Postgres
// REAL. Verifica que los parámetros opcionales de sendTextMessage no cambian el
// comportamiento del envío humano y que la autoría del agente sobrevive al eco.
// Solo corre con TEST_DATABASE_URL apuntando a una base DESECHABLE con las
// migraciones aplicadas; borra sus datos al empezar. Nunca a staging ni prod.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type P = import("./provider").MessagingProvider;

describe.skipIf(!TEST_DATABASE_URL)("envío del Agente IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ingest: typeof import("./ingest");
  let send: typeof import("./send");
  let eq: typeof import("drizzle-orm").eq;
  let provider: P;
  let ZernioSendError: typeof import("./zernio").ZernioSendError;
  const ORG = "org_agente";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    send = await import("./send");
    ({ eq } = await import("drizzle-orm"));
    const z = await import("./zernio");
    ZernioSendError = z.ZernioSendError;
    provider = new z.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_a",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_1",
      displayName: "Diluvium",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  function msgEvent(opts: { direction?: "incoming" | "outgoing"; source?: string; wamid?: string; sentAt: string }) {
    seq++;
    const phone = "5216682410001";
    const outgoing = opts.direction === "outgoing";
    return {
      id: `evt_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: opts.sentAt,
      message: {
        id: `zmsg_${seq}`,
        conversationId: `zconv_${phone}`,
        platform: "whatsapp",
        platformMessageId: opts.wamid ?? `wamid.${seq}.${randomUUID()}`,
        direction: opts.direction ?? "incoming",
        text: `mensaje ${seq}`,
        attachments: [],
        sender: outgoing ? { id: "zacc_1" } : { id: phone, name: "Cliente", phoneNumber: phone },
        sentAt: opts.sentAt,
        source: opts.source,
      },
      conversation: { id: `zconv_${phone}`, participantId: phone, participantName: "Cliente" },
      account: { id: "zacc_1", platform: "whatsapp" },
    };
  }

  async function deliver(payload: { id: string; event: string }) {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    return ingest.processWebhookEvent(provider, id);
  }

  const withProvider = (overrides: Partial<P>) =>
    ({
      name: "zernio",
      verifyWebhook: () => true,
      readEnvelope: provider.readEnvelope.bind(provider),
      normalize: provider.normalize.bind(provider),
      fetchMedia: provider.fetchMedia.bind(provider),
      sendText: async () => {
        throw new Error("no se esperaba sendText");
      },
      ...overrides,
    }) as P;

  const outs = () => db.select().from(s.messages).where(eq(s.messages.direction, "out"));
  const conv = async () => (await db.select().from(s.conversations))[0];

  async function openConversation(unread: number) {
    for (let i = 0; i < unread; i++) {
      await deliver(msgEvent({ sentAt: new Date(Date.now() - 60_000 + i).toISOString() }));
    }
    return conv();
  }

  it("ai_agent sin usuario: se guarda como ai_agent, NO descuenta no leídos y NO es primera respuesta", async () => {
    const c = await openConversation(2);
    const out = await send.sendTextMessage(
      withProvider({ sendText: async () => ({ providerInternalId: "zA1", providerMessageId: "wamid.A1" }) }),
      { organizationId: ORG, conversationId: c.id, text: "Hola, ¿en qué te ayudo?", source: "ai_agent" },
    );
    expect(out.status).toBe("sent");
    const [m] = await outs();
    expect(m).toMatchObject({ source: "ai_agent", sentByUserId: null, status: "sent", providerMessageId: "wamid.A1" });
    const after = await conv();
    expect(after.unreadCount).toBe(2); // el vendedor sigue viendo lo que entró
    expect(after.firstResponseSeconds).toBeNull(); // el bot no cuenta como primera respuesta humana
  });

  it("sin source sigue siendo el envío humano de siempre (crm + vendedor, marca leído, primera respuesta)", async () => {
    const c = await openConversation(2);
    await send.sendTextMessage(
      withProvider({ sendText: async () => ({ providerInternalId: "zH1", providerMessageId: "wamid.H1" }) }),
      { organizationId: ORG, conversationId: c.id, sentByUserId: "u_vendedor", text: "Claro" },
    );
    const [m] = await outs();
    expect(m).toMatchObject({ source: "crm", sentByUserId: "u_vendedor" });
    const after = await conv();
    expect(after.unreadCount).toBe(0);
    expect(after.firstResponseSeconds).not.toBeNull();
  });

  it("el eco que llega ANTES de la respuesta de la API conserva la autoría del agente (no se vuelve humano)", async () => {
    const c = await openConversation(1);
    const p = withProvider({
      sendText: async () => {
        // Zernio entrega el eco (other_api) antes de que vuelva el POST.
        await deliver(msgEvent({ direction: "outgoing", wamid: "wamid.E1", sentAt: new Date().toISOString() }));
        return { providerInternalId: "zE1", providerMessageId: "wamid.E1" };
      },
    });
    await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "va", source: "ai_agent" });
    const rows = await outs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ai_agent", sentByUserId: null, providerMessageId: "wamid.E1" });
  });

  it("un envío del agente de resultado desconocido también se expira (send_unconfirmed)", async () => {
    const c = await openConversation(1);
    const out = await send.sendTextMessage(
      withProvider({ sendText: async () => { throw new ZernioSendError(0, "network", "x", "unknown"); } }),
      { organizationId: ORG, conversationId: c.id, text: "x", source: "ai_agent" },
    );
    expect(out.status).toBe("pending");
    const n = await send.expireUnconfirmedSends(new Date(Date.now() + send.SEND_UNCONFIRMED_AFTER_MS + 60_000));
    expect(n).toBe(1);
    expect((await outs())[0]).toMatchObject({ source: "ai_agent", status: "failed", errorCode: "send_unconfirmed" });
  });
});
