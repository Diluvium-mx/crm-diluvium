import { describe, expect, it } from "vitest";
import type { FetchLike } from "./http";
import { readOpenAiBilling } from "./openai";

describe("readOpenAiBilling", () => {
  it("autoriza por Bearer, pagina y suma los resultados por día UTC", async () => {
    const key = "sk-admin-openai-xxxx";
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (url, { headers }) => {
      calls.push({ url, headers });
      const parsed = new URL(url);
      const second = parsed.searchParams.get("page") === "pagina-dos";
      return new Response(
        JSON.stringify(
          second
            ? {
                object: "page",
                data: [
                  {
                    object: "bucket",
                    start_time: 1_790_899_200,
                    end_time: 1_790_985_600,
                    results: [{ amount: { value: 0.3, currency: "usd" }, line_item: "otro", project_id: null }],
                  },
                ],
                has_more: false,
                next_page: null,
              }
            : {
                object: "page",
                data: [
                  {
                    object: "bucket",
                    start_time: 1_790_812_800,
                    end_time: 1_790_899_200,
                    results: [
                      {
                        object: "organization.costs.result",
                        amount: { value: 0.208, currency: "usd" },
                        line_item: "gpt-5.6-luna, output",
                        project_id: null,
                      },
                      { amount: { value: 0.002, currency: "usd" } },
                      { amount: null },
                    ],
                  },
                ],
                has_more: true,
                next_page: "pagina-dos",
              },
        ),
      );
    };

    const reading = await readOpenAiBilling(key, {
      now: new Date("2026-10-03T12:34:56Z"),
      fromDay: "2026-09-22",
      hasHistory: false,
      fetchImpl,
    });

    expect(reading.replaceFrom).toBe("2026-09-22");
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.headers.Authorization === `Bearer ${key}`)).toBe(true);
    expect(calls.every((call) => !call.url.includes(key))).toBe(true);
    const first = new URL(calls[0].url);
    expect(first.pathname).toBe("/v1/organization/costs");
    expect(first.searchParams.get("start_time")).toBe(String(Date.parse("2026-09-22T00:00:00Z") / 1000));
    expect(first.searchParams.get("bucket_width")).toBe("1d");
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("pagina-dos");
    expect(reading.days).toEqual({
      "2026-10-01": { todo: 0.21 },
      "2026-10-02": { todo: 0.3 },
    });
  });
});
