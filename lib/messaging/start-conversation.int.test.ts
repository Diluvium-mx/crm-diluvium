// Primer mensaje a un contacto sin chat (28-sep-2026) contra Postgres REAL, con
// Zernio simulado (fetch): qué se crea, qué se enlaza y qué se deshace según
// conteste Zernio, y qué se bloquea antes de llamar a nadie.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("primer mensaje con plantilla (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let lib: typeof import("./start-conversation");
  let provider: import("./provider").MessagingProvider;
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_start";
  const NOW = new Date("2026-09-28T18:00:00Z");
  const base = { organizationId: ORG, templateId: "tpl_ok", variableValues: [] as string[], sentByUserId: "u_start", now: NOW };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    lib = await import("./start-conversation");
    ({ eq } = await import("drizzle-orm"));
    const z = await import("./zernio");
    provider = new z.ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (input, init) => globalThis.fetch(input, init));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "start", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_start", name: "Daniel", email: "daniel@start.mx" });
    await db.insert(s.channels).values({
      id: "ch_of",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_of",
      displayName: "Oficial",
      isActive: true,
    });
    await db.insert(s.templates).values([
      { id: "tpl_ok", organizationId: ORG, channelId: "ch_of", name: "hola_buenas_tardes", language: "es_MX", body: "Hola, buenas tardes.", status: "APPROVED" },
      { id: "tpl_rev", organizationId: ORG, channelId: "ch_of", name: "en_revision", language: "es_MX", body: "Hola.", status: "PENDING" },
    ]);
    await db.insert(s.contacts).values([
      { id: "c_nuevo", organizationId: ORG, firstName: "Ana", phoneE164: "+526681234567", createdAt: new Date("2026-09-20") },
      { id: "c_sin_tel", organizationId: ORG, firstName: "Sin teléfono", createdAt: new Date("2026-09-20") },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  function zernio(handler: (url: string, init?: RequestInit) => Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => handler(String(input), init));
  }

  it("contacto sin chat: abre el hilo con la plantilla y enlaza conversación y mensaje", async () => {
    const fetchSpy = zernio(() => Response.json({ success: true, data: { messageId: "wamid.S1", conversationId: "zconv_1" } }, { status: 201 }));
    const out = await lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo" });

    expect(out.status).toBe("sent");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/inbox\/conversations$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      accountId: "zacc_of",
      participantId: "526681234567",
      templateName: "hola_buenas_tardes",
      templateLanguage: "es_MX",
    });
    const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, out.conversationId));
    expect(conv).toMatchObject({ contactId: "c_nuevo", channelId: "ch_of", providerConversationId: "zconv_1" });
    const msgs = await db.select().from(s.messages).where(eq(s.messages.conversationId, out.conversationId));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direction: "out",
      source: "crm",
      type: "template",
      body: "Hola, buenas tardes.",
      templateName: "hola_buenas_tardes",
      status: "sent",
      providerMessageId: "wamid.S1",
      sentByUserId: "u_start",
    });
  });

  it("rechazado por Meta: no queda ni la conversación ni el mensaje", async () => {
    zernio(() => Response.json({ error: { message: "Template not approved" } }, { status: 400 }));
    await expect(lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo" })).rejects.toMatchObject({
      outcome: "rejected",
      message: "Template not approved",
    });
    expect(await db.select().from(s.conversations)).toHaveLength(0);
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });

  it("resultado desconocido (5xx): queda enviando, sin reintento y sin enlazar", async () => {
    zernio(() => Response.json({ error: { message: "upstream" } }, { status: 502 }));
    const out = await lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo" });
    expect(out.status).toBe("pending");
    const [conv] = await db.select().from(s.conversations);
    expect(conv.providerConversationId).toBeNull();
    const [msg] = await db.select().from(s.messages);
    expect(msg.status).toBe("queued");
    expect(msg.errorCode).toMatch(/^send_unknown/);
  });

  it("con chat ya enlazado es un envío normal en su conversación (no abre otro hilo)", async () => {
    await db.insert(s.conversations).values({
      id: "conv_ya",
      organizationId: ORG,
      contactId: "c_nuevo",
      channelId: "ch_of",
      providerConversationId: "zconv_ya",
    });
    const fetchSpy = zernio(() => Response.json({ success: true, data: { messageId: "wamid.S2" } }));
    const out = await lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo" });
    expect(out.conversationId).toBe("conv_ya");
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/v1\/inbox\/conversations\/zconv_ya\/messages$/);
    expect(await db.select().from(s.conversations)).toHaveLength(1);
  });

  it("número repetido en un contacto más antiguo (+521): avisa cuál es y no manda nada", async () => {
    await db.insert(s.contacts).values({ id: "c_viejo", organizationId: ORG, firstName: "Ana", lastName: "GHL", phoneE164: "+5216681234567", createdAt: new Date("2025-01-01") });
    const fetchSpy = zernio(() => Response.json({}));
    await expect(lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo" })).rejects.toMatchObject({
      code: "duplicate_phone",
      otherContactId: "c_viejo",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.conversations)).toHaveLength(0);
  });

  it("sin teléfono o con plantilla sin aprobar: no llama a Zernio ni crea nada", async () => {
    const fetchSpy = zernio(() => Response.json({}));
    await expect(lib.startConversationWithTemplate(provider, { ...base, contactId: "c_sin_tel" })).rejects.toMatchObject({ code: "no_phone" });
    await expect(lib.startConversationWithTemplate(provider, { ...base, contactId: "c_nuevo", templateId: "tpl_rev" })).rejects.toMatchObject({
      code: "template_not_approved",
    });
    await expect(lib.startConversationWithTemplate(provider, { ...base, organizationId: "org_otra", contactId: "c_nuevo" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.conversations)).toHaveLength(0);
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });
});
