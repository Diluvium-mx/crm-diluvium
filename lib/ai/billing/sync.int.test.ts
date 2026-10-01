// Sincronización de cobro contra Postgres REAL, con lectores falsos y sin red.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingSource } from "./sync";
import type { BillingReading, ReadOptions } from "./types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type SyncModule = typeof import("./sync");

describe.skipIf(!TEST_DATABASE_URL)("syncAiBilling (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let sync: SyncModule;
  const ORG_A = "org_sync_a";
  const ORG_B = "org_sync_b";

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
    await db.execute(sql`truncate ai_provider_billing, ai_credit_topups, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Sync A", slug: "sync-a", createdAt: new Date() },
      { id: ORG_B, name: "Sync B", slug: "sync-b", createdAt: new Date() },
    ]);
  });

  it("parte de la recarga más antigua, inserta una fila por organización y después mezcla días", async () => {
    await db.insert(s.aiCreditTopups).values({
      id: "topup_sync",
      organizationId: ORG_A,
      provider: "openai",
      amountUsd: 20,
      toppedUpOn: "2026-08-15",
    });
    const optionsSeen: ReadOptions[] = [];
    let pass = 0;
    const source: BillingSource = {
      provider: "openai",
      read: async (options) => {
        optionsSeen.push(options);
        pass += 1;
        const reading: BillingReading = pass === 1
          ? {
              days: {
                "2026-09-01": { todo: 1 },
                "2026-10-01": { todo: 2 },
                "2026-10-02": { todo: 3 },
              },
              replaceFrom: "2026-08-15",
              balanceUsd: null,
              loadedUsd: null,
              warnings: [],
            }
          : {
              days: { "2026-10-02": { todo: 4 } },
              replaceFrom: "2026-10-01",
              balanceUsd: null,
              loadedUsd: null,
              warnings: [],
            };
        return reading;
      },
    };
    const firstNow = new Date("2026-10-03T12:00:00Z");
    const secondNow = new Date("2026-10-03T12:05:00Z");

    await expect(sync.syncAiBilling({ now: firstNow, sources: [source] })).resolves.toEqual([{ provider: "openai", ok: true, warnings: [] }]);
    expect(optionsSeen[0]).toMatchObject({ now: firstNow, fromDay: "2026-08-15", hasHistory: false });
    let rows = await db.select().from(s.aiProviderBilling);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.organizationId))).toEqual(new Set([ORG_A, ORG_B]));
    expect(rows.every((row) => row.fetchedAt?.getTime() === firstNow.getTime())).toBe(true);

    await sync.syncAiBilling({ now: secondNow, sources: [source] });
    expect(optionsSeen[1]).toMatchObject({ now: secondNow, fromDay: "2026-08-15", hasHistory: true });
    rows = await db.select().from(s.aiProviderBilling);
    for (const row of rows) {
      expect(row.days).toEqual({
        "2026-09-01": { todo: 1 },
        // El 1-oct desaparece porque la lectura fresca lo reemplazó y no lo trajo.
        "2026-10-02": { todo: 4 },
      });
      expect(row.fetchedAt?.getTime()).toBe(secondNow.getTime());
      expect(row.attemptedAt.getTime()).toBe(secondNow.getTime());
      expect(row.lastError).toBeNull();
    }
  });

  it("si el lector falla conserva días y fetchedAt, actualiza attemptedAt y oculta la llave", async () => {
    const previousFetch = new Date("2026-10-03T11:00:00Z");
    const attemptedAt = new Date("2026-10-03T12:00:00Z");
    const key = "sk-ant-admin01-xxxx";
    await db.insert(s.aiProviderBilling).values([
      {
        organizationId: ORG_A,
        provider: "anthropic",
        days: { "2026-10-01": { todo: 3 } },
        fetchedAt: previousFetch,
        attemptedAt: previousFetch,
      },
      {
        organizationId: ORG_B,
        provider: "anthropic",
        days: { "2026-10-01": { todo: 3 } },
        fetchedAt: previousFetch,
        attemptedAt: previousFetch,
      },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source: BillingSource = {
      provider: "anthropic",
      read: async () => {
        throw new Error(`el proveedor rechazó ${key}`);
      },
    };

    const result = await sync.syncAiBilling({ now: attemptedAt, sources: [source] });
    const rows = await db.select().from(s.aiProviderBilling);

    expect(result[0]).toMatchObject({ provider: "anthropic", ok: false });
    for (const row of rows) {
      expect(row.days).toEqual({ "2026-10-01": { todo: 3 } });
      expect(row.fetchedAt?.getTime()).toBe(previousFetch.getTime());
      expect(row.attemptedAt.getTime()).toBe(attemptedAt.getTime());
      expect(row.lastError).not.toContain(key);
      expect(row.lastError).toContain("[llave oculta]");
    }
  });

  it("billingSources incluye solo proveedores con todas sus variables requeridas", () => {
    expect(
      sync.billingSources({
        ANTHROPIC_ADMIN_KEY: "anthropic",
        OPENAI_ADMIN_KEY: "openai",
        XAI_MANAGEMENT_KEY: "xai-sin-team",
        OPENROUTER_MANAGEMENT_KEY: "openrouter",
      }).map((source) => source.provider),
    ).toEqual(["anthropic", "openai", "openrouter"]);

    expect(sync.billingSources({ XAI_MANAGEMENT_KEY: "xai", XAI_TEAM_ID: "team" }).map((source) => source.provider)).toEqual(["xai"]);
    expect(sync.billingSources({ XAI_TEAM_ID: "team-sin-key" })).toEqual([]);
    expect(sync.billingSources({})).toEqual([]);
  });
});
