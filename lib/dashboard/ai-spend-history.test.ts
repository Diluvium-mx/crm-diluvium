import { describe, expect, it } from "vitest";
import type { BillingSnapshot, Load, TopupRow } from "./ai-spend";
import {
  TASK_LABELS,
  buildSpendByDay,
  firstDay,
  modelLabel,
  monthLabel,
  monthlyRows,
  previousPeriod,
  projectMonth,
  sumDays,
  type SpendByDay,
} from "./ai-spend-history";

const snapshot = (values: Partial<BillingSnapshot> & Pick<BillingSnapshot, "provider">): BillingSnapshot => ({
  days: {},
  balanceUsd: null,
  loadedUsd: null,
  fetchedAt: new Date("2026-10-05T12:00:00Z"),
  lastError: null,
  ...values,
});

const topup = (id: string, provider: string, amountUsd: number, toppedUpOn: string): TopupRow => ({
  id,
  provider,
  label: provider,
  amountUsd,
  toppedUpOn,
  author: null,
});

describe("buildSpendByDay", () => {
  it("combina CRM y cobro por proveedor con las reglas genérica y de Anthropic", () => {
    const spend = buildSpendByDay(
      [
        { day: "2026-09-30", provider: "anthropic", usd: 1 },
        { day: "2026-10-01", provider: "anthropic", usd: 2 },
        { day: "2026-10-02", provider: "anthropic", usd: 4 },
        { day: "2026-10-01", provider: "openai", usd: 1 },
        { day: "2026-10-05", provider: "google", usd: 0 },
      ],
      [
        snapshot({
          provider: "anthropic",
          days: {
            "2026-09-30": { todo: 3, prod: 2, pruebas: 1 },
            "2026-10-01": { todo: 7, prod: 3, pruebas: 4 },
            "2026-10-02": { todo: 4, prod: 3, pruebas: 1 },
          },
        }),
        snapshot({ provider: "openai", days: { "2026-10-01": { todo: 2.5 } } }),
        snapshot({
          provider: "xai",
          fetchedAt: null,
          days: { "2026-10-06": { todo: 99 } },
        }),
      ],
    );

    expect([...spend.entries()].map(([day, providers]) => [day, Object.fromEntries(providers)])).toEqual([
      ["2026-09-30", { anthropic: { prod: 1, tests: 2 } }],
      ["2026-10-01", { anthropic: { prod: 3, tests: 4 }, openai: { prod: 1, tests: 1.5 } }],
      ["2026-10-02", { anthropic: { prod: 4, tests: 1 } }],
    ]);
    expect(spend.has("2026-10-05")).toBe(false);
    expect(spend.has("2026-10-06")).toBe(false);
  });
});

describe("sumDays", () => {
  const spend: SpendByDay = new Map([
    ["2026-09-30", new Map([["anthropic", { prod: 1, tests: 2 }]])],
    [
      "2026-10-01",
      new Map([
        ["anthropic", { prod: 3, tests: 4 }],
        ["openai", { prod: 1, tests: 1.5 }],
      ]),
    ],
    ["2026-10-02", new Map([["anthropic", { prod: 4, tests: 1 }]])],
  ]);

  it("suma límites inclusivos para todos los proveedores", () => {
    expect(sumDays(spend, "2026-09-30", "2026-10-01")).toEqual({ prod: 5, tests: 7.5, total: 12.5 });
  });

  it("filtra un proveedor sin perder los límites inclusivos", () => {
    expect(sumDays(spend, "2026-10-01", "2026-10-02", "anthropic")).toEqual({ prod: 7, tests: 5, total: 12 });
    expect(sumDays(spend, "2026-10-01", "2026-10-01", "openai")).toEqual({ prod: 1, tests: 1.5, total: 2.5 });
  });
});

describe("previousPeriod", () => {
  it("compara el mes en curso solo hasta el mismo día del mes pasado", () => {
    expect(previousPeriod({ desde: "2026-10-01", hasta: "2026-10-31", mes: "2026-10" }, "2026-10-05")).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-05",
      actualHasta: "2026-10-05",
      label: "el mes pasado al mismo día",
    });
  });

  it("usa completo el mes anterior cuando el mes elegido ya terminó", () => {
    expect(previousPeriod({ desde: "2026-09-01", hasta: "2026-09-30", mes: "2026-09" }, "2026-10-05")).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-31",
      actualHasta: "2026-09-30",
      label: "el mes anterior",
    });
  });

  it("limita el mismo día al último disponible del mes anterior", () => {
    expect(previousPeriod({ desde: "2026-03-01", hasta: "2026-03-31", mes: "2026-03" }, "2026-03-31")).toEqual({
      desde: "2026-02-01",
      hasta: "2026-02-28",
      actualHasta: "2026-03-31",
      label: "el mes pasado al mismo día",
    });
  });

  it("desplaza un rango libre terminado el mismo número de días", () => {
    expect(previousPeriod({ desde: "2026-09-10", hasta: "2026-09-19", mes: null }, "2026-10-05")).toEqual({
      desde: "2026-08-31",
      hasta: "2026-09-09",
      actualHasta: "2026-09-19",
      label: "el periodo anterior",
    });
  });

  it("en un rango libre en curso compara solo el tramo transcurrido", () => {
    expect(previousPeriod({ desde: "2026-09-10", hasta: "2026-09-19", mes: null }, "2026-09-15")).toEqual({
      desde: "2026-08-31",
      hasta: "2026-09-05",
      actualHasta: "2026-09-15",
      label: "el periodo anterior al mismo día",
    });
  });
});

describe("projectMonth", () => {
  const spend: SpendByDay = new Map([
    ["2026-09-26", new Map([["openai", { prod: 1, tests: 0 }]])],
    ["2026-09-27", new Map([["openai", { prod: 2, tests: 0 }]])],
    ["2026-09-28", new Map([["openai", { prod: 3, tests: 0 }]])],
    ["2026-09-29", new Map([["openai", { prod: 4, tests: 0 }]])],
    ["2026-09-30", new Map([["openai", { prod: 5, tests: 0 }]])],
    ["2026-10-01", new Map([["openai", { prod: 6, tests: 0 }]])],
    ["2026-10-02", new Map([["openai", { prod: 7, tests: 0 }]])],
    ["2026-10-03", new Map([["openai", { prod: 10, tests: 0 }]])],
  ]);

  it("proyecta con el promedio de los últimos siete días completos disponibles", () => {
    expect(projectMonth(spend, new Date("2026-10-03T12:00:00Z"), "2026-09-26")).toEqual({
      monthLabel: "octubre de 2026",
      ratePerDay: 4,
      projectedUsd: 137,
    });
  });

  it("no proyecta si todavía no existe un día completo con datos", () => {
    expect(projectMonth(spend, new Date("2026-10-03T12:00:00Z"), null)).toBeNull();
    expect(projectMonth(spend, new Date("2026-10-03T12:00:00Z"), "2026-10-03")).toBeNull();
  });
});

describe("monthlyRows", () => {
  it("arma meses recientes, recargas y saldos por proveedor con el mes actual cortado hoy", () => {
    const spend: SpendByDay = new Map([
      ["2026-08-15", new Map([["anthropic", { prod: 2, tests: 0 }]])],
      ["2026-09-10", new Map([["anthropic", { prod: 1, tests: 0 }]])],
      ["2026-09-22", new Map([["anthropic", { prod: 3, tests: 0 }]])],
      ["2026-09-30", new Map([["anthropic", { prod: 2, tests: 0 }]])],
      ["2026-10-01", new Map([["anthropic", { prod: 2, tests: 1 }]])],
      ["2026-10-02", new Map([["openai", { prod: 4, tests: 0 }]])],
      ["2026-10-06", new Map([["anthropic", { prod: 100, tests: 0 }]])],
    ]);
    const loads: Load[] = [
      { provider: "anthropic", loadedUsd: 20, firstTopupOn: "2026-09-22" },
      { provider: "openai", loadedUsd: 109, firstTopupOn: "2026-10-02" },
    ];
    const topups = [
      topup("a1", "anthropic", 10, "2026-09-22"),
      topup("a2", "anthropic", 10, "2026-09-30"),
      topup("o1", "openai", 10, "2026-10-02"),
      topup("o2", "openai", 99, "2026-10-06"),
    ];

    expect(monthlyRows({ spend, loads, topups, firstDataDay: "2026-08-15", today: "2026-10-05" })).toEqual([
      {
        month: "2026-10",
        label: "octubre de 2026",
        total: 7,
        prod: 6,
        tests: 1,
        topupsUsd: 10,
        balanceUsd: 18,
        inProgress: true,
      },
      {
        month: "2026-09",
        label: "septiembre de 2026",
        total: 6,
        prod: 6,
        tests: 0,
        topupsUsd: 20,
        balanceUsd: 15,
        inProgress: false,
      },
      {
        month: "2026-08",
        label: "agosto de 2026",
        total: 2,
        prod: 2,
        tests: 0,
        topupsUsd: 0,
        balanceUsd: null,
        inProgress: false,
      },
    ]);
  });

  it("sin primer día no fabrica filas", () => {
    expect(monthlyRows({ spend: new Map(), loads: [], topups: [], firstDataDay: null, today: "2026-10-05" })).toEqual([]);
  });
});

describe("etiquetas y primer día", () => {
  it("traduce modelos conocidos, transcripción, meses y tareas", () => {
    expect(modelLabel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("gpt-4o-mini-transcribe")).toBe("Notas de voz (gpt-4o-mini-transcribe)");
    expect(modelLabel("modelo-propio")).toBe("modelo-propio");
    expect(monthLabel("2026-10")).toBe("octubre de 2026");
    expect(TASK_LABELS).toMatchObject({
      cerebro: "Respuestas del Agente IA",
      detalle: "Lectura en segundo plano (Detalle)",
      transcripcion: "Notas de voz",
    });
  });

  it("elige el dato más antiguo entre gasto y recargas", () => {
    const spend: SpendByDay = new Map([["2026-09-20", new Map([["openai", { prod: 1, tests: 0 }]])]]);
    expect(firstDay(spend, [{ provider: "anthropic", loadedUsd: 10, firstTopupOn: "2026-09-15" }])).toBe("2026-09-15");
    expect(firstDay(new Map(), [])).toBeNull();
  });
});
