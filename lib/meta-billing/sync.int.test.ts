// Cobro de Meta por WhatsApp contra Postgres REAL, con lector falso y sin red.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaBillingConfig, MetaPricingReading } from "./read";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type SyncModule = typeof import("./sync");

const config: MetaBillingConfig = { wabaId: "111", api: { token: "x" } };
const cell = (volume: number, cost: number) => ({ REGULAR: { SERVICE: { volume, cost } } });

describe.skipIf(!TEST_DATABASE_URL)("syncMetaBilling (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let sync: SyncModule;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    sync = await import("./sync");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate meta_whatsapp_billing, organization cascade`);
    await db.insert(s.organization).values({ id: "org_meta", name: "Meta", slug: "meta", createdAt: new Date() });
  });

  it("sin configuración no hace nada", async () => {
    expect(await sync.syncMetaBilling({ config: null })).toBeNull();
    expect(await db.select().from(s.metaWhatsappBilling)).toHaveLength(0);
  });

  it("guarda la lectura, conserva días viejos y deja el error sin perder lo bueno", async () => {
    const read = vi.fn(async (): Promise<MetaPricingReading> => ({ currency: "USD", days: { "2026-10-02": cell(1, 0.04) } }));
    await db.insert(s.metaWhatsappBilling).values({
      organizationId: "org_meta",
      wabaId: "111",
      days: { "2026-08-15": cell(5, 1), "2026-09-03": cell(9, 9) },
      attemptedAt: new Date(),
    });
    const now = new Date("2026-10-05T12:00:00Z");
    expect(await sync.syncMetaBilling({ config, now, read })).toEqual({ ok: true });
    expect(read).toHaveBeenCalledWith(config, { now, fromDay: "2026-09-01" });
    let [row] = await db.select().from(s.metaWhatsappBilling);
    expect(row.days).toEqual({ "2026-08-15": cell(5, 1), "2026-10-02": cell(1, 0.04) });
    expect(row.currency).toBe("USD");
    expect(row.lastError).toBeNull();

    const later = new Date("2026-10-05T13:00:00Z");
    const failed = await sync.syncMetaBilling({
      config,
      now: later,
      read: async () => {
        throw new Error("Meta 400: token EAABsbCS1234567890abcdef inválido");
      },
    });
    expect(failed?.ok).toBe(false);
    [row] = await db.select().from(s.metaWhatsappBilling);
    expect(row.lastError).toContain("[token oculto]");
    expect(row.lastError).not.toContain("EAABsbCS");
    expect(row.days["2026-10-02"]).toEqual(cell(1, 0.04));
    expect(row.fetchedAt?.toISOString()).toBe(now.toISOString());
  });

  it("otra WABA no se mezcla con lo guardado", async () => {
    await db.insert(s.metaWhatsappBilling).values({ organizationId: "org_meta", wabaId: "999", days: { "2026-08-15": cell(5, 1) }, attemptedAt: new Date() });
    await sync.syncMetaBilling({ config, now: new Date("2026-10-05T12:00:00Z"), read: async () => ({ currency: null, days: {} }) });
    const [row] = await db.select().from(s.metaWhatsappBilling);
    expect(row.wabaId).toBe("111");
    expect(row.days).toEqual({});
  });
});
