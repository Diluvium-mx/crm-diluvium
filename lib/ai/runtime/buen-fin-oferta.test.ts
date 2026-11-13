import { describe, expect, it } from "vitest";
import { BUEN_FIN_OFERTA_LINE, BUEN_FIN_PRECIO, buenFinOfertaLine } from "./buen-fin-oferta";

// Horas de Mazatlán (UTC-7 todo el año).
const at = (iso: string) => new Date(`${iso}-07:00`);

describe("buenFinOfertaLine", () => {
  it("no agrega nada antes del 13-nov a las 00:00 de Mazatlán", () => {
    expect(buenFinOfertaLine(at("2026-11-12T23:59:59"))).toBeNull();
  });

  it("agrega el aviso del 13-nov 00:00 al 18-nov 23:59:59 (alargado un día el 13-nov)", () => {
    expect(buenFinOfertaLine(at("2026-11-13T00:00:00"))).toBe(BUEN_FIN_OFERTA_LINE);
    expect(buenFinOfertaLine(at("2026-11-17T23:59:59"))).toBe(BUEN_FIN_OFERTA_LINE);
    expect(buenFinOfertaLine(at("2026-11-18T23:59:59"))).toBe(BUEN_FIN_OFERTA_LINE);
  });

  it("se apaga solo el 19-nov a las 00:00 de Mazatlán", () => {
    expect(buenFinOfertaLine(at("2026-11-19T00:00:00"))).toBeNull();
    expect(buenFinOfertaLine(at("2026-12-01T10:00:00"))).toBeNull();
  });
});

describe("BUEN_FIN_OFERTA_LINE (reglas del dueño, 13-nov)", () => {
  it("da la cifra de oferta y nunca el precio normal ni el ahorro", () => {
    expect(BUEN_FIN_PRECIO).toBe("$5,199");
    expect(BUEN_FIN_OFERTA_LINE).toContain("$5,199");
    expect(BUEN_FIN_OFERTA_LINE).not.toMatch(/5[,.]?500|5[,.]?999/);
    expect(BUEN_FIN_OFERTA_LINE).toContain("ni digas cuánto se ahorra");
  });

  it("dice las fechas una sola vez, hasta el 18, y solo las repite si preguntan hasta cuándo", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("del 13 al 18 de noviembre");
    expect(BUEN_FIN_OFERTA_LINE).not.toContain("17 de noviembre");
    expect(BUEN_FIN_OFERTA_LINE).toContain("salvo que el cliente pregunte hasta cuándo");
  });

  it("no presume el descuento salvo que digan que es el mismo precio", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("No presumas el descuento");
    expect(BUEN_FIN_OFERTA_LINE).toContain("solo si el cliente dice que es el mismo precio o que no cambia mucho");
  });

  it("no dice por su cuenta que es solo para la estándar y contesta amable si preguntan por la medida o repuestos", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("No digas por tu cuenta que la oferta es solo para las estándar");
    expect(BUEN_FIN_OFERTA_LINE).toContain("la compuerta hecha a la medida, la mini o un repuesto (funda, tira de hule)");
    expect(BUEN_FIN_OFERTA_LINE).toContain("dile con amabilidad que la oferta del Buen Fin es para los tamaños estándar");
  });

  it("con la oferta la tarjeta es de contado: no ofrece meses sin intereses en la estándar", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("es de contado (crédito o débito)");
    expect(BUEN_FIN_OFERTA_LINE).toContain("no ofrezcas meses sin intereses en la compuerta estándar");
  });

  it("la página web y Amazon también tienen la oferta, sin decir el precio de Amazon", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("En la página web también está en $5,199 y en Amazon también hay oferta del Buen Fin (no digas el precio de Amazon)");
  });

  it("no ofrece apartados ni el precio después del 18, y no esconde el precio de antes", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("no ofrezcas apartados ni prometas el precio después de esa fecha");
    expect(BUEN_FIN_OFERTA_LINE).toContain("no digas que no puedes decirlo");
    expect(BUEN_FIN_OFERTA_LINE).toContain("no manejamos otro descuento");
  });

  it("usa el link de pago de la oferta y respeta la cotización de un vendedor", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("link de pago de $5,199");
    expect(BUEN_FIN_OFERTA_LINE).toContain("si un vendedor ya fijó la cotización, esa manda");
  });
});
