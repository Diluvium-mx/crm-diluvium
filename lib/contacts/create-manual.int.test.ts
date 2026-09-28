// "＋ Nuevo contacto" (28-sep-2026) contra Postgres REAL: alta con teléfono en E.164,
// etapa de entrada y origen "manual"; sin duplicar un número que ya existe (+52 o +521).
// Solo corre con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("alta manual de contactos (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let lib: typeof import("./create-manual");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_manual";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    lib = await import("./create-manual");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate contacts, organization cascade`);
    // El trigger de la 0041 siembra las etapas del Embudo de la organización.
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "manual", createdAt: new Date() });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("crea el contacto con teléfono E.164, etapa de entrada y origen manual", async () => {
    const out = await lib.createManualContact(ORG, { firstName: " Ana ", lastName: "López", phone: "668 123 4567", email: "ana@correo.mx" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [row] = await db.select().from(s.contacts).where(eq(s.contacts.id, out.contactId));
    const [entry] = await db.select({ key: s.funnelStages.key }).from(s.funnelStages).where(eq(s.funnelStages.role, "entrada"));
    expect(row).toMatchObject({
      organizationId: ORG,
      firstName: "Ana",
      lastName: "López",
      phoneE164: "+526681234567",
      email: "ana@correo.mx",
      source: "manual",
      stage: entry.key,
    });
  });

  it("no duplica un número que ya existe, aunque esté guardado como +521", async () => {
    await db.insert(s.contacts).values({ id: "c_ghl", organizationId: ORG, firstName: "Ana", lastName: "GHL", phoneE164: "+5216681234567" });
    const out = await lib.createManualContact(ORG, { firstName: "Ana", phone: "+52 668 123 4567" });
    expect(out).toEqual({ ok: false, message: "Ese teléfono ya es del contacto «Ana GHL».", duplicate: { id: "c_ghl", name: "Ana GHL" } });
    expect(await db.select().from(s.contacts)).toHaveLength(1);
  });

  it("teléfono incompleto o etapa inexistente: explica y no crea nada", async () => {
    expect(await lib.createManualContact(ORG, { firstName: "Ana", phone: "668 12" })).toMatchObject({ ok: false, message: expect.stringMatching(/10 dígitos/) });
    expect(await lib.createManualContact(ORG, { firstName: "Ana", phone: "6681234567", stage: "no_existe" })).toMatchObject({
      ok: false,
      message: "Esa etapa ya no existe en el Embudo.",
    });
    expect(await db.select().from(s.contacts)).toHaveLength(0);
  });
});
