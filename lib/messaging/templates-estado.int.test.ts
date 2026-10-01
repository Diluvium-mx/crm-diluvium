// «Ver estado» y la revisión sola del worker (1-oct-2026) contra Postgres REAL, con Zernio
// simulado: el worker solo consulta a Meta si hay plantillas EN REVISIÓN (y nunca las del
// sandbox), pone al día el estado y al Historial va solo lo que cambió.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const SANDBOX_ACCOUNT = "6a180a034c7f364ffded3c9c";

// El proveedor real de Zernio, leyendo globalThis.fetch en cada llamada (cada prueba simula el suyo).
vi.mock("./index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./index")>();
  const { ZernioProvider } = await import("./zernio");
  const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (input, init) => globalThis.fetch(input, init));
  return { ...actual, messagingProvider: () => provider };
});

describe.skipIf(!TEST_DATABASE_URL)("plantillas al día solas (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let lib: typeof import("./templates");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_estado";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    lib = await import("./templates");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate change_history, templates, channels, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "estado", createdAt: new Date() });
    await db.insert(s.channels).values([
      { id: "ch_of", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_of", displayName: "Oficial", isActive: true },
      { id: "ch_sb", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: SANDBOX_ACCOUNT, displayName: "Sandbox", isActive: true, createdAt: new Date("2020-01-01") },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const meta = (status: string) =>
    Response.json({
      templates: [{ id: "1", name: "hola_buenas_tardes", language: "es_MX", category: "MARKETING", status, components: [{ type: "BODY", text: "Hola, buenas tardes." }] }],
    });

  it("con una en revisión: consulta a Meta, la deja Aprobada y lo anota en el Historial sin autor", async () => {
    await db.insert(s.templates).values({ id: "t1", organizationId: ORG, channelId: "ch_of", name: "hola_buenas_tardes", language: "es_MX", body: "Hola, buenas tardes.", status: "PENDING" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => meta("APPROVED"));

    expect(await lib.refreshTemplatesInReview()).toBe(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("accountId=zacc_of");
    const [row] = await db.select().from(s.templates).where(eq(s.templates.id, "t1"));
    expect(row.status).toBe("APPROVED");
    const history = await db.select().from(s.changeHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "plantillas", action: "sincronizar", userId: null });
  });

  it("sin plantillas en revisión (o solo en el sandbox) no consulta nada", async () => {
    await db.insert(s.templates).values([
      { id: "t1", organizationId: ORG, channelId: "ch_of", name: "hola_buenas_tardes", language: "es_MX", status: "APPROVED" },
      { id: "t2", organizationId: ORG, channelId: "ch_sb", name: "sandbox_start", language: "en", status: "PENDING" },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await lib.refreshTemplatesInReview()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("«Ver estado» sin cambios no llena el Historial", async () => {
    await db.insert(s.templates).values({ id: "t1", organizationId: ORG, channelId: "ch_of", name: "hola_buenas_tardes", language: "es_MX", body: "Hola, buenas tardes.", status: "APPROVED" });
    await db.update(s.channels).set({ isActive: false }).where(eq(s.channels.id, "ch_sb"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => meta("APPROVED"));
    await lib.syncTemplatesForOrg(ORG, { userId: null });
    expect(await db.select().from(s.changeHistory)).toHaveLength(0);
  });
});
