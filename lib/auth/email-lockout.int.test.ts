// Candado de inicio de sesión (S3, CN-010/CN-007) contra Postgres REAL y Better
// Auth real: 10 intentos en 5 min por correo + conexión, tope de 50 por hora por
// correo, y registro de fallos/bloqueos sin el correo en claro. Solo corren con
// TEST_DATABASE_URL apuntando a una base DESECHABLE; borran sus datos al empezar.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET ??= "secreto-solo-para-tests-de-integracion-0123456789";
}

describe.skipIf(!TEST_DATABASE_URL)("candado de inicio de sesión (Postgres real + Better Auth)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let auth: typeof import("@/lib/auth").auth;
  const EMAIL = "vendedor@example.com";
  const PASSWORD = "contrasena-correcta-123";
  const ipA = new Headers({ "x-forwarded-for": "203.0.113.10" });
  const ipB = new Headers({ "x-forwarded-for": "198.51.100.20" });

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ auth } = await import("@/lib/auth"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate "user", rate_limit cascade`);
    await auth.api.createUser({ body: { email: EMAIL, password: PASSWORD, name: "Vendedor" } });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const signIn = (password: string, headers: Headers) => auth.api.signInEmail({ body: { email: EMAIL, password }, headers });
  const status = (p: Promise<unknown>) =>
    p.then(
      () => 200,
      (e: { statusCode?: number }) => e.statusCode ?? 500,
    );
  async function fail(times: number, headers: Headers) {
    for (let i = 0; i < times; i++) expect(await status(signIn("equivocada", headers))).toBe(401);
  }

  it("10 fallos bloquean el correo SOLO desde esa conexión: desde otra entra", async () => {
    await fail(10, ipA);
    expect(await status(signIn(PASSWORD, ipA))).toBe(429); // aun con la contraseña correcta
    expect(await status(signIn(PASSWORD, ipB))).toBe(200);
  });

  it("un inicio exitoso borra el candado de esa conexión", async () => {
    await fail(9, ipA);
    expect(await status(signIn(PASSWORD, ipA))).toBe(200);
    await fail(10, ipA); // vuelve a tener sus 10
    expect(await status(signIn(PASSWORD, ipA))).toBe(429);
  });

  it("tope general: 50 intentos en una hora desde varias conexiones bloquean el correo en todas", async () => {
    for (let n = 1; n <= 5; n++) await fail(10, new Headers({ "x-forwarded-for": `192.0.2.${n}` }));
    expect(await status(signIn(PASSWORD, new Headers({ "x-forwarded-for": "192.0.2.99" })))).toBe(429);
  });

  it("registra cada fallo y el bloqueo con la IP y el correo codificado (nunca en claro)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await fail(10, ipA);
      expect(await status(signIn(PASSWORD, ipA))).toBe(429);
      await vi.waitFor(() => expect(warn.mock.calls.some((c) => String(c[0]).includes('"auth_locked"'))).toBe(true));
      const lines = warn.mock.calls.map((c) => c.map(String).join(" "));
      expect(lines.filter((l) => l.includes('"auth_failed"'))).toHaveLength(10);
      expect(lines.every((l) => !l.includes(EMAIL))).toBe(true);
      expect(lines.some((l) => l.includes("203.0.113.10"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
