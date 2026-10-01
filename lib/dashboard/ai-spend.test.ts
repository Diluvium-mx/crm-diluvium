import { describe, expect, it } from "vitest";
import { splitDay, summarizeProviders, type BillingSnapshot } from "./ai-spend";

const NOW = new Date("2026-10-03T12:34:56Z");

const snapshot = (values: Partial<BillingSnapshot> & Pick<BillingSnapshot, "provider">): BillingSnapshot => ({
  days: {},
  balanceUsd: null,
  loadedUsd: null,
  fetchedAt: new Date("2026-10-03T12:27:00Z"),
  lastError: null,
  ...values,
});

describe("splitDay", () => {
  it("sin reporte considera todo el registro del CRM como producción", () => {
    expect(splitDay("openai", "2026-10-02", 1.25, undefined)).toEqual({ prod: 1.25, tests: 0 });
  });

  it("para un proveedor genérico atribuye a pruebas solo el excedente no negativo", () => {
    expect(splitDay("openai", "2026-10-02", 1, { todo: 2.5 })).toEqual({ prod: 1, tests: 1.5 });
    expect(splitDay("openai", "2026-10-02", 3, { todo: 2.5 })).toEqual({ prod: 3, tests: 0 });
  });

  it("para Anthropic desde Pruebas usa los grupos y nunca baja producción del CRM", () => {
    expect(splitDay("anthropic", "2026-10-01", 2, { todo: 6, prod: 3, pruebas: 3 })).toEqual({ prod: 3, tests: 3 });
    expect(splitDay("anthropic", "2026-10-02", 4, { todo: 6, prod: 3, pruebas: 3 })).toEqual({ prod: 4, tests: 3 });
  });

  it("para Anthropic antes de Pruebas conserva la regla genérica", () => {
    expect(splitDay("anthropic", "2026-09-30", 1.5, { todo: 3, prod: 2, pruebas: 1 })).toEqual({ prod: 1.5, tests: 1.5 });
  });
});

describe("summarizeProviders", () => {
  it("usa el reporte de Anthropic, el mes UTC y las recargas para calcular el saldo", () => {
    const providers = summarizeProviders({
      now: NOW,
      monthStart: "2026-10-01",
      days: [
        { day: "2026-09-22", provider: "anthropic", usd: 1 },
        { day: "2026-10-01", provider: "anthropic", usd: 1.5 },
        { day: "2026-10-02", provider: "anthropic", usd: 2 },
      ],
      loads: [{ provider: "anthropic", loadedUsd: 20, firstTopupOn: "2026-09-22" }],
      billing: [
        snapshot({
          provider: "anthropic",
          days: {
            "2026-09-22": { todo: 3 },
            "2026-10-01": { todo: 5, prod: 3, pruebas: 2 },
            "2026-10-02": { todo: 4, prod: 1, pruebas: 3 },
          },
        }),
      ],
    });

    expect(providers.find((provider) => provider.provider === "anthropic")).toMatchObject({
      monthUsd: 10,
      monthProdUsd: 5,
      monthTestsUsd: 5,
      source: "proveedor",
      updatedMinutesAgo: 7,
      loadedUsd: 20,
      firstTopupOn: "2026-09-22",
      spentSinceFirstUsd: 13,
      balanceUsd: 7,
      lastError: null,
    });
  });

  it.each(["openrouter", "xai"])("limita el saldo directo de %s por el gasto conocido", (provider) => {
    const providers = summarizeProviders({
      now: NOW,
      monthStart: "2026-10-01",
      days: [{ day: "2026-10-02", provider, usd: 0.4 }],
      loads: [],
      billing: [snapshot({ provider, days: { "2026-10-02": { todo: 1 } }, balanceUsd: 4.5, loadedUsd: 5 })],
    });

    expect(providers.find((item) => item.provider === provider)).toMatchObject({
      monthUsd: 1,
      monthProdUsd: 0.4,
      monthTestsUsd: 0.6,
      source: "proveedor",
      loadedUsd: 5,
      firstTopupOn: null,
      spentSinceFirstUsd: 1,
      balanceUsd: 4,
    });
  });

  it("una fila que solo tiene error sigue estimada y expone lastError", () => {
    const providers = summarizeProviders({
      now: NOW,
      monthStart: "2026-10-01",
      days: [{ day: "2026-10-02", provider: "openai", usd: 0.25 }],
      loads: [],
      billing: [snapshot({ provider: "openai", fetchedAt: null, lastError: "timeout", days: { "2026-10-02": { todo: 99 } } })],
    });

    expect(providers.find((provider) => provider.provider === "openai")).toMatchObject({
      monthUsd: 0.25,
      monthProdUsd: 0.25,
      monthTestsUsd: 0,
      source: "estimado",
      updatedMinutesAgo: null,
      lastError: "timeout",
    });
  });

  it("Google sin snapshot conserva números exclusivos del CRM", () => {
    const providers = summarizeProviders({
      now: NOW,
      monthStart: "2026-10-01",
      days: [{ day: "2026-10-02", provider: "google", usd: 0.75 }],
      loads: [{ provider: "google", loadedUsd: 10, firstTopupOn: "2026-09-01" }],
    });

    expect(providers.find((provider) => provider.provider === "google")).toMatchObject({
      monthUsd: 0.75,
      monthProdUsd: 0.75,
      monthTestsUsd: 0,
      source: "estimado",
      updatedMinutesAgo: null,
      loadedUsd: 10,
      spentSinceFirstUsd: 0.75,
      balanceUsd: 9.25,
    });
  });
});
