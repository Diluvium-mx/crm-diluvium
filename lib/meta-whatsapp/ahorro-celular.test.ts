import { describe, expect, it } from "vitest";
import { calcularAhorroCelular, diaSinGratis } from "./ahorro-celular";

const gratis = (day: string, volume: number) => ({ day, category: "service", pricingType: "free_customer_service", volume, costUsd: 0 });

describe("diaSinGratis", () => {
  it("el día en que Meta llegó a los 1,000 mensajes normales gratis; null si no llegó; día 7 si no hay dato del mes", () => {
    expect(diaSinGratis([gratis("2026-11-02", 400), gratis("2026-11-01", 300), gratis("2026-11-03", 300)], "2026-11")).toBe("2026-11-03");
    expect(diaSinGratis([gratis("2026-11-01", 999)], "2026-11")).toBeNull();
    expect(diaSinGratis([gratis("2026-10-31", 2000)], "2026-11")).toBe("2026-11-07");
  });
});

describe("calcularAhorroCelular", () => {
  it("antes de octubre los mensajes normales eran gratis: solo cuentan las plantillas", () => {
    const r = calcularAhorroCelular(
      [
        { day: "2026-09-28", conversationId: "a", gratisAnuncio: false, ventana: true, mensajes: 3, cobradosMeta: 0 },
        { day: "2026-09-28", conversationId: "b", gratisAnuncio: false, ventana: false, mensajes: 2, cobradosMeta: 0 },
      ],
      [],
    );
    expect(r.total).toMatchObject({ mensajes: 5, gratisMil: 3, normales: 0, plantillas: 1, ahorroUsd: 0.04 });
  });

  it("si Meta cobró todos los de un chat cerrado, no hay plantilla ahorrada; los meses van del más nuevo al más viejo", () => {
    const r = calcularAhorroCelular(
      [
        { day: "2026-10-20", conversationId: "a", gratisAnuncio: false, ventana: false, mensajes: 2, cobradosMeta: 2 },
        { day: "2026-11-02", conversationId: "b", gratisAnuncio: true, ventana: false, mensajes: 4, cobradosMeta: 0 },
      ],
      [],
    );
    expect(r.total).toMatchObject({ mensajes: 6, plantillas: 0, gratisAnuncio: 4, ahorroUsd: 0, cobradosMeta: 2 });
    expect(r.porMes.map((m) => m.mes)).toEqual(["2026-11", "2026-10"]);
  });
});
