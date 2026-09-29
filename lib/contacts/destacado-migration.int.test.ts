// Migración 0048 (Destacado del contacto) contra Postgres real: pasa los datos que ya
// existían y se puede correr dos veces sin cambiar nada (IDEMPOTENTE).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const MIGRATION = fileURLToPath(new URL("../../drizzle/0048_destacado_contacto.sql", import.meta.url));

describe.skipIf(!TEST_DATABASE_URL)("migración 0048: Destacado pasa al contacto (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  const ORG = "org_destacado_mig";
  const OTHER = "org_destacado_mig_otra";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
  });

  afterAll(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization cascade`);
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Mig", slug: "destacado-mig", createdAt: new Date() },
      { id: OTHER, name: "Otra", slug: "destacado-mig-otra", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values([
      { id: "ch_mig", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_mig", displayName: "Uno" },
      { id: "ch_mig_2", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_mig_2", displayName: "Dos" },
    ]);
  });

  async function contact(id: string, temperature: "caliente" | "frio" | "en_espera" | "destacado" | null) {
    await db.insert(s.contacts).values({ id, organizationId: ORG, firstName: id, temperature });
  }
  async function chat(id: string, contactId: string, channelId: string, isStarred: boolean) {
    await db.insert(s.conversations).values({ id, organizationId: ORG, contactId, channelId, isStarred });
  }

  async function runMigration() {
    const { sql } = await import("drizzle-orm");
    // Igual que drizzle: cada sentencia separada por el breakpoint, dentro de una transacción.
    const statements = readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint");
    await db.transaction(async (tx) => {
      for (const statement of statements) await tx.execute(sql.raw(statement));
    });
  }

  async function state() {
    const rows = await db
      .select({ id: s.contacts.id, temperature: s.contacts.temperature, destacado: s.contacts.destacado })
      .from(s.contacts)
      .orderBy(s.contacts.id);
    return rows.map((r) => [r.id, r.temperature, r.destacado]);
  }

  it("⭐ como temperatura y estrella en cualquier chat → Destacado; ⭐ pasa a sin asignar; nadie pierde 🔥, 🧊 ni ⏳", async () => {
    await contact("a_temp_star", "destacado");
    await contact("b_hot_starred", "caliente");
    await chat("cv_b", "b_hot_starred", "ch_mig", true);
    await contact("c_cold_second_chat", "frio");
    await chat("cv_c1", "c_cold_second_chat", "ch_mig", false);
    await chat("cv_c2", "c_cold_second_chat", "ch_mig_2", true);
    await contact("d_waiting_plain", "en_espera");
    await chat("cv_d", "d_waiting_plain", "ch_mig", false);
    await contact("e_nothing", null);

    await runMigration();
    const after = await state();
    expect(after).toEqual([
      ["a_temp_star", null, true],
      ["b_hot_starred", "caliente", true],
      ["c_cold_second_chat", "frio", true],
      ["d_waiting_plain", "en_espera", false],
      ["e_nothing", null, false],
    ]);

    // Segunda corrida: nada cambia.
    await runMigration();
    expect(await state()).toEqual(after);
  });

  it("una marca que ya estaba no se apaga", async () => {
    await db.insert(s.contacts).values({ id: "f_ya_destacado", organizationId: ORG, firstName: "f", destacado: true });
    await runMigration();
    expect(await state()).toEqual([["f_ya_destacado", null, true]]);
  });
});
