import { describe, expect, it } from "vitest";
import {
  catalogModelId,
  groupOfWorkspace,
  readAnthropicBilling,
  usageRowCostUsd,
  type AnthropicUsageRow,
} from "./anthropic";
import type { FetchLike } from "./http";

type FetchCall = { url: string; headers: Record<string, string>; signal: AbortSignal };

const emptyCost = { data: [], has_more: false, next_page: null };
const emptyUsage = { data: [], has_more: false, next_page: null };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function fakeAnthropic(
  route: (url: URL) => unknown = (url) => (url.pathname.endsWith("/cost_report") ? emptyCost : emptyUsage),
): { fetchImpl: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = async (url, { headers, signal }) => {
    calls.push({ url, headers, signal });
    return json(route(new URL(url)));
  };
  return { fetchImpl, calls };
}

const usageRow = (overrides: Partial<AnthropicUsageRow> = {}): AnthropicUsageRow => ({
  model: "claude-sonnet-5",
  workspace_id: null,
  uncached_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  output_tokens: 0,
  server_tool_use: { web_search_requests: 0 },
  ...overrides,
});

describe("readAnthropicBilling", () => {
  it("manda la llave solo en headers y consulta costo, horas y minutos en sus cortes exactos", async () => {
    const key = "sk-ant-admin01-xxxx";
    const { fetchImpl, calls } = fakeAnthropic();

    const reading = await readAnthropicBilling(key, {
      now: new Date("2026-10-03T12:34:56Z"),
      fromDay: "2026-09-22",
      hasHistory: false,
      fetchImpl,
    });

    expect(reading.replaceFrom).toBe("2026-09-22");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.headers).toEqual({ "x-api-key": key, "anthropic-version": "2023-06-01" });
      expect(call.url).not.toContain(key);
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }

    const [cost, hourly, minute] = calls.map((call) => new URL(call.url));
    expect(cost.pathname).toBe("/v1/organizations/cost_report");
    expect(cost.searchParams.get("starting_at")).toBe("2026-09-22T00:00:00Z");
    expect(cost.searchParams.get("ending_at")).toBe("2026-10-02T00:00:00Z");
    expect(cost.searchParams.getAll("group_by[]")).toEqual(["workspace_id"]);

    expect(hourly.pathname).toBe("/v1/organizations/usage_report/messages");
    expect(hourly.searchParams.get("bucket_width")).toBe("1h");
    expect(hourly.searchParams.get("starting_at")).toBe("2026-10-02T00:00:00Z");
    expect(hourly.searchParams.get("ending_at")).toBe("2026-10-03T00:00:00Z");
    expect(hourly.searchParams.getAll("group_by[]")).toEqual(["workspace_id", "model"]);

    expect(minute.searchParams.get("bucket_width")).toBe("1m");
    expect(minute.searchParams.get("limit")).toBe("1440");
    expect(minute.searchParams.get("starting_at")).toBe("2026-10-03T00:00:00Z");
    expect(minute.searchParams.get("ending_at")).toBe("2026-10-03T12:35:00Z");
    expect(minute.searchParams.getAll("group_by[]")).toEqual(["workspace_id", "model"]);
  });

  it("con historial relee solamente siete días", async () => {
    const { fetchImpl, calls } = fakeAnthropic();
    const reading = await readAnthropicBilling("admin-key", {
      now: new Date("2026-10-03T12:34:56Z"),
      fromDay: "2026-09-22",
      hasHistory: true,
      fetchImpl,
    });

    expect(reading.replaceFrom).toBe("2026-09-26");
    const cost = calls.map((call) => new URL(call.url)).find((url) => url.pathname.endsWith("/cost_report"));
    expect(cost?.searchParams.get("starting_at")).toBe("2026-09-26T00:00:00Z");
  });

  it("sigue next_page y convierte centavos decimales separando producción y pruebas", async () => {
    const { fetchImpl, calls } = fakeAnthropic((url) => {
      if (!url.pathname.endsWith("/cost_report")) return emptyUsage;
      if (!url.searchParams.has("page")) {
        return {
          data: [
            {
              starting_at: "2026-09-30T00:00:00Z",
              ending_at: "2026-10-01T00:00:00Z",
              results: [
                {
                  currency: "USD",
                  amount: "328.56635",
                  workspace_id: null,
                  description: null,
                  cost_type: null,
                  context_window: null,
                  model: null,
                  service_tier: null,
                  token_type: null,
                  inference_geo: null,
                },
              ],
            },
          ],
          has_more: true,
          next_page: "pagina-dos",
        };
      }
      return {
        data: [
          {
            starting_at: "2026-09-30T00:00:00Z",
            results: [{ currency: "USD", amount: "100", workspace_id: "ws-pruebas" }],
          },
        ],
        has_more: false,
        next_page: null,
      };
    });

    const reading = await readAnthropicBilling("admin-key", {
      now: new Date("2026-10-03T12:34:56Z"),
      fromDay: "2026-09-30",
      hasHistory: false,
      fetchImpl,
    });

    const costCalls = calls.map((call) => new URL(call.url)).filter((url) => url.pathname.endsWith("/cost_report"));
    expect(costCalls).toHaveLength(2);
    expect(costCalls[1].searchParams.get("page")).toBe("pagina-dos");
    expect(reading.days["2026-09-30"]).toEqual({ todo: 4.2856635, prod: 3.2856635, pruebas: 1 });
  });

  it("avisa por modelos sin precio y no suma esas filas", async () => {
    const unknown = "claude-desconocido-20990101";
    const { fetchImpl } = fakeAnthropic((url) =>
      url.pathname.endsWith("/usage_report/messages")
        ? {
            data: [{ starting_at: "2026-10-03T12:00:00Z", results: [usageRow({ model: unknown, output_tokens: 10_000 })] }],
            has_more: false,
            next_page: null,
          }
        : emptyCost,
    );

    const reading = await readAnthropicBilling("admin-key", {
      now: new Date("2026-10-03T12:34:56Z"),
      fromDay: "2026-10-03",
      hasHistory: false,
      fetchImpl,
    });

    expect(reading.days).toEqual({});
    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]).toContain(unknown);
  });
});

describe("helpers de Anthropic", () => {
  it("clasifica Default como producción y los demás espacios como pruebas", () => {
    expect(groupOfWorkspace(null)).toBe("prod");
    expect(groupOfWorkspace(undefined)).toBe("prod");
    expect(groupOfWorkspace("ws-pruebas")).toBe("pruebas");
  });

  it("quita el sufijo de fecha del modelo para resolver el catálogo", () => {
    expect(catalogModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(usageRowCostUsd(usageRow({ model: "claude-haiku-4-5-20251001", output_tokens: 1_000_000 }))).toBe(5);
    expect(usageRowCostUsd(usageRow({ model: "modelo-inexistente" }))).toBeNull();
  });

  it("cobra entrada, salida y caché 5m con los números reales del 1-oct", () => {
    const usd = usageRowCostUsd(
      usageRow({
        uncached_input_tokens: 14_407,
        cache_read_input_tokens: 405_368,
        cache_creation: { ephemeral_5m_input_tokens: 366_097, ephemeral_1h_input_tokens: 0 },
        output_tokens: 12_280,
      }),
    );
    expect(usd).toBeCloseTo(1.1479, 4);
  });

  it("cobra caché de 1h a dos veces la entrada y US$0.01 por búsqueda web", () => {
    const usd = usageRowCostUsd(
      usageRow({
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
        server_tool_use: { web_search_requests: 3 },
      }),
    );
    expect(usd).toBe(4.03);
  });
});
