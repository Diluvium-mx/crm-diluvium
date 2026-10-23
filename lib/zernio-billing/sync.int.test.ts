// Lectura del cobro de Zernio contra Postgres REAL, con un lector falso y sin red.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZernioReading } from "./read";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type SyncModule = typeof import("./sync");

const CONFIG = { apiKey: "sk-secreto", baseUrl: "https://zernio.com/api" };

const READING: ZernioReading = {
  periodStart: new Date("2026-10-01T00:00:00Z"),
  periodEnd: new Date("2026-11-01T00:00:00Z"),
  totalUsd: 0.71,
  messagesUsd: 0.71,
  accountsUsd: 0,
  prevTotalUsd: 0,
  prevPeriodStart: new Date("2026-09-18T19:00:00Z"),
  suspended: false,
  declineReason: null,
  openInvoice: false,
};

describe.skipIf(!TEST_DATABASE_URL)("syncZernioBilling (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let sync: SyncModule;
  const ORG_A = "org_zernio_a";
  const ORG_B = "org_zernio_b";

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
    await db.execute(sql`truncate zernio_billing, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Zernio A", slug: "zernio-a", createdAt: new Date() },
      { id: ORG_B, name: "Zernio B", slug: "zernio-b", createdAt: new Date() },
    ]);
  });

  it("sin llave no lee nada", async () => {
    const read = vi.fn();
    await expect(sync.syncZernioBilling({ config: null, read })).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("guarda la lectura para cada organización y la actualiza en la siguiente", async () => {
    const first = new Date("2026-10-23T18:00:00Z");
    await expect(sync.syncZernioBilling({ now: first, config: CONFIG, read: async () => READING })).resolves.toEqual({ ok: true });
    let rows = await db.select().from(s.zernioBilling);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ totalUsd: 0.71, messagesUsd: 0.71, accountsUsd: 0, prevTotalUsd: 0, suspended: false, lastError: null });
    expect(rows[0].fetchedAt?.getTime()).toBe(first.getTime());

    const second = new Date("2026-10-23T18:15:00Z");
    await sync.syncZernioBilling({ now: second, config: CONFIG, read: async () => ({ ...READING, totalUsd: 0.76, messagesUsd: 0.76 }) });
    rows = await db.select().from(s.zernioBilling);
    expect(rows.every((r) => r.totalUsd === 0.76 && r.fetchedAt?.getTime() === second.getTime())).toBe(true);
  });

  it("si Zernio falla se guarda el error sin la llave y se queda la última lectura buena", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = new Date("2026-10-23T18:00:00Z");
    await sync.syncZernioBilling({ now: first, config: CONFIG, read: async () => READING });
    const later = new Date("2026-10-23T18:15:00Z");
    const result = await sync.syncZernioBilling({
      now: later,
      config: CONFIG,
      read: async () => {
        throw new Error("Zernio respondió 401: sk-secreto no vale");
      },
    });
    expect(result).toEqual({ ok: false, error: "Zernio respondió 401: [llave oculta] no vale" });
    const [row] = await db.select().from(s.zernioBilling).limit(1);
    expect(row).toMatchObject({ totalUsd: 0.71, lastError: "Zernio respondió 401: [llave oculta] no vale" });
    expect(row.fetchedAt?.getTime()).toBe(first.getTime());
    expect(row.attemptedAt.getTime()).toBe(later.getTime());
  });

  it("si falla la primera vez queda la fila con el error (la tarjeta lo avisa)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await sync.syncZernioBilling({
      now: new Date("2026-10-23T18:00:00Z"),
      config: CONFIG,
      read: async () => {
        throw new Error("Zernio no devolvió los totales del mes");
      },
    });
    const rows = await db.select().from(s.zernioBilling);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fetchedAt === null && r.totalUsd === null && r.lastError?.includes("no devolvió los totales"))).toBe(true);
  });
});
