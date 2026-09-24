// Gasto de IA del Dashboard contra Postgres REAL: gasto del mes (días de Mazatlán)
// por proveedor y saldo estimado = recargas − gasto desde la primera recarga.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("gasto de IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let spend: typeof import("./ai-spend");
  const ORG = "org_gasto";
  // 24-sep-2026 12:00 en Mazatlán (UTC-7).
  const NOW = new Date("2026-09-24T19:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    spend = await import("./ai-spend");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate ai_credit_topups, ai_usage, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "gasto", createdAt: new Date() },
      { id: "org_otra_gasto", name: "Otra", slug: "otra-gasto", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_admin", name: "Admin", email: "a@x.mx" });
    const use = (id: string, provider: string, costUsd: number, at: string, org = ORG) => ({
      id,
      organizationId: org,
      stage: "cerebro" as const,
      provider,
      modelId: provider === "openai" ? "gpt-5.6-luna" : "claude-sonnet-5",
      latencyMs: 1,
      costUsd,
      outcome: "sent",
      createdAt: new Date(at),
    });
    await db.insert(s.aiUsage).values([
      use("u1", "anthropic", 2.5, "2026-09-10T18:00:00Z"),
      use("u2", "anthropic", 1.5, "2026-09-20T18:00:00Z"),
      use("u3", "openai", 0.25, "2026-09-20T18:00:00Z"),
      // 31-ago 20:00 en Mazatlán = 1-sep 03:00 UTC: es de AGOSTO (día local).
      use("u4", "anthropic", 100, "2026-09-01T03:00:00Z"),
      use("u5", "anthropic", 50, "2026-09-10T18:00:00Z", "org_otra_gasto"),
    ]);
  });

  it("gasto del mes por proveedor, con días locales de Mazatlán y solo de la organización", async () => {
    const r = await spend.aiSpendSummary(db, ORG, { now: NOW });
    expect(r.monthLabel).toBe("septiembre de 2026");
    const by = Object.fromEntries(r.providers.map((p) => [p.provider, p]));
    expect(by.anthropic.monthUsd).toBeCloseTo(4, 6);
    expect(by.openai.monthUsd).toBeCloseTo(0.25, 6);
    expect(by.anthropic.balanceUsd).toBeNull(); // sin recargas no hay saldo que estimar
  });

  it("saldo estimado = recargas − gasto desde la PRIMERA recarga", async () => {
    await db.insert(s.aiCreditTopups).values([
      { id: "t1", organizationId: ORG, provider: "anthropic", amountUsd: 20, toppedUpOn: "2026-09-15", createdByUserId: "u_admin" },
      { id: "t2", organizationId: ORG, provider: "anthropic", amountUsd: 10, toppedUpOn: "2026-09-22", createdByUserId: "u_admin" },
    ]);
    const r = await spend.aiSpendSummary(db, ORG, { now: NOW });
    const anthropic = r.providers.find((p) => p.provider === "anthropic")!;
    // Desde el 15-sep solo cuenta u2 (1.5); u1 (10-sep) es anterior a la primera recarga.
    expect(anthropic).toMatchObject({ loadedUsd: 30, firstTopupOn: "2026-09-15", spentSinceFirstUsd: 1.5, balanceUsd: 28.5 });
    expect(r.topups.map((t) => [t.toppedUpOn, t.amountUsd, t.author])).toEqual([
      ["2026-09-22", 10, "Admin"],
      ["2026-09-15", 20, "Admin"],
    ]);
    expect((await spend.aiSpendSummary(db, "org_otra_gasto", { now: NOW })).topups).toEqual([]);
  });

  it("primera recarga anterior al mes: el saldo descuenta todo lo gastado desde entonces (solo esta organización)", async () => {
    await db.insert(s.aiCreditTopups).values({ id: "t1", organizationId: ORG, provider: "anthropic", amountUsd: 20, toppedUpOn: "2026-08-01", createdByUserId: "u_admin" });
    const r = await spend.aiSpendSummary(db, ORG, { now: NOW });
    const anthropic = r.providers.find((p) => p.provider === "anthropic")!;
    // Desde el 1-ago: u4 (100, 31-ago local) + u1 (2.5) + u2 (1.5); el mes solo u1 + u2.
    expect(anthropic).toMatchObject({ monthUsd: 4, spentSinceFirstUsd: 104, balanceUsd: -84 });
    // Solo gasto de producción: la tarjeta ya no trae nada de staging.
    expect(Object.keys(r).sort()).toEqual(["monthLabel", "providers", "topups"]);
    expect(Object.keys(anthropic)).not.toContain("stagingMonthUsd");
  });

  it("spendByDay suma por día LOCAL y solo de la organización", async () => {
    expect(await spend.spendByDay(db, ORG, "2026-08-31")).toEqual([
      { day: "2026-08-31", provider: "anthropic", usd: 100 },
      { day: "2026-09-10", provider: "anthropic", usd: 2.5 },
      { day: "2026-09-20", provider: "anthropic", usd: 1.5 },
      { day: "2026-09-20", provider: "openai", usd: 0.25 },
    ]);
    expect(await spend.spendByDay(db, ORG, "2026-09-10")).toHaveLength(3);
  });

  it("estimateBalance redondea a centavos", () => {
    expect(spend.estimateBalance(10, 3.333333)).toBe(6.67);
  });
});
