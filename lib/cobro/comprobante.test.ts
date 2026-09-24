import { describe, expect, it } from "vitest";
import { parseFecha, parseMontoMxn, verificarComprobante, type ContextoCotizacion, type LecturaComprobante } from "./comprobante";

const hoy = new Date("2026-09-23T18:00:00Z");
const ctx = (over: Partial<ContextoCotizacion> = {}): ContextoCotizacion => ({
  totalCotizado: 5_500,
  anticipoConfirmado: 0,
  referenciaYaUsada: false,
  hoy,
  ...over,
});
const lectura = (over: Partial<LecturaComprobante> = {}): LecturaComprobante => ({
  monto: "$5,500.00",
  fecha: "23/09/2026",
  banco: "BBVA",
  referencia: "0012345678",
  ...over,
});

describe("verificarComprobante", () => {
  it("pago completo que cuadra en todo → Compra con aviso para cotejar", () => {
    const r = verificarComprobante(lectura(), ctx());
    expect(r).toMatchObject({ ok: true, tipo: "completo", etapa: "compra", montoMxn: 5500 });
    expect(r.ok && r.aviso).toMatch(/Cotejar el depósito/);
  });
  it("anticipo del 50 % o $3,500 de medida especial → Cerca de compra; después la liquidación exacta → Compra", () => {
    expect(verificarComprobante(lectura({ monto: "2,750" }), ctx())).toMatchObject({ ok: true, tipo: "anticipo", etapa: "cerca_compra" });
    expect(verificarComprobante(lectura({ monto: "3500" }), ctx({ totalCotizado: 7_000 }))).toMatchObject({ ok: true, tipo: "anticipo" });
    expect(verificarComprobante(lectura({ monto: "3,500", referencia: "B2345" }), ctx({ totalCotizado: 7_000, anticipoConfirmado: 3_500 }))).toMatchObject({ ok: true, tipo: "liquidacion", etapa: "compra" });
    // Tras un anticipo, un monto que no es el resto pendiente va a humano.
    expect(verificarComprobante(lectura({ monto: "3,000" }), ctx({ totalCotizado: 7_000, anticipoConfirmado: 3_500 }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/resto pendiente es \$3,500/) });
  });
  it("el monto no cuadra con el total ni con un anticipo → humano con el motivo", () => {
    expect(verificarComprobante(lectura({ monto: "4,000" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/no coincide con el total cotizado \(\$5,500\)/) });
  });
  it("referencia reutilizada (misma captura para otra compra) → humano", () => {
    expect(verificarComprobante(lectura(), ctx({ referenciaYaUsada: true }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya se usó/) });
    expect(verificarComprobante(lectura({ referencia: "12" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/referencia/) });
  });
  it("sin regla de fecha (24-sep): futura, pasada, ilegible o ausente no cambian el resultado; solo va al aviso", () => {
    expect(verificarComprobante(lectura({ fecha: "25/09/2026" }), ctx()).ok).toBe(true);
    expect(verificarComprobante(lectura({ fecha: "15/09/2026" }), ctx()).ok).toBe(true);
    expect(verificarComprobante(lectura({ fecha: "no se ve" }), ctx()).ok).toBe(true);
    const r = verificarComprobante(lectura({ fecha: null }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.aviso).toMatch(/sin fecha legible/);
  });
  it("moneda distinta de MXN → humano; $5,499 contra $5,500 no cuadra (tolerancia de un centavo)", () => {
    expect(verificarComprobante(lectura({ moneda: "USD" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/USD/) });
    expect(verificarComprobante(lectura({ moneda: "MXN" }), ctx()).ok).toBe(true);
    expect(verificarComprobante(lectura({ moneda: "pesos" }), ctx()).ok).toBe(true);
    expect(verificarComprobante(lectura({ monto: "5,499" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/no coincide/) });
    expect(verificarComprobante(lectura({ monto: "5,500.00" }), ctx()).ok).toBe(true);
  });
  it("la referencia se normaliza (ABC-123 = abc 123 = ABC123) y se devuelve canónica", () => {
    const r = verificarComprobante(lectura({ referencia: "abc-1 23" }), ctx());
    expect(r).toMatchObject({ ok: true, referencia: "ABC123" });
    expect(verificarComprobante(lectura({ referencia: "1 2 3" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/referencia/) });
  });
  it("sin monto de cotización en el contacto → humano (el vendedor lo fija en el detalle)", () => {
    expect(verificarComprobante(lectura(), ctx({ totalCotizado: null }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/monto de cotización/) });
  });
  it("monto ilegible → humano", () => {
    expect(verificarComprobante(lectura({ monto: "borroso" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/monto/) });
  });
});

describe("helpers", () => {
  it("parseMontoMxn entiende los formatos de los comprobantes", () => {
    expect(parseMontoMxn("$5,500.00 MXN")).toBe(5500);
    expect(parseMontoMxn("5.500,50")).toBe(5500.5);
    expect(parseMontoMxn(3500)).toBe(3500);
    expect(parseMontoMxn("")).toBeNull();
  });
  it("parseFecha entiende dd/mm/aaaa, ISO y '23 de septiembre de 2026'", () => {
    expect(parseFecha("23/09/2026")?.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(parseFecha("2026-09-23 14:05")?.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(parseFecha("23 de septiembre de 2026")?.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(parseFecha("23 sep 26")).toBeNull();
    expect(parseFecha("31/02/2026")).not.toBeNull(); // se acepta como fecha leída; la lógica solo compara
  });
});
