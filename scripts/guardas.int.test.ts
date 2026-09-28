// Guardas de los scripts (Bloque C), corriéndolos DE VERDAD con tsx:
// - seed-contactos, seed-inbox, seed-org y seed-user solo contra una base local de
//   desarrollo (ya se corrieron en producción);
// - backfill-phone-parts simula por omisión y solo escribe con --confirmar;
// - archivar-canal no marca Prueba salvo con --prueba.
// Solo con TEST_DATABASE_URL (la base local de pruebas).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = `${ROOT}node_modules/.bin/tsx`;

function run(script: string, args: string[], env: Record<string, string | undefined>) {
  const res = spawnSync(TSX, [`scripts/${script}.ts`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

describe.skipIf(!TEST_DATABASE_URL)("guardas de scripts (tsx real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ sql, eq } = await import("drizzle-orm"));
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: "org_g", name: "org_g", slug: "org_g", createdAt: new Date() });
  });

  describe("seeds: SOLO contra una base local", () => {
    const seeds = ["seed-contactos", "seed-inbox", "seed-org", "seed-user"];
    // Lo que tendría a la mano quien lo corre contra Railway (APP_URL incluido).
    const remote = { DATABASE_URL: "postgresql://postgres:x@db.invalid:5432/railway", APP_URL: "https://crm.example.invalid" };

    it.each(seeds)("%s se niega con una base remota y no escribe nada", (seed) => {
      const r = run(seed, [], remote);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`${seed} corre SOLO contra una base local`);
    }, 60_000);

    it.each(seeds)("%s se niega con NODE_ENV=production o una base local que no es de desarrollo", (seed) => {
      const prod = run(seed, [], { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: "production" });
      expect(prod.code).toBe(1);
      expect(prod.out).toContain(`${seed} no corre con NODE_ENV=production`);
      const name = run(seed, [], { DATABASE_URL: "postgres://localhost:5432/railway" });
      expect(name.code).toBe(1);
      expect(name.out).toContain('La base "railway" no parece de desarrollo');
    }, 60_000);

    it("con la base local de pruebas la guarda deja pasar (el seed sigue a lo suyo)", async () => {
      const r = run("seed-contactos", [], { DATABASE_URL: TEST_DATABASE_URL });
      expect(r.out).not.toContain("corre SOLO contra una base local");
      expect(r.out).not.toContain("no parece de desarrollo");
    }, 60_000);
  });

  describe("backfill-phone-parts: simula por omisión, escribe solo con --confirmar", () => {
    const phoneOf = async () => (await db.select({ p: s.contacts.phoneE164 }).from(s.contacts).where(eq(s.contacts.id, "ct_g")))[0].p;

    beforeEach(async () => {
      await db.insert(s.contacts).values({ id: "ct_g", organizationId: "org_g", firstName: "Cliente", phoneE164: "+5216681234567", country: "Mexico" });
    });

    it("sin banderas: solo conteos, no escribe", async () => {
      const r = run("backfill-phone-parts", [], {});
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/"telefonoCorregido": 1/);
      expect(r.out).toContain("Simulación: 1 contacto(s) cambiarían. No se escribió nada");
      expect(await phoneOf()).toBe("+5216681234567");
    }, 60_000);

    it("el viejo --apply ya NO escribe: avisa y se detiene", async () => {
      const r = run("backfill-phone-parts", ["--apply"], {});
      expect(r.code).toBe(1);
      expect(r.out).toContain("--apply ya no existe");
      expect(await phoneOf()).toBe("+5216681234567");
    }, 60_000);

    it("--confirmar escribe", async () => {
      const r = run("backfill-phone-parts", ["--confirmar"], {});
      expect(r.code).toBe(0);
      expect(await phoneOf()).toBe("+526681234567");
    }, 60_000);
  });

  describe("archivar-canal: Prueba solo con --prueba", () => {
    const channel = async (id: string) =>
      (await db.select({ isTest: s.channels.isTest, archivedAt: s.channels.archivedAt, isActive: s.channels.isActive }).from(s.channels).where(eq(s.channels.id, id)))[0];

    beforeEach(async () => {
      for (const id of ["ch_real", "ch_prueba"]) {
        await db.insert(s.channels).values({
          id,
          organizationId: "org_g",
          type: "whatsapp",
          provider: "zernio",
          providerAccountId: `acc_${id}`,
          displayName: id,
          aiAgentMode: "auto",
        });
      }
    });

    it("sin --prueba: archiva, pero NO lo marca Prueba (su historial sigue en el Dashboard)", async () => {
      const r = run("archivar-canal", ["--cuenta", "acc_ch_real", "--confirmar"], {});
      expect(r.code).toBe(0);
      expect(r.out).toContain("Marca Prueba: queda como está (no)");
      expect(await channel("ch_real")).toMatchObject({ isTest: false, isActive: false });
      expect((await channel("ch_real")).archivedAt).not.toBeNull();
    }, 60_000);

    it("con --prueba: además lo marca Prueba", async () => {
      const r = run("archivar-canal", ["--cuenta", "acc_ch_prueba", "--confirmar", "--prueba"], {});
      expect(r.code).toBe(0);
      expect(await channel("ch_prueba")).toMatchObject({ isTest: true, isActive: false });
    }, 60_000);

    it("sin --confirmar solo simula (ni archiva ni marca)", async () => {
      const r = run("archivar-canal", ["--cuenta", "acc_ch_prueba", "--prueba"], {});
      expect(r.code).toBe(0);
      expect(await channel("ch_prueba")).toMatchObject({ isTest: false, isActive: true, archivedAt: null });
    }, 60_000);
  });
});
