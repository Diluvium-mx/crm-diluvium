import { describe, expect, it } from "vitest";
import { DEFAULTS, readRateLimitConfig } from "./config";

describe("readRateLimitConfig", () => {
  it("usa los defaults sin env", () => {
    const config = readRateLimitConfig({});
    expect(config.xffIndex).toBe(0);
    expect(config.auth).toEqual({
      name: "auth",
      max: DEFAULTS.authMax,
      windowMs: DEFAULTS.authWindowSeconds * 1000,
    });
    expect(config.signIn).toEqual({
      name: "sign-in",
      max: DEFAULTS.signInMax,
      windowMs: DEFAULTS.signInWindowSeconds * 1000,
    });
  });

  it("lee límite, ventana e índice de x-forwarded-for del env", () => {
    const config = readRateLimitConfig({
      RATE_LIMIT_XFF_INDEX: "-1",
      RATE_LIMIT_AUTH_MAX: "50",
      RATE_LIMIT_AUTH_WINDOW_SECONDS: "30",
      RATE_LIMIT_SIGNIN_MAX: " 5 ",
      RATE_LIMIT_SIGNIN_WINDOW_SECONDS: "600",
    });
    expect(config.xffIndex).toBe(-1);
    expect(config.auth).toMatchObject({ max: 50, windowMs: 30_000 });
    expect(config.signIn).toMatchObject({ max: 5, windowMs: 600_000 });
  });

  it("trata un valor vacío como no definido", () => {
    expect(readRateLimitConfig({ RATE_LIMIT_AUTH_MAX: "" }).auth.max).toBe(DEFAULTS.authMax);
  });

  it.each(["0", "-3", "1.5", "abc", "10s", "99999999999999999999"])(
    "falla en vez de desactivar el límite con un valor inválido: %s",
    (value) => {
      expect(() => readRateLimitConfig({ RATE_LIMIT_SIGNIN_MAX: value })).toThrow(
        /RATE_LIMIT_SIGNIN_MAX/,
      );
    },
  );
});
