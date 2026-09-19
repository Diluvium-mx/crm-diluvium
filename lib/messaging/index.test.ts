import { describe, expect, it } from "vitest";
import { allowedAccountIds, isAccountAllowed, MessagingNotConfiguredError } from "./index";

describe("allowlist de cuentas (aislamiento staging ↔ número real)", () => {
  it("falla cerrado: sin lista, o con lista vacía, el canal no está configurado", () => {
    expect(() => allowedAccountIds({})).toThrow(MessagingNotConfiguredError);
    expect(() => allowedAccountIds({ ZERNIO_ALLOWED_ACCOUNT_IDS: " , " })).toThrow(MessagingNotConfiguredError);
  });

  it("solo acepta las cuentas listadas", () => {
    const allowed = allowedAccountIds({ ZERNIO_ALLOWED_ACCOUNT_IDS: "acc_sandbox, acc_otro" });
    expect(isAccountAllowed("acc_sandbox", allowed)).toBe(true);
    expect(isAccountAllowed("acc_otro", allowed)).toBe(true);
    expect(isAccountAllowed("acc_real", allowed)).toBe(false);
  });

  it("un evento sin cuenta se rechaza", () => {
    const allowed = allowedAccountIds({ ZERNIO_ALLOWED_ACCOUNT_IDS: "acc_sandbox" });
    expect(isAccountAllowed(undefined, allowed)).toBe(false);
  });
});
