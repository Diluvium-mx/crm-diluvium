import { describe, expect, it } from "vitest";
import { coveredBetween, nextRenewal, planCreditStatus } from "./ai-plan-credit";

const MAX = { provider: "anthropic", label: "Plan Max", monthlyUsd: 100, renewsDay: 17, startsOn: "2026-11-27" };

describe("nextRenewal", () => {
  it("el siguiente día de renovación, estrictamente después", () => {
    expect(nextRenewal("2026-11-27", 17)).toBe("2026-12-17");
    expect(nextRenewal("2026-12-17", 17)).toBe("2027-01-17");
    expect(nextRenewal("2026-12-05", 17)).toBe("2026-12-17");
  });
});

describe("planCreditStatus", () => {
  it("antes del primer crédito no hay plan", () => {
    expect(planCreditStatus(MAX, new Map(), "2026-11-26")).toBeNull();
  });

  it("el primer ciclo va del alta al día 17; lo de antes del alta no cuenta", () => {
    const s = planCreditStatus(MAX, new Map([["2026-11-26", 5], ["2026-11-27", 0.3], ["2026-11-28", 0.25]]), "2026-11-28")!;
    expect(s).toMatchObject({ usedUsd: 0.55, leftUsd: 99.45, expiresOn: "2026-12-17" });
    expect(coveredBetween(s, "2026-11-01", "2026-12-01")).toBeCloseTo(0.55);
  });

  it("al renovarse vuelve a 100 (lo que sobró se pierde) y lo que pasa de 100 en un ciclo no lo cubre", () => {
    const gasto = new Map([["2026-12-10", 120], ["2026-12-17", 2], ["2026-12-20", 3]]);
    const s = planCreditStatus(MAX, gasto, "2026-12-20")!;
    expect(s).toMatchObject({ usedUsd: 5, leftUsd: 95, expiresOn: "2027-01-17" });
    // Del 10-dic solo cubrió 100 de 120 (los 20 restantes salen del saldo comprado).
    expect(coveredBetween(s, "2026-12-10", "2026-12-11")).toBe(100);
    expect(coveredBetween(s, "2026-11-27", "2027-01-17")).toBe(105);
  });
});
