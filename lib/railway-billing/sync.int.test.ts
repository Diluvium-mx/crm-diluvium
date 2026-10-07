// Lectura del cobro de Railway contra Postgres REAL, con un lector falso y sin red.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RailwayReading } from "./read";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type SyncModule = typeof import("./sync");

const CONFIG = { token: "tok-secreto", projectId: "a59d3041-d62f-4d10-822f-2e3026ca4f21" };

const READING: RailwayReading = {
  workspaceId: "ws-1",
  plan: "HOBBY",
  state: "ACTIVE",
  periodStart: new Date("2026-10-05T23:44:44Z"),
  periodEnd: new Date("2026-11-05T23:44:44Z"),
  usageUsd: 0.692829,
  nextInvoiceUsd: 5.02,
  nextInvoiceAt: new Date("2026-11-05T23:44:44Z"),
};

describe.skipIf(!TEST_DATABASE_URL)("syncRailwayBilling (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let sync: SyncModule;
  const ORG_A = "org_railway_a";
  const ORG_B = "org_railway_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    sync = await import("./sync");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate railway_billing, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Railway A", slug: "railway-a", createdAt: new Date() },
      { id: ORG_B, name: "Railway B", slug: "railway-b", createdAt: new Date() },
    ]);
  });

  it("sin token no lee nada", async () => {
    const read = vi.fn();
    await expect(sync.syncRailwayBilling({ config: null, read })).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("guarda la lectura para cada organización y la actualiza en la siguiente", async () => {
    const first = new Date("2026-10-07T19:00:00Z");
    await expect(sync.syncRailwayBilling({ now: first, config: CONFIG, read: async () => READING })).resolves.toEqual({ ok: true });
    let rows = await db.select().from(s.railwayBilling);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ workspaceId: "ws-1", plan: "HOBBY", usageUsd: 0.692829, nextInvoiceUsd: 5.02, lastError: null });
    expect(rows[0].fetchedAt?.getTime()).toBe(first.getTime());

    const second = new Date("2026-10-07T19:05:00Z");
    await sync.syncRailwayBilling({ now: second, config: CONFIG, read: async () => ({ ...READING, usageUsd: 0.7 }) });
    rows = await db.select().from(s.railwayBilling);
    expect(rows.every((r) => r.usageUsd === 0.7 && r.fetchedAt?.getTime() === second.getTime())).toBe(true);
  });

  it("si Railway falla se guarda el error sin el token y se queda la última lectura buena", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = new Date("2026-10-07T19:00:00Z");
    await sync.syncRailwayBilling({ now: first, config: CONFIG, read: async () => READING });
    const later = new Date("2026-10-07T19:05:00Z");
    const result = await sync.syncRailwayBilling({
      now: later,
      config: CONFIG,
      read: async () => {
        throw new Error("Railway respondió 401: tok-secreto no vale");
      },
    });
    expect(result).toEqual({ ok: false, error: "Railway respondió 401: [token oculto] no vale" });
    const [row] = await db.select().from(s.railwayBilling).limit(1);
    expect(row).toMatchObject({ plan: "HOBBY", usageUsd: 0.692829, lastError: "Railway respondió 401: [token oculto] no vale" });
    expect(row.fetchedAt?.getTime()).toBe(first.getTime());
    expect(row.attemptedAt.getTime()).toBe(later.getTime());
  });

  it("si falla la primera vez queda la fila con el error (la tarjeta lo avisa)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await sync.syncRailwayBilling({
      now: new Date("2026-10-07T19:00:00Z"),
      config: CONFIG,
      read: async () => {
        throw new Error("Railway no devolvió el cobro del workspace");
      },
    });
    const rows = await db.select().from(s.railwayBilling);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fetchedAt === null && r.lastError?.includes("no devolvió el cobro"))).toBe(true);
  });
});
