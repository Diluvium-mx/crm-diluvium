// Editar y borrar plantillas (28-sep-2026) contra Postgres REAL, con Zernio simulado
// (fetch): qué se le pide a Meta, qué queda en la tabla y en el Historial, y qué se
// bloquea antes de llamar a nadie (programados pendientes, revisión en curso, texto
// que Meta rechazaría, sandbox, otra organización).
// Solo corre con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const SANDBOX_ACCOUNT = "6a180a034c7f364ffded3c9c";

// El proveedor real de Zernio, pero leyendo globalThis.fetch EN CADA llamada: el de
// ./index se guarda en caché con el fetch del momento y cada prueba simula el suyo.
vi.mock("./index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./index")>();
  const { ZernioProvider } = await import("./zernio");
  const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (input, init) => globalThis.fetch(input, init));
  return { ...actual, messagingProvider: () => provider };
});

describe.skipIf(!TEST_DATABASE_URL)("editar y borrar plantillas (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let lib: typeof import("./templates");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_tpl_eb";
  const LOG = { userId: "u_eb" };
  const prevEnv = { key: process.env.ZERNIO_API_KEY, secret: process.env.ZERNIO_WEBHOOK_SECRET };

  beforeAll(async () => {
    process.env.ZERNIO_API_KEY = "k";
    process.env.ZERNIO_WEBHOOK_SECRET = "s";
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    lib = await import("./templates");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate change_history, scheduled_messages, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "tpl-eb", createdAt: new Date() },
      { id: "org_otra", name: "Otra", slug: "otra-eb", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_eb", name: "Daniel", email: "daniel@eb.mx" });
    await db.insert(s.channels).values([
      { id: "ch_oficial", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_oficial", displayName: "Oficial", isActive: true },
      { id: "ch_sandbox", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: SANDBOX_ACCOUNT, displayName: "Sandbox", isActive: false },
    ]);
    await db.insert(s.templates).values([
      {
        id: "t_ok",
        organizationId: ORG,
        channelId: "ch_oficial",
        name: "saludo_tardes",
        language: "es_MX",
        category: "MARKETING",
        body: "Hola {{1}}, buenas tardes.",
        variables: [{ index: 1, example: "Ana" }],
        status: "APPROVED",
      },
      { id: "t_revision", organizationId: ORG, channelId: "ch_oficial", name: "en_revision", language: "es_MX", body: "Hola.", status: "PENDING" },
      { id: "t_sandbox", organizationId: ORG, channelId: "ch_sandbox", name: "sandbox_start", language: "en", body: "Hi {{1}}", status: "APPROVED" },
    ]);
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

  function zernio(handler: (url: string, init?: RequestInit) => Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => handler(String(input), init));
  }

  async function history() {
    return db.select().from(s.changeHistory).where(eq(s.changeHistory.organizationId, ORG));
  }

  // ── Borrar ──────────────────────────────────────────────────────────────────

  it("borrar: pide a Meta el nombre + idioma exactos, quita la fila y lo deja en el Historial", async () => {
    const fetchSpy = zernio(() => Response.json({ success: true, scope: "language", language: "es_MX" }));
    await lib.deleteTemplateForOrg(ORG, "t_ok", LOG);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/v1/whatsapp/templates/saludo_tardes?accountId=zacc_oficial&language=es_MX");
    expect(init?.method).toBe("DELETE");
    expect(await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"))).toHaveLength(0);
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "plantillas", action: "borrar", subject: "saludo_tardes", userId: "u_eb" });
  });

  it("borrar: si Meta ya no la tenía (404), se quita de aquí igual", async () => {
    zernio(() => Response.json({ error: { message: "Template not found" } }, { status: 404 }));
    await lib.deleteTemplateForOrg(ORG, "t_ok", LOG);
    expect(await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"))).toHaveLength(0);
  });

  it("borrar: otro error de Meta NO quita la fila ni escribe Historial", async () => {
    zernio(() => Response.json({ error: { message: "Meta unreachable" } }, { status: 502 }));
    await expect(lib.deleteTemplateForOrg(ORG, "t_ok", LOG)).rejects.toMatchObject({ name: "ZernioApiError", httpStatus: 502 });
    expect(await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"))).toHaveLength(1);
    expect(await history()).toHaveLength(0);
  });

  it("borrar: con un programado pendiente que la usa NO llama a Meta", async () => {
    await db.insert(s.contacts).values({ id: "c_eb", organizationId: ORG, firstName: "Luis", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values({
      id: "conv_eb",
      organizationId: ORG,
      contactId: "c_eb",
      channelId: "ch_oficial",
      providerConversationId: "zconv_eb",
    });
    await db.insert(s.scheduledMessages).values({
      id: "sch_eb",
      organizationId: ORG,
      conversationId: "conv_eb",
      createdByUserId: "u_eb",
      kind: "template",
      body: "Hola Luis, buenas tardes.",
      templateId: "t_ok",
      templateParams: ["Luis"],
      sendAt: new Date(Date.now() + 3_600_000),
      programmedAt: new Date(),
      status: "scheduled",
    });
    const fetchSpy = zernio(() => Response.json({ success: true }));
    await expect(lib.deleteTemplateForOrg(ORG, "t_ok", LOG)).rejects.toThrow(/1 mensaje programado/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"))).toHaveLength(1);

    // Ya cancelado, sí se puede borrar.
    await db.update(s.scheduledMessages).set({ status: "cancelled" }).where(eq(s.scheduledMessages.id, "sch_eb"));
    await lib.deleteTemplateForOrg(ORG, "t_ok", LOG);
    expect(await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"))).toHaveLength(0);
  });

  it("borrar: una del sandbox o de otra organización no se toca (ni se llama a Zernio)", async () => {
    const fetchSpy = zernio(() => Response.json({ success: true }));
    await expect(lib.deleteTemplateForOrg(ORG, "t_sandbox", LOG)).rejects.toBeInstanceOf(lib.TemplatesSandboxError);
    await expect(lib.deleteTemplateForOrg("org_otra", "t_ok", LOG)).rejects.toThrow(/ya no existe/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.templates)).toHaveLength(3);
  });

  // ── Editar ──────────────────────────────────────────────────────────────────

  it("editar: cambia solo el BODY en Meta y deja la fila En revisión con sus nuevas variables", async () => {
    const fetchSpy = zernio((_url, init) =>
      init?.method === "GET"
        ? Response.json({
            template: {
              name: "saludo_tardes",
              language: "es_MX",
              status: "APPROVED",
              components: [{ type: "BODY", text: "Hola {{1}}, buenas tardes.", example: { body_text: [["Ana"]] } }],
            },
          })
        : Response.json({ success: true, template: { name: "saludo_tardes", language: "es_MX", status: "PENDING" } }),
    );
    const out = await lib.updateTemplateForOrg(
      ORG,
      "t_ok",
      { bodyText: "Hola {{1}}, soy {{2}} de Diluvium.", bodyExample: ["Ana", "Daniel"] },
      LOG,
    );
    expect(out).toEqual({ status: "PENDING" });
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PATCH"]);
    const patch = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(patch).toEqual({
      accountId: "zacc_oficial",
      language: "es_MX",
      components: [{ type: "BODY", text: "Hola {{1}}, soy {{2}} de Diluvium.", example: { body_text: [["Ana", "Daniel"]] } }],
    });
    const [row] = await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"));
    expect(row).toMatchObject({
      body: "Hola {{1}}, soy {{2}} de Diluvium.",
      status: "PENDING",
      variables: [
        { index: 1, example: "Ana" },
        { index: 2, example: "Daniel" },
      ],
    });
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "plantillas", action: "editar", subject: "saludo_tardes" });
    expect(rows[0].detail).toEqual({ type: "texto", title: "Texto", before: "Hola {{1}}, buenas tardes.", after: "Hola {{1}}, soy {{2}} de Diluvium." });
  });

  it("editar: en revisión, con texto que Meta rechazaría o sin cambios NO llama a Meta", async () => {
    const fetchSpy = zernio(() => Response.json({}));
    await expect(lib.updateTemplateForOrg(ORG, "t_revision", { bodyText: "Hola, ¿qué tal?", bodyExample: [] }, LOG)).rejects.toThrow(
      /aprobadas, rechazadas o pausadas/,
    );
    await expect(lib.updateTemplateForOrg(ORG, "t_ok", { bodyText: "{{1}}, buenas tardes.", bodyExample: ["Ana"] }, LOG)).rejects.toThrow(
      /empiece o termine/,
    );
    await expect(lib.updateTemplateForOrg(ORG, "t_ok", { bodyText: "Hola {{1}}, buenas tardes.", bodyExample: ["Ana"] }, LOG)).rejects.toThrow(
      /es el mismo/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await history()).toHaveLength(0);
  });

  it("editar: si Meta lo rechaza (p. ej. ya se editó hoy) la fila queda igual", async () => {
    zernio((_url, init) =>
      init?.method === "GET"
        ? Response.json({ template: { components: [{ type: "BODY", text: "Hola {{1}}, buenas tardes." }] } })
        : Response.json({ error: { message: "Template edit limit reached" } }, { status: 400 }),
    );
    await expect(
      lib.updateTemplateForOrg(ORG, "t_ok", { bodyText: "Hola {{1}}, buen día.", bodyExample: ["Ana"] }, LOG),
    ).rejects.toMatchObject({ message: "Template edit limit reached" });
    const [row] = await db.select().from(s.templates).where(eq(s.templates.id, "t_ok"));
    expect(row).toMatchObject({ body: "Hola {{1}}, buenas tardes.", status: "APPROVED" });
    expect(await history()).toHaveLength(0);
  });
});
