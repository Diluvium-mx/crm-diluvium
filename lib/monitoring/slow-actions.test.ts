import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: (() => void)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => void) => pending.push(fn) }));

const { actionName, resetActionNames, screenPath, SLOW_ACTION_MS, timeServerAction } = await import("./slow-actions");

const manifest = () => ({
  node: {
    "40abc123def456": { filename: "lib/actions/agente-actividad.ts", exportedName: "getAgentActivity" },
    "00sin-archivo": { exportedName: "suelta" },
  },
});

describe("actionName", () => {
  beforeEach(() => resetActionNames());

  it("usa el archivo y el nombre exportado del manifiesto", () => {
    expect(actionName("40abc123def456", manifest)).toBe("agente-actividad › getAgentActivity");
    expect(actionName("00sin-archivo", manifest)).toBe("suelta");
  });

  it("sin manifiesto o sin el id, deja el inicio del id", () => {
    expect(actionName("7f00112233445566", () => { throw new Error("no hay build"); })).toBe("acción 7f00112233");
  });
});

describe("screenPath", () => {
  it("solo la ruta, sin el contacto de la query", () => {
    expect(screenPath("https://crm.example/embudo?contacto=abc")).toBe("/embudo");
    expect(screenPath(null)).toBe("?");
    expect(screenPath("no es url")).toBe("?");
  });
});

describe("timeServerAction", () => {
  let now = 0;
  beforeEach(() => {
    pending.length = 0;
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  const actionHeaders = () => new Headers({ "next-action": "7f00112233445566", referer: "https://crm.example/embudo?contacto=abc" });

  it("una acción lenta sale en el log con su pantalla, una sola vez por petición", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = actionHeaders();
    timeServerAction(h);
    timeServerAction(h); // otra llamada a requireActiveMembership en la misma acción
    expect(pending).toHaveLength(1);
    now = SLOW_ACTION_MS + 250;
    pending[0]();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[lenta\] .+ 1250 ms · \/embudo$/);
  });

  it("una acción rápida no escribe nada", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    timeServerAction(actionHeaders());
    now = SLOW_ACTION_MS - 1;
    pending[0]();
    expect(warn).not.toHaveBeenCalled();
  });

  it("una página o ruta (sin next-action) no se mide", () => {
    timeServerAction(new Headers({ referer: "https://crm.example/embudo" }));
    expect(pending).toHaveLength(0);
  });
});
