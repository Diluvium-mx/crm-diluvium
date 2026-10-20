// «Agregar al diccionario» del corrector (20-oct-2026, docs/corrector.md) contra Postgres REAL
// (TEST_DATABASE_URL), por la Server Action completa: organización de la SESIÓN, validación y
// la palabra sin repetirse aunque cambie la mayúscula.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ current: { organizationId: "org_sp", userId: "u_sp", role: "agent" } }));
vi.mock("@/lib/auth/active-organization", () => ({ requireActiveMembership: async () => session.current }));

describe.skipIf(!TEST_DATABASE_URL)("diccionario del equipo (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let actions: typeof import("./spelling");
  const ORG = "org_sp";
  const OTRA = "org_sp_otra";
  const USER = "u_sp";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    actions = await import("./spelling");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.eq(s.user.id, USER));
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "sp", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "sp-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Vendedor", email: "sp@example.test" });
  });

  it("el vendedor agrega una palabra; la misma con otra mayúscula no se repite", async () => {
    expect(await actions.addSpellingWord("  Galaxia ")).toEqual({ wordKey: "galaxia" });
    expect(await actions.addSpellingWord("GALAXIA")).toEqual({ wordKey: "galaxia" });
    expect(await actions.getSpellingWords()).toEqual(["galaxia"]);
    const [row] = await db.select().from(s.spellingWords).where(d.eq(s.spellingWords.organizationId, ORG));
    expect(row).toMatchObject({ word: "Galaxia", createdBy: USER });
  });

  it("cada organización tiene su diccionario", async () => {
    await actions.addSpellingWord("Cerritos");
    session.current = { organizationId: OTRA, userId: USER, role: "owner" };
    expect(await actions.getSpellingWords()).toEqual([]);
  });

  it("solo palabras sueltas de letras", async () => {
    await expect(actions.addSpellingWord("dos palabras")).rejects.toThrow();
    await expect(actions.addSpellingWord("m2")).rejects.toThrow();
    await expect(actions.addSpellingWord("")).rejects.toThrow();
    expect(await actions.getSpellingWords()).toEqual([]);
  });

  it("un rol desconocido no agrega nada", async () => {
    session.current = { organizationId: ORG, userId: USER, role: "invitado" };
    await expect(actions.addSpellingWord("Galaxia")).rejects.toThrow(/permiso/);
  });
});
