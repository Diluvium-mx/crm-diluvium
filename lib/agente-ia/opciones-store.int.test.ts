// Opciones del bot guardadas de UNA vez (botón «Guardar cambios», 27-sep-2026) contra
// Postgres REAL (TEST_DATABASE_URL): varios campos en una sola llamada dejan un registro
// por campo que de verdad cambió en ai_config_changes, y solo en su organización.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("opciones del bot en una sola llamada (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./opciones-store");
  const ORG = "org_opc_lote";
  const OTRA = "org_opc_lote_otra";
  const USER = "u_opc_lote";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./opciones-store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.eq(s.user.id, USER));
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "opc-lote", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "opc-lote-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Daniel", email: "opc-lote@example.test" });
  });

  const changes = (org: string) =>
    db
      .select({ field: s.aiConfigChanges.field, oldValue: s.aiConfigChanges.oldValue, newValue: s.aiConfigChanges.newValue, userId: s.aiConfigChanges.userId })
      .from(s.aiConfigChanges)
      .where(d.eq(s.aiConfigChanges.organizationId, org))
      .orderBy(s.aiConfigChanges.field);

  it("tres campos en una llamada = tres registros (uno por campo) con su valor anterior y el nuevo", async () => {
    const { options, changes: saved } = await store.saveBotOptions(ORG, USER, {
      responseDelaySeconds: 30,
      readImages: false,
      schedule: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" },
    });
    expect(saved).toHaveLength(3);
    expect(options).toMatchObject({ responseDelaySeconds: 30, readImages: false, schedule: { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" } });
    expect(await changes(ORG)).toEqual([
      { field: "readImages", oldValue: "Sí", newValue: "No", userId: USER },
      { field: "responseDelaySeconds", oldValue: "15 s", newValue: "30 s", userId: USER },
      { field: "schedule", oldValue: "24/7", newValue: "lun–vie 8:00–18:00 (hora de Mazatlán)", userId: USER },
    ]);
    expect(await changes(OTRA)).toEqual([]);
    expect(await store.loadBotOptionsRow(ORG)).toMatchObject({ responseDelaySeconds: 30, readImages: false });
  });

  it("un campo que llega con el mismo valor no deja registro", async () => {
    const { changes: saved } = await store.saveBotOptions(ORG, USER, { responseDelaySeconds: 15, maxBubbles: 1 });
    expect(saved.map((c) => c.field)).toEqual(["maxBubbles"]);
    expect((await changes(ORG)).map((c) => c.field)).toEqual(["maxBubbles"]);
  });
});
