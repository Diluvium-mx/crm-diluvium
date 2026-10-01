import { describe, expect, it } from "vitest";
import type { FetchLike } from "./http";
import { readOpenRouterBilling } from "./openrouter";

describe("readOpenRouterBilling", () => {
  it("lee créditos, actividad diaria y reemplaza los últimos 30 días", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (url, { headers }) => {
      calls.push({ url, headers });
      const body = url.endsWith("/credits")
        ? { data: { total_credits: 5, total_usage: 0.00028464 } }
        : { data: [{ date: "2026-09-25 00:00:00", usage: 0.000284, requests: 1, model: "qwen/qwen3.7-flash" }] };
      return new Response(JSON.stringify(body));
    };

    const reading = await readOpenRouterBilling("sk-or-v1-xxxx", {
      now: new Date("2026-10-03T12:00:00Z"),
      fromDay: "2026-09-01",
      hasHistory: false,
      fetchImpl,
    });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/v1/credits", "/api/v1/activity"]);
    expect(calls.every((call) => call.headers.Authorization === "Bearer sk-or-v1-xxxx")).toBe(true);
    expect(calls.every((call) => !call.url.includes("sk-or-v1-xxxx"))).toBe(true);
    expect(reading).toEqual({
      days: { "2026-09-25": { todo: 0.000284 } },
      replaceFrom: "2026-09-03",
      balanceUsd: 4.99971536,
      loadedUsd: 5,
      warnings: [],
    });
  });
});
