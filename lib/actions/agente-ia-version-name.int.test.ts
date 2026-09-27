// Nombre de una versión del Goal o de las FAQs (lápiz ✎, 27-sep-2026) contra Postgres REAL
// (TEST_DATABASE_URL), por la Server Action completa: permiso, organización de la SESIÓN,
// validación y el UPDATE filtrado por organización Y id.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ current: { organizationId: "org_vn", userId: "u_vn", role: "agent" } }));
vi.mock("@/lib/auth/active-organization", () => ({ requireActiveMembership: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!TEST_DATABASE_URL)("nombre de versiones del agente (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("@/lib/agente-ia/editor-store");
  let renameAgentVersion: typeof import("./agente-ia-editor").renameAgentVersion;
  const ORG = "org_vn";
  const OTRA = "org_vn_otra";
  const USER = "u_vn";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("@/lib/agente-ia/editor-store");
    ({ renameAgentVersion } = await import("./agente-ia-editor"));
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.eq(s.user.id, USER));
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "vn", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "vn-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Admin", email: "vn@example.test" });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL ORIGINAL" });
    await store.saveGoal(ORG, USER, "GOAL NUEVO");
  });

  const goalVersions = () => store.listVersions(ORG, "goal");

  it("pone, cambia y quita el nombre (vacío = sin nombre); no crea versión nueva", async () => {
    const [actual, original] = await goalVersions();
    expect(actual.name).toBeNull();

    expect(await renameAgentVersion({ versionId: actual.id, name: "  Con la promo de octubre  " })).toEqual({ ok: true });
    expect(await renameAgentVersion({ versionId: original.id, name: "Antes de la promo" })).toEqual({ ok: true });
    let versions = await goalVersions();
    expect(versions.map((v) => v.name)).toEqual(["Con la promo de octubre", "Antes de la promo"]);

    expect(await renameAgentVersion({ versionId: actual.id, name: "   " })).toEqual({ ok: true });
    versions = await goalVersions();
    expect(versions.map((v) => v.name)).toEqual([null, "Antes de la promo"]);
    expect(versions).toHaveLength(2);

    // loadEditor lo devuelve (la vista del cliente lo recibe tal cual).
    expect((await store.loadEditor(ORG)).goalVersions.map((v) => v.name)).toEqual([null, "Antes de la promo"]);
  });

  it("una versión de otra organización = «no existe» y no se toca", async () => {
    const [actual] = await goalVersions();
    session.current = { organizationId: OTRA, userId: USER, role: "agent" };
    expect(await renameAgentVersion({ versionId: actual.id, name: "Ajena" })).toEqual({ ok: false, message: "Esa versión no existe." });
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    expect((await goalVersions())[0].name).toBeNull();
  });

  it("más de 80 caracteres = error y no se guarda; una versión inexistente, tampoco", async () => {
    const [actual] = await goalVersions();
    const r = await renameAgentVersion({ versionId: actual.id, name: "x".repeat(81) });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toMatch(/80 caracteres/);
    expect((await goalVersions())[0].name).toBeNull();
    expect(await renameAgentVersion({ versionId: "no-existe", name: "x" })).toEqual({ ok: false, message: "Esa versión no existe." });
  });
});
