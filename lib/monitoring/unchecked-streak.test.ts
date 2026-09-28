// Racha de "no se pudo revisar" por vigilante (Redis SIMULADO): cuenta seguidas, se
// reinicia al revisar bien y worker/web no se suman entre sí.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, number>();
const ttl = new Map<string, number>();
vi.mock("@/lib/redis", () => ({
  redis: {
    incr: async (key: string) => {
      const n = (store.get(key) ?? 0) + 1;
      store.set(key, n);
      return n;
    },
    expire: async (key: string, seconds: number) => {
      ttl.set(key, seconds);
      return 1;
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { recordUncheckedStreak, uncheckedStreakKey } = await import("./unchecked-streak");

describe("recordUncheckedStreak", () => {
  beforeEach(() => {
    store.clear();
    ttl.clear();
  });

  it("cuenta fallas SEGUIDAS y vuelve a 0 al revisar bien", async () => {
    expect(await recordUncheckedStreak("web", "webhook", true)).toBe(1);
    expect(await recordUncheckedStreak("web", "webhook", true)).toBe(2);
    expect(await recordUncheckedStreak("web", "webhook", false)).toBe(0);
    expect(store.has(uncheckedStreakKey("web", "webhook"))).toBe(false);
    expect(await recordUncheckedStreak("web", "webhook", true)).toBe(1);
    expect(ttl.get(uncheckedStreakKey("web", "webhook"))).toBe(7_200);
  });

  it("cada vigilante y cada revisión llevan su propia racha", async () => {
    expect(await recordUncheckedStreak("worker", "cuentas", true)).toBe(1);
    expect(await recordUncheckedStreak("web", "cuentas", true)).toBe(1);
    expect(await recordUncheckedStreak("web", "webhook", true)).toBe(1);
    expect(await recordUncheckedStreak("worker", "cuentas", true)).toBe(2);
  });
});
