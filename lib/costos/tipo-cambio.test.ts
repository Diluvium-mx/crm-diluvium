import { describe, expect, it } from "vitest";
import { mesDe } from "./mes";
import { type GetLike, leerTipoCambio, promedioDolar } from "./tipo-cambio";

const OCT = mesDe("2026-10");
// Forma real de la respuesta de SIDOF (indicador 158 «DÓLAR»).
const respuesta = {
  messageCode: 200,
  response: "OK",
  ListaIndicadores: [
    { codIndicador: 1, codTipoIndicador: 158, fecha: "30-09-2026", valor: "19.9999" },
    { codIndicador: 2, codTipoIndicador: 158, fecha: "01-10-2026", valor: "18.4000" },
    { codIndicador: 3, codTipoIndicador: 158, fecha: "31-10-2026", valor: "18.6000" },
    { codIndicador: 4, codTipoIndicador: 158, fecha: "15-10-2026", valor: "no-numero" },
    { codIndicador: 5, codTipoIndicador: 158, fecha: "2026-10-16", valor: "18.5" },
  ],
};

describe("promedioDolar", () => {
  it("promedia solo los días del mes con valor válido", () => {
    expect(promedioDolar(respuesta, OCT)).toEqual({ mxnPorUsd: 18.5, dias: 2 });
  });
  it("sin valores del mes o respuesta rara: null", () => {
    expect(promedioDolar({ ListaIndicadores: [] }, OCT)).toBeNull();
    expect(promedioDolar({ error: "x" }, OCT)).toBeNull();
    expect(promedioDolar(null, OCT)).toBeNull();
  });
});

describe("leerTipoCambio", () => {
  it("pide el mes completo a SIDOF en su formato de fecha", async () => {
    const urls: string[] = [];
    const fetchImpl: GetLike = async (url) => {
      urls.push(url);
      return { ok: true, json: async () => respuesta };
    };
    expect(await leerTipoCambio(OCT, fetchImpl)).toEqual({ mxnPorUsd: 18.5, dias: 2 });
    expect(urls).toEqual(["https://sidof.segob.gob.mx/dof/sidof/indicadores/158/01-10-2026/31-10-2026"]);
  });
  it("si falla la red o responde con error: null (el correo sale en dólares)", async () => {
    expect(await leerTipoCambio(OCT, async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await leerTipoCambio(OCT, async () => Promise.reject(new Error("sin red")))).toBeNull();
  });
});
