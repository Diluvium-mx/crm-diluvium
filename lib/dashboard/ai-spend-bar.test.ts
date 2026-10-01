import { describe, expect, it } from "vitest";
import { STALE_MINUTES, freshness, spendBar } from "./ai-spend-bar";
import { formatDollars, formatUsd } from "@/lib/usd-format";

const p = (loadedUsd: number | null, spentSinceFirstUsd: number | null) => ({
  loadedUsd,
  spentSinceFirstUsd,
  balanceUsd: loadedUsd === null ? null : Math.round((loadedUsd - (spentSinceFirstUsd ?? 0)) * 100) / 100,
});

describe("spendBar", () => {
  it("sin recarga: sin barra", () => {
    expect(spendBar(p(null, null))).toBeNull();
  });

  it("30 %: navy con lo que queda", () => {
    expect(spendBar(p(50, 15))).toEqual({ widthPct: 30, tone: "navy", text: "30 % usado · quedan US$35.00", exhausted: false });
  });

  it("desde 80 % pasa a naranja", () => {
    expect(spendBar(p(100, 79.99))?.tone).toBe("navy");
    expect(spendBar(p(100, 80))?.tone).toBe("orange");
    expect(spendBar(p(20, 17))).toMatchObject({ tone: "orange", text: "85 % usado · quedan US$3.00" });
  });

  it("no dice 100 % mientras quede saldo", () => {
    expect(spendBar(p(100, 99.6))?.text).toBe("99 % usado · quedan US$0.40");
  });

  it("al llegar a 100 %: Sin saldo estimado (también si se pasó)", () => {
    expect(spendBar(p(20, 20))).toEqual({ widthPct: 100, tone: "orange", text: "Sin saldo estimado", exhausted: true });
    expect(spendBar(p(20, 26.5))?.text).toBe("Sin saldo estimado");
  });

  it("al agotarse un saldo real dice Sin saldo", () => {
    expect(spendBar(p(20, 20), { estimated: false })).toEqual({ widthPct: 100, tone: "orange", text: "Sin saldo", exhausted: true });
  });

  it("recarga sin gasto: 0 %", () => {
    expect(spendBar(p(10, 0))).toMatchObject({ widthPct: 0, text: "0 % usado · quedan US$10.00" });
  });
});

describe("freshness", () => {
  it("describe las cifras estimadas con el registro del CRM", () => {
    expect(freshness({ source: "estimado", updatedMinutesAgo: null, lastError: null })).toEqual({
      text: "Estimado con el registro del CRM",
      tone: "muted",
    });
  });

  it("muestra lecturas recientes en tono discreto", () => {
    expect(freshness({ source: "proveedor", updatedMinutesAgo: 0, lastError: null })).toEqual({
      text: "Actualizado hace menos de 1 min",
      tone: "muted",
    });
    expect(freshness({ source: "proveedor", updatedMinutesAgo: 7, lastError: null })).toEqual({
      text: "Actualizado hace 7 min",
      tone: "muted",
    });
  });

  it("marca en naranja una lectura vieja o cuyo último intento falló", () => {
    expect(STALE_MINUTES).toBe(20);
    expect(freshness({ source: "proveedor", updatedMinutesAgo: STALE_MINUTES, lastError: null })).toEqual({
      text: "Sin actualizar desde hace 20 min",
      tone: "orange",
    });
    expect(freshness({ source: "proveedor", updatedMinutesAgo: 7, lastError: "timeout" })).toEqual({
      text: "Sin actualizar desde hace 7 min",
      tone: "orange",
    });
    expect(freshness({ source: "proveedor", updatedMinutesAgo: 130, lastError: null })).toEqual({
      text: "Sin actualizar desde hace 2 h",
      tone: "orange",
    });
  });
});

describe("formatUsd", () => {
  it("US$ con miles y dos decimales", () => {
    expect(formatUsd(14.2)).toBe("US$14.20");
    expect(formatUsd(1234.5)).toBe("US$1,234.50");
    expect(formatUsd(-3)).toBe("−US$3.00");
  });
});

describe("formatDollars", () => {
  it("usa signo simple, miles y dos decimales", () => {
    expect(formatDollars(6.16)).toBe("$6.16");
    expect(formatDollars(1234.5)).toBe("$1,234.50");
  });
});
