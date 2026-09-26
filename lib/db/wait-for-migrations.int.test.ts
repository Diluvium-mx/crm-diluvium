// El worker espera a que el web aplique las migraciones (Postgres real).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("waitForMigrations", () => {
  let db: typeof import("@/lib/db").db;
  let sql: typeof import("drizzle-orm").sql;
  let wait: typeof import("./wait-for-migrations").waitForMigrations;
  const quiet = { info: () => {} };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ sql } = await import("drizzle-orm"));
    ({ waitForMigrations: wait } = await import("./wait-for-migrations"));
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("con la base al día resuelve de inmediato", async () => {
    await expect(wait({ everyMs: 10, log: quiet })).resolves.toBeUndefined();
  });

  it("si falta la última migración, espera hasta que aparezca", async () => {
    const [{ id, created_at }] = await db.execute<{ id: number; created_at: string }>(
      sql`select id, created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    await db.execute(sql`update drizzle.__drizzle_migrations set created_at = created_at - 1 where id = ${id}`);
    let done = false;
    const pending = wait({ everyMs: 20, log: quiet }).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toBe(false);
    await db.execute(sql`update drizzle.__drizzle_migrations set created_at = ${created_at}::bigint where id = ${id}`);
    await pending;
    expect(done).toBe(true);
  });

  it("una migración VIEJA que drizzle saltó (no la última) también bloquea el arranque", async () => {
    const [{ id }] = await db.execute<{ id: number }>(sql`select id from drizzle.__drizzle_migrations order by created_at asc limit 1 offset 5`);
    await db.execute(sql`update drizzle.__drizzle_migrations set created_at = created_at - 1 where id = ${id}`);
    try {
      await expect(wait({ everyMs: 10, deadlineMs: 60, log: quiet })).rejects.toThrow(/sigue sin la migración 0005_/);
    } finally {
      await db.execute(sql`update drizzle.__drizzle_migrations set created_at = created_at + 1 where id = ${id}`);
    }
  });

  it("si el web nunca migra, vence el plazo y lanza (el deploy falla a la vista)", async () => {
    const [{ id }] = await db.execute<{ id: number }>(sql`select id from drizzle.__drizzle_migrations order by created_at desc limit 1`);
    await db.execute(sql`update drizzle.__drizzle_migrations set created_at = created_at - 1 where id = ${id}`);
    try {
      await expect(wait({ everyMs: 10, deadlineMs: 60, log: quiet })).rejects.toThrow(/sigue sin la migración/);
    } finally {
      await db.execute(sql`update drizzle.__drizzle_migrations set created_at = created_at + 1 where id = ${id}`);
    }
  });
});
