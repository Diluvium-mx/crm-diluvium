import { describe, expect, it } from "vitest";
import { destinatarioCoincide, parseFecha, parseMontoMxn, verificarComprobante, type ContextoCotizacion, type LecturaComprobante } from "./comprobante";

const hoy = new Date("2026-09-23T18:00:00Z");
const datosCobro = { beneficiario: "Diluvium Control de Inundaciones SA de CV", clabe: "002010077777777771", cuenta: "1234567890", banco: "Banamex" };
const ctx = (over: Partial<ContextoCotizacion> = {}): ContextoCotizacion => ({
  totalCotizado: 5_500,
  cotizadoEn: new Date("2026-09-20T00:00:00Z"),
  anticipoConfirmado: 0,
  datosCobro,
  referenciaYaUsada: false,
  hoy,
  ...over,
});
const lectura = (over: Partial<LecturaComprobante> = {}): LecturaComprobante => ({
  monto: "$5,500.00",
  fecha: "23/09/2026",
  banco: "BBVA",
  referencia: "0012345678",
  destinatario: "DILUVIUM CONTROL DE INUNDACIONES",
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
  it("destinatario distinto → humano (depósito a otra cuenta nunca se confirma)", () => {
    expect(verificarComprobante(lectura({ destinatario: "JUAN PEREZ LOPEZ" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/destinatario/) });
    expect(verificarComprobante(lectura({ destinatario: null }), ctx())).toMatchObject({ ok: false });
  });
  it("referencia reutilizada (misma captura para otra compra) → humano", () => {
    expect(verificarComprobante(lectura(), ctx({ referenciaYaUsada: true }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya se usó/) });
    expect(verificarComprobante(lectura({ referencia: "12" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/referencia/) });
  });
  it("fecha futura o anterior a la cotización → humano; hoy y la fecha de la cotización sí valen", () => {
    expect(verificarComprobante(lectura({ fecha: "25/09/2026" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/futura/) });
    expect(verificarComprobante(lectura({ fecha: "15/09/2026" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/anterior a la cotización/) });
    expect(verificarComprobante(lectura({ fecha: "20/09/2026" }), ctx()).ok).toBe(true);
    expect(verificarComprobante(lectura({ fecha: "no se ve" }), ctx())).toMatchObject({ ok: false, motivo: expect.stringMatching(/fecha/) });
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
  it("destinatarioCoincide: nombre completo, CLABE completa o enmascarada, cuenta; otro nombre no", () => {
    expect(destinatarioCoincide("DILUVIUM CONTROL DE INUNDACIONES SA DE CV", datosCobro)).toBe(true);
    expect(destinatarioCoincide("002010077777777771", datosCobro)).toBe(true);
    expect(destinatarioCoincide("CLABE **** 7771", datosCobro)).toBe(true);
    expect(destinatarioCoincide("Cuenta ••••7890", datosCobro)).toBe(true);
    expect(destinatarioCoincide("DILUVIUM", datosCobro)).toBe(false); // faltan palabras del beneficiario
    expect(destinatarioCoincide("MARIA LOPEZ 002010077777777772", datosCobro)).toBe(false);
  });
});
