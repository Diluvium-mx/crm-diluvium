// Revisión de cuentas con Zernio, base y Redis SIMULADOS: timeout de 10 s,
// "no se pudo revisar" ≠ "desconectado", baseline y lo que se guarda en Redis.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import healthFixture from "./__fixtures__/zernio-account-health.json";
import eventsFixture from "./__fixtures__/zernio-account-events.json";

const store = new Map<string, string>();
const rows = [{ id: "ch_1", organizationId: "org_1", accountId: "acc_1" }];

vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => rows }) }) },
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    set: async (key: string, value: string, mode?: string) => {
      if (mode === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    mset: async (...pairs: string[]) => {
      for (let i = 0; i < pairs.length; i += 2) store.set(pairs[i], pairs[i + 1]);
      return "OK";
    },
    mget: async (...keys: string[]) => keys.map((k) => store.get(k) ?? null),
  },
}));

const { checkWhatsappAccounts, ACCOUNTS_SNAPSHOT_KEY, ACCOUNTS_BASELINE_KEY, accountsLastRunKey, parseSnapshot } = await import("./account-health");

type Route = { status: number; body: unknown } | "timeout" | "offline";
let health: Route;
let events: Route;
const calls: { url: string; auth: string | null; hasSignal: boolean }[] = [];

function respond(route: Route): Promise<Response> {
  if (route === "timeout") return Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  if (route === "offline") return Promise.reject(new TypeError("fetch failed"));
  return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status }));
}

beforeEach(() => {
  store.clear();
  calls.length = 0;
  process.env.ZERNIO_API_KEY = "llave-de-prueba";
  health = { status: 200, body: healthFixture };
  events = { status: 200, body: eventsFixture };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization"), hasSignal: init?.signal instanceof AbortSignal });
    return respond(url.includes("/health") ? health : events);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-09-27T17:00:00Z");
const snapshot = () => parseSnapshot(store.get(ACCOUNTS_SNAPSHOT_KEY) ?? null);

describe("checkWhatsappAccounts", () => {
  it("cuenta sana: sin problemas, consulta de solo lectura con timeout y guarda en Redis con la hora", async () => {
    const report = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(report).toEqual({ problems: [], summary: { checked: 1, ok: 1, warning: 0, down: 0, unchecked: 0 } });
    expect(calls.map((c) => c.url).sort()).toEqual([
      "https://zernio.com/api/v1/accounts/acc_1/health",
      "https://zernio.com/api/v1/whatsapp/account-events?accountId=acc_1&limit=50",
    ]);
    expect(calls.every((c) => c.auth === "Bearer llave-de-prueba" && c.hasSignal)).toBe(true);
    expect(store.get(ACCOUNTS_BASELINE_KEY)).toBe(NOW.toISOString());
    expect(snapshot()).toMatchObject({
      checkedAt: NOW.toISOString(),
      accounts: [{ channelId: "ch_1", organizationId: "org_1", level: "ok", checkedAt: NOW.toISOString() }],
    });
    expect(store.get(accountsLastRunKey("worker"))).toBe(NOW.toISOString());
    expect(store.get(accountsLastRunKey("web"))).toBeUndefined();
  });

  it("el OFFBOARDED del 27-sep 01:27Z es anterior a la primera revisión: no alerta", async () => {
    const report = await checkWhatsappAccounts({ source: "web", now: NOW });
    expect(report.problems).toEqual([]);
  });

  it.each([
    ["timeout de 10 s", "timeout", "Zernio no respondió en 10 s"],
    ["sin red", "offline", "sin conexión con Zernio"],
    ["Zernio 503", { status: 503, body: { error: "down" } }, "Zernio respondió 503"],
    ["respuesta rara", { status: 200, body: { ok: true } }, "respuesta de Zernio no reconocida"],
    ["404 que no es de Zernio", { status: 404, body: null }, "Zernio respondió 404"],
  ] as const)("%s → 'no se pudo revisar' (no 'desconectado') y conserva la última revisión buena", async (_n, route, message) => {
    await checkWhatsappAccounts({ source: "worker", now: new Date("2026-09-27T16:55:00Z") });
    health = route;
    const report = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(report.problems).toEqual([`no se pudo revisar 1 cuenta(s) de WhatsApp en Zernio: ${message}`]);
    expect(report.summary).toMatchObject({ down: 0, unchecked: 1 });
    expect(snapshot()?.accounts[0]).toMatchObject({ level: "ok", checkedAt: "2026-09-27T16:55:00.000Z" });
    expect(snapshot()?.checkedAt).toBe(NOW.toISOString());
  });

  it("404 de Zernio: la cuenta ya no existe → rojo", async () => {
    health = { status: 404, body: { error: "Account not found" } };
    const report = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(report.summary.down).toBe(1);
    expect(report.problems[0]).toMatch(/^WhatsApp DESCONECTADO: 1 número\(s\)/);
  });

  it("si fallan los eventos decide health", async () => {
    events = "timeout";
    const report = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(report).toEqual({ problems: [], summary: { checked: 1, ok: 1, warning: 0, down: 0, unchecked: 0 } });
  });

  it("desconexión nueva entre revisiones: la avisa cada vigilante una sola vez", async () => {
    await checkWhatsappAccounts({ source: "worker", now: new Date("2026-09-27T16:50:00Z") }); // baseline
    await checkWhatsappAccounts({ source: "web", now: new Date("2026-09-27T16:51:00Z") });
    events = { status: 200, body: { events: [{ id: "e2", type: "account_disconnected", detail: "x", createdAt: "2026-09-27T16:57:00Z" }] } };
    const worker = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(worker.problems).toEqual(["WhatsApp: el número se desconectó a las 09:57 (Mazatlán) y ya volvió"]);
    expect(worker.summary.warning).toBe(1);
    const again = await checkWhatsappAccounts({ source: "worker", now: new Date("2026-09-27T17:05:00Z") });
    expect(again.problems).toEqual([]);
    const web = await checkWhatsappAccounts({ source: "web", now: new Date("2026-09-27T17:06:00Z") });
    expect(web.problems).toHaveLength(1); // la Action también se entera
  });

  it("sin ZERNIO_API_KEY: no se pudo revisar", async () => {
    delete process.env.ZERNIO_API_KEY;
    const report = await checkWhatsappAccounts({ source: "worker", now: NOW });
    expect(report.problems).toEqual(["no se pudo revisar 1 cuenta(s) de WhatsApp en Zernio: falta ZERNIO_API_KEY en este servicio"]);
  });
});
