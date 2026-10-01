import { describe, expect, it } from "vitest";
import type { FetchLike } from "./http";
import { readXaiBilling } from "./xai";

describe("readXaiBilling", () => {
  it("respeta el signo de centavos, el estado de las compras y el primer día de gasto", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (url, { headers }) => {
      calls.push({ url, headers });
      return new Response(
        JSON.stringify({
          changes: [
            { changeOrigin: "PURCHASE", amount: { val: "-500" }, createTime: "2026-09-25T22:20:31.925644Z", topupStatus: "SUCCEEDED" },
            { changeOrigin: "PURCHASE", amount: { val: "-900" }, createTime: "2026-09-26T00:00:00Z", topupStatus: "FAILED" },
            { changeOrigin: "PURCHASE", amount: { val: "-800" }, createTime: "2026-09-27T00:00:00Z", topupStatus: "PENDING" },
            { changeOrigin: "SPEND", amount: { val: "37" }, createTime: "2026-10-02T10:00:00Z" },
          ],
          total: { val: "-463" },
        }),
      );
    };

    const reading = await readXaiBilling("xai-management-xxxx", "equipo/con espacio", {
      now: new Date("2026-10-03T12:00:00Z"),
      fromDay: "2026-10-01",
      hasHistory: false,
      fetchImpl,
    });

    expect(reading).toMatchObject({
      balanceUsd: 4.63,
      loadedUsd: 5,
      replaceFrom: "2026-10-02",
      days: { "2026-10-02": { todo: 0.37 } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/teams/equipo%2Fcon%20espacio/prepaid/balance");
    expect(calls[0].headers.Authorization).toBe("Bearer xai-management-xxxx");
    expect(calls[0].url).not.toContain("xai-management-xxxx");
  });

  it("sin gasto sustituye desde hoy", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ changes: [{ changeOrigin: "PURCHASE", amount: { val: "-500" }, topupStatus: "SUCCEEDED" }], total: { val: "-500" } }));
    const reading = await readXaiBilling("key", "team", {
      now: new Date("2026-10-03T23:59:59Z"),
      fromDay: "2026-09-01",
      hasHistory: true,
      fetchImpl,
    });
    expect(reading.replaceFrom).toBe("2026-10-03");
    expect(reading.days).toEqual({});
  });
});
