import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ejecutarLote, entradaLectura } from "./lote-servidor";
import { MAX_LOTE } from "./lote-tipos";

const id = z.string().min(1);
const registro = {
  eco: entradaLectura(async (valor: string) => `eco ${valor}`, (args): [string] => [id.parse(args[0])]),
  falla: entradaLectura(async (): Promise<string> => {
    throw new Error("Failed query: select … params: +52 668 000 0000");
  }, (): [] => []),
};

afterEach(() => vi.restoreAllMocks());

describe("lote de lecturas (servidor)", () => {
  it("corre cada lectura y devuelve las respuestas en el mismo orden", async () => {
    const out = await ejecutarLote(registro, [
      { nombre: "eco", args: ["a"] },
      { nombre: "eco", args: ["b"] },
    ]);
    expect(out).toEqual([
      { ok: true, valor: "eco a" },
      { ok: true, valor: "eco b" },
    ]);
  });

  it("las corre en paralelo, no una tras otra", async () => {
    let abiertas = 0;
    let maximo = 0;
    const lenta = entradaLectura(async () => {
      abiertas++;
      maximo = Math.max(maximo, abiertas);
      await new Promise((r) => setTimeout(r, 5));
      abiertas--;
      return "ok";
    }, (): [] => []);
    await ejecutarLote({ lenta }, [
      { nombre: "lenta", args: [] },
      { nombre: "lenta", args: [] },
      { nombre: "lenta", args: [] },
    ]);
    expect(maximo).toBe(3);
  });

  it("una que falla no tumba a las demás y su error sale al log sin datos", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await ejecutarLote(registro, [
      { nombre: "falla", args: [] },
      { nombre: "eco", args: ["a"] },
    ]);
    expect(out).toEqual([{ ok: false }, { ok: true, valor: "eco a" }]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[lecturas] falla falló");
  });

  it("una lectura lenta sale en el log con su nombre", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ahora = vi.spyOn(performance, "now");
    ahora.mockReturnValueOnce(0).mockReturnValueOnce(1_500);
    await ejecutarLote(registro, [{ nombre: "eco", args: ["a"] }]);
    expect(aviso).toHaveBeenCalledWith("[lenta] lote › eco 1500 ms");
  });

  it("argumentos que no pasan la validación: esa lectura no sale", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await ejecutarLote(registro, [{ nombre: "eco", args: [42] }]);
    expect(out).toEqual([{ ok: false }]);
  });

  it("solo corre lo que está en el registro (ni nombres heredados del objeto)", async () => {
    const out = await ejecutarLote(registro, [
      { nombre: "sendMessage", args: ["c1"] },
      { nombre: "constructor", args: [] },
      { nombre: "__proto__", args: [] },
    ]);
    expect(out).toEqual([{ ok: false }, { ok: false }, { ok: false }]);
  });

  it(`rechaza un lote mal formado o de más de ${MAX_LOTE}`, async () => {
    await expect(ejecutarLote(registro, "nada")).rejects.toThrow();
    await expect(ejecutarLote(registro, [{ nombre: 1, args: [] }])).rejects.toThrow();
    const muchos = Array.from({ length: MAX_LOTE + 1 }, () => ({ nombre: "eco", args: ["a"] }));
    await expect(ejecutarLote(registro, muchos)).rejects.toThrow();
  });
});
