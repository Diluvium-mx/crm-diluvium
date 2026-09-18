import { describe, expect, it } from "vitest";
import { isAccountAllowed } from "./index";

describe("isAccountAllowed (aislamiento staging ↔ número real)", () => {
  it("sin lista (producción) acepta todas las cuentas", () => {
    expect(isAccountAllowed("acc_real", {})).toBe(true);
    expect(isAccountAllowed("acc_real", { ZERNIO_ALLOWED_ACCOUNT_IDS: " " })).toBe(true);
  });

  it("con lista (staging) solo acepta las cuentas listadas", () => {
    const env = { ZERNIO_ALLOWED_ACCOUNT_IDS: "acc_sandbox, acc_otro" };
    expect(isAccountAllowed("acc_sandbox", env)).toBe(true);
    expect(isAccountAllowed("acc_otro", env)).toBe(true);
    expect(isAccountAllowed("acc_real", env)).toBe(false);
  });

  it("un evento sin cuenta (p. ej. webhook.test) se acepta", () => {
    expect(isAccountAllowed(undefined, { ZERNIO_ALLOWED_ACCOUNT_IDS: "acc_sandbox" })).toBe(true);
  });
});
