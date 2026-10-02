// Canal Instagram contra Postgres REAL (docs/instagram.md): el cliente es un contacto
// aparte identificado por su id de Instagram, la regla de 24 h / 7 días y una sola burbuja
// por envío aunque Meta lo parta en varios mensajes. Solo corre con TEST_DATABASE_URL
// apuntando a una base DESECHABLE con las migraciones aplicadas; borra sus datos al
// empezar. Nunca a staging ni prod.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type P = import("./provider").MessagingProvider;
type SendTextInput = import("./provider").SendTextInput;

describe.skipIf(!TEST_DATABASE_URL)("canal Instagram (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ingest: typeof import("./ingest");
  let send: typeof import("./send");
  let eq: typeof import("drizzle-orm").eq;
  let provider: P;
  const ORG = "org_ig";
  const IGSID = "17841400000000001";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    send = await import("./send");
    ({ eq } = await import("drizzle-orm"));
    const z = await import("./zernio");
    provider = new z.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_vendedor", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_ig",
      organizationId: ORG,
      type: "instagram",
      provider: "zernio",
      providerAccountId: "zacc_ig",
      displayName: "Instagram @diluvium",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  function igEvent(opts: {
    sentAt: string;
    direction?: "incoming" | "outgoing";
    mid?: string;
    text?: string | null;
    sentVia?: string | null;
    igsid?: string;
    username?: string;
    conv?: string;
  }) {
    seq++;
    const outgoing = opts.direction === "outgoing";
    const igsid = opts.igsid ?? IGSID;
    const conv = opts.conv ?? `6ab0000000000000000${String(seq).padStart(5, "0")}`.slice(0, 24);
    return {
      id: `evt_${seq}_${randomUUID()}`,
      event: outgoing ? "message.sent" : "message.received",
      timestamp: opts.sentAt,
      message: {
        id: `6ab00000000000000000${String(seq).padStart(4, "0")}`,
        conversationId: conv,
        platform: "instagram",
        platformMessageId: opts.mid ?? `aWdf${seq}${randomUUID().replace(/-/g, "")}`,
        direction: opts.direction ?? "incoming",
        text: opts.text === undefined ? `mensaje ${seq}` : opts.text,
        attachments: [],
        sender: outgoing ? { id: "zacc_ig", username: "diluvium" } : { id: igsid, name: "Ana López", username: opts.username ?? "ana.lopez" },
        sentAt: opts.sentAt,
        sentVia: outgoing ? (opts.sentVia === undefined ? "api" : opts.sentVia) : null,
      },
      conversation: { id: conv, participantId: igsid, participantName: "Ana López", participantUsername: opts.username ?? "ana.lopez" },
      account: { id: "zacc_ig", platform: "instagram" },
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

  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  it("un DM nuevo crea un contacto SIN teléfono, con su id y @usuario, de Instagram", async () => {
    await deliver(igEvent({ sentAt: ago(0.1), conv: "6ab0000000000000000000c1" }));
    const [contact] = await db.select().from(s.contacts);
    expect(contact).toMatchObject({
      phoneE164: null,
      waBsuid: null,
      instagramId: IGSID,
      instagramUsername: "ana.lopez",
      firstName: "Ana López",
      sourceChannel: "instagram",
      source: "instagram",
    });
    const [conversation] = await db.select().from(s.conversations);
    expect(conversation.windowExpiresAt).not.toBeNull();
    expect(conversation.unreadCount).toBe(1);
  });

  it("el mismo cliente en otra conversación de Zernio sigue siendo UN contacto; su @usuario nuevo se actualiza", async () => {
    await deliver(igEvent({ sentAt: ago(2), conv: "6ab0000000000000000000c1" }));
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c2", username: "ana.nueva" }));
    const all = await db.select().from(s.contacts);
    expect(all).toHaveLength(1);
    expect(all[0].instagramUsername).toBe("ana.nueva");
  });

  it("un id de Instagram numérico jamás se guarda como teléfono, aunque parezca uno", async () => {
    await deliver(igEvent({ sentAt: ago(0.1), igsid: "5216682410001", conv: "6ab0000000000000000000c3" }));
    const [contact] = await db.select().from(s.contacts);
    expect(contact.phoneE164).toBeNull();
    expect(contact.instagramId).toBe("5216682410001");
  });

  it("de 24 h a 7 días: el Agente IA no puede; un vendedor sí, con la etiqueta HUMAN_AGENT", async () => {
    await deliver(igEvent({ sentAt: ago(30), conv: "6ab0000000000000000000c4" }));
    const [c] = await db.select().from(s.conversations);
    const sent: SendTextInput[] = [];
    const p = withProvider({
      sendText: async (input) => {
        sent.push(input);
        return { providerInternalId: `MID_${sent.length}`, providerMessageId: `MID_${sent.length}` };
      },
    });
    await expect(
      send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "hola", source: "ai_agent", sentByUserId: null }),
    ).rejects.toMatchObject({ code: "window_closed" });
    const out = await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "hola", sentByUserId: "u_vendedor", humanAgent: true });
    expect(out.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ platform: "instagram", humanAgentTag: true });
  });

  it("dentro de 24 h no lleva etiqueta; pasados 7 días nadie puede escribir", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c5" }));
    const [c] = await db.select().from(s.conversations);
    const sent: SendTextInput[] = [];
    const p = withProvider({
      sendText: async (input) => {
        sent.push(input);
        return { providerInternalId: "MID_X", providerMessageId: "MID_X" };
      },
    });
    await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "hola", source: "ai_agent", sentByUserId: null });
    expect(sent[0]).toMatchObject({ platform: "instagram", humanAgentTag: false });

    await db.update(s.conversations).set({ windowExpiresAt: new Date(Date.now() - 7 * 24 * 3_600_000) }).where(eq(s.conversations.id, c.id));
    await expect(
      send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "hola", sentByUserId: "u_vendedor", humanAgent: true }),
    ).rejects.toMatchObject({ code: "window_closed", message: expect.stringContaining("7 días") });
  });

  it("Instagram no tiene plantillas", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c6" }));
    const [c] = await db.select().from(s.conversations);
    await expect(
      send.sendTemplateMessage(withProvider({}), { organizationId: ORG, conversationId: c.id, sentByUserId: "u_vendedor", templateId: "t", variableValues: [] }),
    ).rejects.toMatchObject({ code: "template_not_found", message: expect.stringContaining("Instagram") });
  });

  it("un envío en dos partes es UNA burbuja: los ecos de ambas partes no se duplican (eco después)", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c7" }));
    const [c] = await db.select().from(s.conversations);
    const p = withProvider({ sendText: async () => ({ providerInternalId: "MID_1", providerMessageId: "MID_1", extraProviderMessageIds: ["MID_2"] }) });
    const out = await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "texto largo", sentByUserId: "u_vendedor", humanAgent: true });
    const now = new Date().toISOString();
    await deliver(igEvent({ sentAt: now, direction: "outgoing", mid: "MID_1", text: "texto", conv: "6ab0000000000000000000c7" }));
    await deliver(igEvent({ sentAt: now, direction: "outgoing", mid: "MID_2", text: "largo", conv: "6ab0000000000000000000c7" }));
    const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(outs).toHaveLength(1);
    expect(outs[0].id).toBe(out.messageId);
    expect(outs[0].metadata).toMatchObject({ partesInstagram: ["MID_2"] });
  });

  it("si el eco de la 2.ª parte llega ANTES de confirmar el envío, se borra al enlazar (una sola burbuja)", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c8" }));
    const [c] = await db.select().from(s.conversations);
    const p = withProvider({
      sendText: async () => {
        // El eco de la segunda parte llega mientras el POST sigue en vuelo.
        await deliver(igEvent({ sentAt: new Date().toISOString(), direction: "outgoing", mid: "MID_B2", text: "largo", conv: "6ab0000000000000000000c8" }));
        return { providerInternalId: "MID_B1", providerMessageId: "MID_B1", extraProviderMessageIds: ["MID_B2"], warning: undefined };
      },
    });
    await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "texto largo", sentByUserId: "u_vendedor", humanAgent: true });
    const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(outs).toHaveLength(1);
    expect(outs[0].providerMessageId).toBe("MID_B1");
  });

  it("un aviso de envío incompleto queda guardado en la burbuja", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000c9" }));
    const [c] = await db.select().from(s.conversations);
    const p = withProvider({ sendText: async () => ({ providerInternalId: "MID_W", providerMessageId: "MID_W", warning: "La parte 2 de 2 del texto no salió en Instagram: x" }) });
    await send.sendTextMessage(p, { organizationId: ORG, conversationId: c.id, text: "t", sentByUserId: "u_vendedor", humanAgent: true });
    const [row] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(row.status).toBe("sent");
    expect(row.metadata).toMatchObject({ avisoEnvio: expect.stringContaining("parte 2 de 2") });
  });

  it("lo que un vendedor manda desde la app de Instagram se guarda como de la app (pausa al Agente IA)", async () => {
    await deliver(igEvent({ sentAt: ago(1), conv: "6ab0000000000000000000d1" }));
    await deliver(igEvent({ sentAt: new Date().toISOString(), direction: "outgoing", sentVia: null, text: "te llamo", conv: "6ab0000000000000000000d1" }));
    const [row] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(row.source).toBe("business_app");
    expect(row.body).toBe("te llamo");
  });
});
