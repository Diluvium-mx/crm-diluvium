// Historial del gasto de IA contra Postgres REAL: días UTC, aislamiento por organización,
// desgloses del CRM, comparaciones, recargas y saldos mensuales.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type Stage = "cerebro" | "detalle" | "transcripcion";

describe.skipIf(!TEST_DATABASE_URL)("historial del gasto de IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let history: typeof import("./ai-spend-history");
  let range: typeof import("./range");
  const ORG = "org_historial_gasto";
  const OTHER_ORG = "org_otro_historial_gasto";
  const NOW = new Date("2026-10-05T12:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    history = await import("./ai-spend-history");
    range = await import("./range");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate ai_provider_billing, ai_credit_topups, ai_usage, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Org historial", slug: "historial-gasto", createdAt: new Date() },
      { id: OTHER_ORG, name: "Otra org", slug: "otro-historial-gasto", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_historial", name: "Administradora", email: "historial@x.mx" });
    await db.insert(s.aiCreditTopups).values([
      { id: "ta1", organizationId: ORG, provider: "anthropic", amountUsd: 10, toppedUpOn: "2026-09-22", createdByUserId: "u_historial" },
      { id: "ta2", organizationId: ORG, provider: "anthropic", amountUsd: 10, toppedUpOn: "2026-09-30", createdByUserId: "u_historial" },
      { id: "to1", organizationId: ORG, provider: "openai", amountUsd: 10, toppedUpOn: "2026-09-22", createdByUserId: "u_historial" },
      { id: "tx", organizationId: OTHER_ORG, provider: "openai", amountUsd: 999, toppedUpOn: "2026-10-01", createdByUserId: "u_historial" },
    ]);

    const usage = (
      id: string,
      provider: "anthropic" | "openai",
      modelId: string,
      stage: Stage,
      costUsd: number,
      createdAt: string,
      organizationId = ORG,
    ) => ({
      id,
      organizationId,
      stage,
      provider,
      modelId,
      latencyMs: 1,
      costUsd,
      outcome: "sent",
      createdAt: new Date(createdAt),
    });
    await db.insert(s.aiUsage).values([
      usage("us1", "anthropic", "claude-sonnet-5", "cerebro", 1, "2026-09-22T10:00:00Z"),
      usage("us2", "openai", "gpt-5.6-luna", "detalle", 0.5, "2026-09-23T10:00:00Z"),
      usage("us3", "anthropic", "claude-sonnet-5", "cerebro", 2.5, "2026-09-30T10:00:00Z"),
      usage("us4", "openai", "gpt-4o-mini-transcribe", "transcripcion", 1, "2026-09-30T11:00:00Z"),
      usage("uo1", "anthropic", "claude-sonnet-5", "cerebro", 2, "2026-10-01T10:00:00Z"),
      usage("uo2", "openai", "gpt-5.6-luna", "detalle", 1, "2026-10-01T11:00:00Z"),
      usage("uo3", "anthropic", "claude-sonnet-5", "detalle", 2, "2026-10-02T10:00:00Z"),
      usage("uo4", "openai", "gpt-4o-mini-transcribe", "transcripcion", 1.5, "2026-10-03T10:00:00Z"),
      usage("uo5", "anthropic", "claude-sonnet-5", "cerebro", 0.5, "2026-10-04T10:00:00Z"),
      usage("ux", "openai", "gpt-5.6-luna", "cerebro", 100, "2026-10-01T10:00:00Z", OTHER_ORG),
    ]);
    await db.insert(s.aiProviderBilling).values([
      {
        organizationId: ORG,
        provider: "anthropic",
        days: {
          "2026-09-22": { todo: 2 },
          "2026-09-30": { todo: 3 },
          "2026-10-01": { todo: 5, prod: 3, pruebas: 2 },
          "2026-10-02": { todo: 4, prod: 1, pruebas: 3 },
          "2026-10-04": { todo: 1, prod: 1, pruebas: 0 },
        },
        fetchedAt: new Date("2026-10-05T11:55:00Z"),
        attemptedAt: new Date("2026-10-05T11:55:00Z"),
      },
      {
        organizationId: ORG,
        provider: "openai",
        days: {
          "2026-09-23": { todo: 1 },
          "2026-09-30": { todo: 2 },
          "2026-10-01": { todo: 2 },
          "2026-10-03": { todo: 4 },
        },
        fetchedAt: new Date("2026-10-05T11:55:00Z"),
        attemptedAt: new Date("2026-10-05T11:55:00Z"),
      },
      {
        organizationId: OTHER_ORG,
        provider: "openai",
        days: { "2026-10-01": { todo: 500 } },
        fetchedAt: new Date("2026-10-05T11:55:00Z"),
        attemptedAt: new Date("2026-10-05T11:55:00Z"),
      },
    ]);
  });

  it("integra el mes actual, sus desgloses y los saldos sin mezclar organizaciones", async () => {
    const selected = range.resolveRange({ mes: "2026-10" }, NOW, "UTC");
    const result = await history.aiSpendHistory(db, ORG, selected, { now: NOW });

    expect(result.series).toHaveLength(31);
    expect(result.series[0]).toEqual({ dia: "2026-10-01", total: 7, prod: 4, tests: 3 });
    expect(result.series[1]).toEqual({ dia: "2026-10-02", total: 5, prod: 2, tests: 3 });
    expect(result.series[2]).toEqual({ dia: "2026-10-03", total: 4, prod: 1.5, tests: 2.5 });
    expect(result.series[3]).toEqual({ dia: "2026-10-04", total: 1, prod: 1, tests: 0 });
    expect(result.series[4]).toEqual({ dia: "2026-10-05", total: 0, prod: 0, tests: 0 });
    expect(result.series.at(-1)).toEqual({ dia: "2026-10-31", total: 0, prod: 0, tests: 0 });
    expect(result).toMatchObject({
      total: 17,
      prod: 8.5,
      tests: 8.5,
      comparison: null,
      topupsUsd: 0,
      topups: [],
      avgPerDay: 3.4,
      daysCounted: 5,
      firstDataDay: "2026-09-22",
    });
    expect(result.projection).toEqual({
      monthLabel: "octubre de 2026",
      ratePerDay: 3.14285714,
      projectedUsd: 100.28571429,
    });
    expect(result.byProvider).toEqual([
      { label: "Anthropic", total: 11 },
      { label: "OpenAI", total: 6 },
    ]);
    expect(result.byModel).toEqual([
      { label: "Claude Sonnet 5", total: 4.5 },
      { label: "Notas de voz (gpt-4o-mini-transcribe)", total: 1.5 },
      { label: "GPT-5.6 Luna", total: 1 },
    ]);
    expect(result.byTask).toEqual([
      { label: "Lectura en segundo plano (Detalle)", total: 3 },
      { label: "Respuestas del Agente IA", total: 2.5 },
      { label: "Notas de voz", total: 1.5 },
    ]);
    expect(result.months).toEqual([
      {
        month: "2026-10",
        label: "octubre de 2026",
        total: 17,
        prod: 8.5,
        tests: 8.5,
        topupsUsd: 0,
        balanceUsd: 5,
        inProgress: true,
      },
      {
        month: "2026-09",
        label: "septiembre de 2026",
        total: 8,
        prod: 5,
        tests: 3,
        topupsUsd: 30,
        balanceUsd: 22,
        inProgress: false,
      },
    ]);
  });

  it("compara un rango posterior al primer dato y filtra recargas y proyección por rango", async () => {
    const later = range.resolveRange({ desde: "2026-10-02", hasta: "2026-10-04" }, NOW, "UTC");
    const compared = await history.aiSpendHistory(db, ORG, later, { now: NOW });
    expect(compared.comparison).toEqual({ actual: 10, anterior: 12, label: "el periodo anterior" });
    expect(compared.topups).toEqual([]);
    expect(compared.projection).toBeNull();

    const september = range.resolveRange({ mes: "2026-09" }, NOW, "UTC");
    const historical = await history.aiSpendHistory(db, ORG, september, { now: NOW });
    expect(historical.topupsUsd).toBe(30);
    expect(historical.topups.map((item) => item.id).sort()).toEqual(["ta1", "ta2", "to1"]);
    expect(historical.topups.every((item) => item.toppedUpOn.startsWith("2026-09"))).toBe(true);
    expect(historical.projection).toBeNull();
  });
});
