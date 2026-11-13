import { describe, expect, it } from "vitest";
import { BUEN_FIN_OFERTA_LINE, BUEN_FIN_PRECIO, buenFinOfertaLine } from "./buen-fin-oferta";

// Horas de Mazatlán (UTC-7 todo el año).
const at = (iso: string) => new Date(`${iso}-07:00`);

describe("buenFinOfertaLine", () => {
  it("no agrega nada antes del 13-nov a las 00:00 de Mazatlán", () => {
    expect(buenFinOfertaLine(at("2026-11-12T23:59:59"))).toBeNull();
  });

  it("agrega el aviso del 13-nov 00:00 al 17-nov 23:59:59", () => {
    expect(buenFinOfertaLine(at("2026-11-13T00:00:00"))).toBe(BUEN_FIN_OFERTA_LINE);
    expect(buenFinOfertaLine(at("2026-11-15T14:30:00"))).toBe(BUEN_FIN_OFERTA_LINE);
    expect(buenFinOfertaLine(at("2026-11-17T23:59:59"))).toBe(BUEN_FIN_OFERTA_LINE);
  });

  it("se apaga solo el 18-nov a las 00:00 de Mazatlán", () => {
    expect(buenFinOfertaLine(at("2026-11-18T00:00:00"))).toBeNull();
    expect(buenFinOfertaLine(at("2026-12-01T10:00:00"))).toBeNull();
  });
});

describe("BUEN_FIN_OFERTA_LINE (reglas del dueño, 13-nov)", () => {
  it("da la cifra de oferta y nunca el precio normal", () => {
    expect(BUEN_FIN_PRECIO).toBe("$5,199");
    expect(BUEN_FIN_OFERTA_LINE).toContain("$5,199");
    expect(BUEN_FIN_OFERTA_LINE).not.toMatch(/5[,.]?500/);
  });

  it("dice las fechas una sola vez y no las repite", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("del 13 al 17 de noviembre");
    expect(BUEN_FIN_OFERTA_LINE).toContain("no vuelvas a mencionar las fechas");
  });

  it("no anuncia que es solo para la estándar y deja igual la medida especial y la mini", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("No digas que la oferta es solo para las estándar");
    expect(BUEN_FIN_OFERTA_LINE).toContain("las hechas a la medida y las mini siguen con su precio");
  });

  it("usa el link de pago de la oferta y respeta la cotización de un vendedor", () => {
    expect(BUEN_FIN_OFERTA_LINE).toContain("link de pago de $5,199");
    expect(BUEN_FIN_OFERTA_LINE).toContain("si un vendedor ya fijó la cotización, esa manda");
  });
});
