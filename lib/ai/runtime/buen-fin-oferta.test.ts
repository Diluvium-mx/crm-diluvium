import { describe, expect, it } from "vitest";
import { BUEN_FIN_OFERTA_LINE, BUEN_FIN_PRECIO, BUEN_FIN_TERMINO_LINE, buenFinOfertaLine } from "./buen-fin-oferta";

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

  it("el 19-nov a las 00:00 cambia al aviso «ya terminó», que sale hasta el 25-nov (14-nov)", () => {
    expect(buenFinOfertaLine(at("2026-11-19T00:00:00"))).toBe(BUEN_FIN_TERMINO_LINE);
    expect(buenFinOfertaLine(at("2026-11-25T23:59:59"))).toBe(BUEN_FIN_TERMINO_LINE);
  });

  it("se apaga solo el 26-nov a las 00:00 de Mazatlán", () => {
    expect(buenFinOfertaLine(at("2026-11-26T00:00:00"))).toBeNull();
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
    expect(BUEN_FIN_OFERTA_LINE).toContain("la compuerta hecha a la medida, la mini, los tapones inflables o un repuesto (funda, tira de hule)");
    expect(BUEN_FIN_OFERTA_LINE).toContain("dile con amabilidad que la oferta del Buen Fin es para los tamaños estándar");
  });

  it("con la oferta sí hay meses sin intereses con crédito, sin decir cuántos (14-nov)", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("sí se puede pagar a meses sin intereses con tarjeta de crédito");
    expect(BUEN_FIN_OFERTA_LINE).toContain("sin decir cuántos meses");
    expect(BUEN_FIN_OFERTA_LINE).not.toMatch(/\b(3|6|9|12)\s*meses/);
    expect(BUEN_FIN_OFERTA_LINE).not.toContain("no ofrezcas meses sin intereses");
  });

  it("la web ($5,199), Amazon y Mercado Libre tienen la oferta; nunca el precio de Amazon ni de Mercado Libre (14-nov)", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("también está en nuestra página web, en $5,199, y en Amazon y Mercado Libre");
    expect(BUEN_FIN_OFERTA_LINE).toContain("de Amazon y Mercado Libre di solo que también tienen la compuerta en oferta, nunca su precio");
  });

  it("menciona esas tiendas solo si preguntan dónde más comprar o si duda de pagar por WhatsApp (14-nov)", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("Menciona esas tiendas solo si el cliente pregunta dónde más puede comprarla");
    expect(BUEN_FIN_OFERTA_LINE).toContain("si duda de pagar por WhatsApp (desconfía o teme un fraude)");
  });

  it("si alguien que ya compró pide la diferencia: un asesor lo revisa, aviso al vendedor y sin prometer (14-nov)", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("ya compró antes del 13 de noviembre pide que le regresen la diferencia");
    expect(BUEN_FIN_OFERTA_LINE).toContain("aviso_vendedor motivo cliente_pide_humano");
    expect(BUEN_FIN_OFERTA_LINE).toContain("no prometas nada");
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

describe("BUEN_FIN_TERMINO_LINE (dueño, 14-nov: después del 18)", () => {
  it("vuelve al precio de siempre del Goal y ya no usa $5,199 en totales", () => {
    expect(BUEN_FIN_TERMINO_LINE).toContain("terminó el 18 de noviembre");
    expect(BUEN_FIN_TERMINO_LINE).toContain("volvió a su precio de siempre, el que dice el Goal");
    expect(BUEN_FIN_TERMINO_LINE).toContain("ya no uses $5,199 en precios, totales ni fijar_cotizacion");
    expect(BUEN_FIN_TERMINO_LINE).not.toMatch(/5[,.]?500|5[,.]?999/);
  });

  it("a quien se le dio la oferta: precio de siempre y aviso al vendedor, sin prometer que se respeta", () => {
    expect(BUEN_FIN_TERMINO_LINE).toContain("Si en este chat se le dio el precio de oferta");
    expect(BUEN_FIN_TERMINO_LINE).toContain("aviso_vendedor motivo cliente_pide_humano");
    expect(BUEN_FIN_TERMINO_LINE).toContain("no prometas que se le respeta");
    expect(BUEN_FIN_TERMINO_LINE).toContain("Si en este chat no se habló de la oferta, no la menciones");
  });
});
