// Lector del gasto de staging (lado producción): nunca lanza; sin configurar,
// sin https, caído o con respuesta rara → la tarjeta muestra solo producción.
import { describe, expect, it } from "vitest";
import { fetchStagingSpend } from "./staging-spend";

const ENV = { STAGING_APP_URL: "https://staging.example.com", AI_SPEND_TOKEN: "tok" };

function fakeFetch(res: () => Response | Promise<Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return res();
  }) as typeof fetch;
  return { impl, calls };
}

describe("fetchStagingSpend", () => {
  it("sin URL o sin token → no_config (no llama a nadie)", async () => {
    const f = fakeFetch(() => Response.json({ days: [] }));
    expect(await fetchStagingSpend("2026-09-01", {}, f.impl)).toEqual({ status: "no_config" });
    expect(await fetchStagingSpend("2026-09-01", { STAGING_APP_URL: ENV.STAGING_APP_URL }, f.impl)).toEqual({ status: "no_config" });
    expect(await fetchStagingSpend("2026-09-01", { ...ENV, STAGING_APP_URL: "http://staging.example.com" }, f.impl)).toEqual({ status: "no_config" });
    expect(f.calls).toEqual([]);
  });

  it("ok: manda el token y la fecha, y devuelve los días", async () => {
    const days = [{ day: "2026-09-20", provider: "anthropic", usd: 1.25 }];
    const f = fakeFetch(() => Response.json({ days }));
    expect(await fetchStagingSpend("2026-09-01", ENV, f.impl)).toEqual({ status: "ok", days });
    expect(f.calls).toEqual([{ url: "https://staging.example.com/api/internal/ai-spend?from=2026-09-01", auth: "Bearer tok" }]);
  });

  it("caído, 401 o respuesta rara → unreachable", async () => {
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchStagingSpend("2026-09-01", ENV, down.impl)).toEqual({ status: "unreachable" });
    const denied = fakeFetch(() => new Response("no autorizado", { status: 401 }));
    expect(await fetchStagingSpend("2026-09-01", ENV, denied.impl)).toEqual({ status: "unreachable" });
    const weird = fakeFetch(() => Response.json({ days: [{ day: "hoy", provider: "x", usd: -1 }] }));
    expect(await fetchStagingSpend("2026-09-01", ENV, weird.impl)).toEqual({ status: "unreachable" });
  });
});
