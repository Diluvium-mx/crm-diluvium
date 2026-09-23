// Tests de integración de "Configuración → Vendedores" (A4) contra Postgres
// REAL y Better Auth real: crear vendedor (plugin admin + organization),
// desactivar (bloquea el inicio de sesión y revoca sesiones), restablecer
// contraseña y el trigger de "≥1 owner activo". Solo corren con
// TEST_DATABASE_URL apuntando a una base DESECHABLE con las migraciones
// aplicadas; borran sus datos al empezar. Nunca apuntarlos a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET ??= "secreto-solo-para-tests-de-integracion-0123456789";
}

describe.skipIf(!TEST_DATABASE_URL)("vendedores (Postgres real + Better Auth)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let auth: typeof import("@/lib/auth").auth;
  let team: typeof import("./store");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_team";
  const OWNER_PASSWORD = "owner-password-123";
  let ownerId: string;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ auth } = await import("@/lib/auth"));
    team = await import("./store");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate organization, "user", rate_limit cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "team", createdAt: new Date() });
    const { user } = await auth.api.createUser({
      body: { email: "owner@diluvium.mx", password: OWNER_PASSWORD, name: "Dueño" },
    });
    ownerId = user.id;
    await auth.api.addMember({ body: { userId: ownerId, organizationId: ORG, role: "owner" } });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function signIn(email: string, password: string) {
    return auth.api.signInEmail({ body: { email, password } });
  }

  it("crea un vendedor con rol agent y su contraseña inicial sirve para entrar", async () => {
    await team.createSeller({ organizationId: ORG, name: "Carlos", email: "Carlos@Diluvium.mx", password: "vendedor-pass-12", role: "agent" });
    const members = await team.listTeam(ORG);
    const carlos = members.find((m) => m.email === "carlos@diluvium.mx");
    expect(carlos).toMatchObject({ name: "Carlos", role: "agent", banned: false });
    // El rol GLOBAL del plugin admin no se usa para nada: queda en su default.
    const [row] = await db.select().from(s.user).where(eq(s.user.email, "carlos@diluvium.mx"));
    expect(row.role).toBe("user");
    await expect(signIn("carlos@diluvium.mx", "vendedor-pass-12")).resolves.toHaveProperty("token");
  });

  it("rechaza correo repetido y contraseña corta, sin dejar usuarios a medias", async () => {
    await expect(
      team.createSeller({ organizationId: ORG, name: "Otro", email: "owner@diluvium.mx", password: "vendedor-pass-12", role: "agent" }),
    ).rejects.toThrow(/Ya existe un usuario/);
    await expect(
      team.createSeller({ organizationId: ORG, name: "Corto", email: "corto@diluvium.mx", password: "corta", role: "agent" }),
    ).rejects.toThrow(/al menos 12/);
    const users = await db.select().from(s.user);
    expect(users.map((u) => u.email).sort()).toEqual(["owner@diluvium.mx"]);
  });

  it("desactivar bloquea el inicio de sesión y revoca sus sesiones; reactivar lo devuelve", async () => {
    await team.createSeller({ organizationId: ORG, name: "Daniel", email: "daniel@diluvium.mx", password: "vendedor-pass-12", role: "agent" });
    await signIn("daniel@diluvium.mx", "vendedor-pass-12");
    const daniel = (await team.listTeam(ORG)).find((m) => m.email === "daniel@diluvium.mx")!;
    expect((await db.select().from(s.session).where(eq(s.session.userId, daniel.userId))).length).toBe(1);

    await team.setDeactivated(daniel.userId, true);
    expect((await db.select().from(s.session).where(eq(s.session.userId, daniel.userId))).length).toBe(0);
    await expect(signIn("daniel@diluvium.mx", "vendedor-pass-12")).rejects.toMatchObject({ body: { code: "BANNED_USER" } });
    // No se borra: sigue en la lista (sus mensajes conservan el autor).
    expect((await team.listTeam(ORG)).find((m) => m.userId === daniel.userId)?.banned).toBe(true);

    await team.setDeactivated(daniel.userId, false);
    await expect(signIn("daniel@diluvium.mx", "vendedor-pass-12")).resolves.toHaveProperty("token");
  });

  it("restablecer contraseña: la vieja deja de servir, la nueva sí, y se cierran sus sesiones", async () => {
    await team.createSeller({ organizationId: ORG, name: "Carlos", email: "carlos@diluvium.mx", password: "vendedor-pass-12", role: "agent" });
    const carlos = (await team.listTeam(ORG)).find((m) => m.email === "carlos@diluvium.mx")!;
    await signIn("carlos@diluvium.mx", "vendedor-pass-12");
    await team.setPassword(carlos.userId, "nueva-contrasena-99");
    expect((await db.select().from(s.session).where(eq(s.session.userId, carlos.userId))).length).toBe(0);
    await expect(signIn("carlos@diluvium.mx", "vendedor-pass-12")).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    await expect(signIn("carlos@diluvium.mx", "nueva-contrasena-99")).resolves.toHaveProperty("token");
    await expect(team.setPassword(carlos.userId, "corta")).rejects.toThrow(/al menos 12/);
  });

  it("un alta que se cortó a la mitad (usuario sin organización) se completa en vez de bloquear el correo", async () => {
    await auth.api.createUser({ body: { email: "huerfano@diluvium.mx", password: "cualquier-pass-1", name: "Viejo" } });
    await team.createSeller({ organizationId: ORG, name: "Daniel", email: "huerfano@diluvium.mx", password: "vendedor-pass-12", role: "agent" });
    const daniel = (await team.listTeam(ORG)).find((m) => m.email === "huerfano@diluvium.mx");
    expect(daniel).toMatchObject({ name: "Daniel", role: "agent" });
    await expect(signIn("huerfano@diluvium.mx", "vendedor-pass-12")).resolves.toHaveProperty("token");
  });

  it("dos owners que se desactivan mutuamente a la vez: solo uno lo logra (candado en el trigger)", async () => {
    await team.createSeller({ organizationId: ORG, name: "Socio", email: "socio@diluvium.mx", password: "socio-password-1", role: "owner" });
    const socio = (await team.listTeam(ORG)).find((m) => m.email === "socio@diluvium.mx")!;
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const gateB = new Promise<void>((r) => (releaseB = r));
    const txA = db.transaction(async (tx) => {
      await tx.update(s.user).set({ banned: true }).where(eq(s.user.id, socio.userId));
      await gateA;
    });
    const txB = db.transaction(async (tx) => {
      await tx.update(s.user).set({ banned: true }).where(eq(s.user.id, ownerId));
      await gateB;
    });
    releaseA();
    releaseB();
    const results = await Promise.allSettled([txA, txB]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await team.countActiveOwners(ORG)).toBe(1);
  });

  it("con sesión (HTTP) nadie puede crear organizaciones; desde el servidor sí", async () => {
    await team.createSeller({ organizationId: ORG, name: "Carlos", email: "carlos@diluvium.mx", password: "vendedor-pass-12", role: "agent" });
    const { headers: signedIn } = await auth.api.signInEmail({
      body: { email: "carlos@diluvium.mx", password: "vendedor-pass-12" },
      returnHeaders: true,
    });
    const cookie = (signedIn.get("set-cookie") ?? "").split(";")[0];
    await expect(
      auth.api.createOrganization({ body: { name: "Mía", slug: "de-carlos" }, headers: new Headers({ cookie }) }),
    ).rejects.toMatchObject({ body: { code: "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION" } });
    const orgs = await db.select().from(s.organization);
    expect(orgs.map((o) => o.slug)).toEqual(["team"]);
  });

  it("una organización nueva nace con los rangos de tallas por defecto", async () => {
    const created = await auth.api.createOrganization({ body: { name: "Nueva", slug: "nueva-org", userId: ownerId } });
    const rows = await db.select().from(s.tallasCompuerta).where(eq(s.tallasCompuerta.organizationId, created!.id));
    expect(rows).toHaveLength(9);
  });

  it("la BD no deja desactivar al único owner activo (trigger), pero sí si hay otro", async () => {
    await expect(team.setDeactivated(ownerId, true)).rejects.toThrow(/al menos un owner activo/);
    expect(await team.countActiveOwners(ORG)).toBe(1);

    await team.createSeller({ organizationId: ORG, name: "Socio", email: "socio@diluvium.mx", password: "socio-password-1", role: "owner" });
    expect(await team.countActiveOwners(ORG)).toBe(2);
    await team.setDeactivated(ownerId, true);
    expect(await team.countActiveOwners(ORG)).toBe(1);
  });
});
