// Revalidación del SSE (Postgres real, TEST_DATABASE_URL): la conexión sigue
// solo con sesión viva, usuario activo y membresía en ESA organización.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("streamStillAllowed (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let streamStillAllowed: typeof import("./stream-access").streamStillAllowed;

  const ORG = "org_stream_a";
  const OTRA = "org_stream_b";
  const USER = "u_stream";
  const SESSION = "s_stream";
  const input = { sessionId: SESSION, userId: USER, organizationId: ORG };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    ({ streamStillAllowed } = await import("./stream-access"));
  });

  beforeEach(async () => {
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.inArray(s.user.id, [USER, "u_stream_owner"]));
    await db.insert(s.organization).values([
      { id: ORG, name: "Stream A", slug: "stream-a", createdAt: new Date() },
      { id: OTRA, name: "Stream B", slug: "stream-b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values([
      { id: USER, name: "Vendedor", email: "stream@example.test" },
      { id: "u_stream_owner", name: "Dueño", email: "stream-owner@example.test" },
    ]);
    // Toda organización conserva un owner activo (triggers de la migración 0021).
    await db.insert(s.member).values([
      { id: "m_stream", organizationId: ORG, userId: USER, role: "agent", createdAt: new Date() },
      { id: "m_stream_owner", organizationId: ORG, userId: "u_stream_owner", role: "owner", createdAt: new Date() },
    ]);
    await db.insert(s.session).values({
      id: SESSION,
      token: "tok_stream",
      userId: USER,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("sesión viva, usuario activo y miembro: sigue", async () => {
    expect(await streamStillAllowed(input)).toBe(true);
  });

  it("vendedor desactivado (banned): se corta", async () => {
    await db.update(s.user).set({ banned: true }).where(d.eq(s.user.id, USER));
    expect(await streamStillAllowed(input)).toBe(false);
  });

  it("sesión borrada o vencida: se corta", async () => {
    await db.update(s.session).set({ expiresAt: new Date(Date.now() - 1_000) }).where(d.eq(s.session.id, SESSION));
    expect(await streamStillAllowed(input)).toBe(false);
    await db.delete(s.session).where(d.eq(s.session.id, SESSION));
    expect(await streamStillAllowed(input)).toBe(false);
  });

  it("ya no es miembro de esa organización (o es otra organización): se corta", async () => {
    expect(await streamStillAllowed({ ...input, organizationId: OTRA })).toBe(false);
    await db.delete(s.member).where(d.eq(s.member.id, "m_stream"));
    expect(await streamStillAllowed(input)).toBe(false);
  });
});
