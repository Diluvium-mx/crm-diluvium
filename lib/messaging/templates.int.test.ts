// Plantillas del sandbox de Zernio (cuenta compartida, no son de Diluvium) contra
// Postgres REAL: quedan guardadas pero OCULTAS, la sincronización no las vuelve a
// traer (ni llama a Zernio), y no se envían ni se programan. Nada se borra.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const SANDBOX_ACCOUNT = "6a180a034c7f364ffded3c9c";

describe.skipIf(!TEST_DATABASE_URL)("plantillas del sandbox de Zernio (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let templatesLib: typeof import("./templates");
  let send: typeof import("./send");
  let store: typeof import("@/lib/scheduled/store");
  let provider: import("./provider").MessagingProvider;
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_tpl";
  const NOW = new Date("2026-09-24T18:00:00Z");
  const prevEnv = { key: process.env.ZERNIO_API_KEY, secret: process.env.ZERNIO_WEBHOOK_SECRET };

  beforeAll(async () => {
    process.env.ZERNIO_API_KEY = "k";
    process.env.ZERNIO_WEBHOOK_SECRET = "s";
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    templatesLib = await import("./templates");
    send = await import("./send");
    store = await import("@/lib/scheduled/store");
    ({ eq } = await import("drizzle-orm"));
    const z = await import("./zernio");
    provider = new z.ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate scheduled_messages, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "tpl", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_tpl", name: "Ana", email: "ana@tpl.mx" });
    // Canal propio (inactivo por ahora) y el sandbox compartido (activo, más nuevo).
    await db.insert(s.channels).values([
      { id: "ch_propio", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_diluvium", displayName: "Diluvium", isActive: false, createdAt: new Date("2026-09-01") },
      { id: "ch_sandbox", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: SANDBOX_ACCOUNT, displayName: "Sandbox", isActive: true, createdAt: new Date("2026-09-10") },
    ]);
    await db.insert(s.templates).values([
      { id: "t_propia", organizationId: ORG, channelId: "ch_propio", name: "seguimiento", language: "es_MX", body: "Hola {{1}}", status: "APPROVED" },
      { id: "t_sandbox", organizationId: ORG, channelId: "ch_sandbox", name: "sandbox_start", language: "en", body: "Hi {{1}}", status: "APPROVED" },
      { id: "t_sandbox2", organizationId: ORG, channelId: "ch_sandbox", name: "presclick_order_in_transit", language: "es", body: "Pedido {{1}}", status: "APPROVED" },
    ]);
    await db.insert(s.contacts).values({ id: "c_tpl", organizationId: ORG, firstName: "Luis", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values({
      id: "conv_sandbox",
      organizationId: ORG,
      contactId: "c_tpl",
      channelId: "ch_sandbox",
      providerConversationId: "zconv_tpl",
      windowExpiresAt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    process.env.ZERNIO_API_KEY = prevEnv.key;
    process.env.ZERNIO_WEBHOOK_SECRET = prevEnv.secret;
    if (prevEnv.key === undefined) delete process.env.ZERNIO_API_KEY;
    if (prevEnv.secret === undefined) delete process.env.ZERNIO_WEBHOOK_SECRET;
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("la lista del CRM no muestra las del sandbox; siguen guardadas (no se borró nada)", async () => {
    const list = await templatesLib.listTemplatesForOrg(ORG);
    expect(list.map((t) => t.id)).toEqual(["t_propia"]);
    const all = await db.select().from(s.templates).where(eq(s.templates.organizationId, ORG));
    expect(all).toHaveLength(3);
    // Otra organización no ve nada de esta.
    expect(await templatesLib.listTemplatesForOrg("org_otra")).toEqual([]);
  });

  it("sincronizar con el canal del sandbox no llama a Zernio ni toca lo guardado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(templatesLib.syncTemplatesForOrg(ORG)).rejects.toBeInstanceOf(templatesLib.TemplatesSandboxError);
    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await db.select({ id: s.templates.id, status: s.templates.status }).from(s.templates);
    expect(rows.every((r) => r.status === "APPROVED")).toBe(true);
    expect(rows).toHaveLength(3);
    expect(await templatesLib.activeChannelIsForeign(ORG)).toBe(true);
  });

  it("con el número propio activo, el aviso del sandbox desaparece", async () => {
    await db.update(s.channels).set({ isActive: false }).where(eq(s.channels.id, "ch_sandbox"));
    await db.update(s.channels).set({ isActive: true }).where(eq(s.channels.id, "ch_propio"));
    expect(await templatesLib.activeChannelIsForeign(ORG)).toBe(false);
  });

  it("una plantilla del sandbox no se envía (ni se llama a Zernio ni queda fila en cola)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      send.sendTemplateMessage(provider, {
        organizationId: ORG,
        conversationId: "conv_sandbox",
        sentByUserId: "u_tpl",
        templateId: "t_sandbox",
        variableValues: ["Luis"],
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "template_not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });

  it("una plantilla del sandbox no se programa", async () => {
    await expect(
      store.createScheduled({
        organizationId: ORG,
        userId: "u_tpl",
        conversationId: "conv_sandbox",
        sendAt: new Date(Date.now() + 2 * 3_600_000),
        cancelIfInbound: true,
        kind: "template",
        templateId: "t_sandbox",
        templateParams: ["Luis"],
      }),
    ).rejects.toThrow(/no existe en el canal/);
    expect(await db.select().from(s.scheduledMessages)).toHaveLength(0);
  });
});
