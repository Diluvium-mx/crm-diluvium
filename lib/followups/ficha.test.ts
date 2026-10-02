// La ficha de seguimiento del lector y su cruce con los datos duros del CRM (docs/seguimientos.md §5).
import { describe, expect, it } from "vitest";
import { finalCase, parseFicha, type FollowUpFicha, type HardSignals } from "./ficha";

const today = { zone: "America/Mexico_City", now: new Date("2026-10-05T12:00:00-06:00") };

describe("parseFicha", () => {
  it("toma los campos válidos y limpia el texto", () => {
    const ignored: string[] = [];
    const f = parseFicha(
      {
        caso: "faltan_medidas",
        pendiente: "  Se le pidió el ancho   de la cochera ",
        siguiente_paso: "Pedir el ancho",
        vale_la_pena: true,
        motivo: null,
        fecha_pedida: null,
        hora_pedida: null,
        borrador: "¿Me puede medir el ancho de lado a lado?\n\n\n\nGracias",
      },
      today,
      ignored,
    );
    expect(f).toEqual({
      caso: "faltan_medidas",
      pendiente: "Se le pidió el ancho de la cochera",
      siguientePaso: "Pedir el ancho",
      valeLaPena: true,
      motivo: null,
      fechaPedida: null,
      horaPedida: null,
      borrador: "¿Me puede medir el ancho de lado a lado?\n\nGracias",
    });
    expect(ignored).toEqual([]);
  });

  it("descarta lo raro sin tirar lo demás: caso inexistente, fecha pasada o muy lejana, hora mal escrita", () => {
    const ignored: string[] = [];
    expect(parseFicha({ caso: "llamar", pendiente: "x" }, today, ignored)?.caso).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-04" }, today, ignored)?.fechaPedida).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-12-20" }, today, ignored)?.fechaPedida).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-05", hora_pedida: "25:00" }, today, ignored)?.horaPedida).toBeNull();
    expect(ignored).toHaveLength(4);
  });

  it("fecha de hoy y hora sin cero ('9:30'); sin fecha, la hora no sirve", () => {
    const ignored: string[] = [];
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-05", hora_pedida: "9:30" }, today, ignored)).toMatchObject({ fechaPedida: "2026-10-05", horaPedida: "09:30" });
    expect(parseFicha({ caso: "pidio_fecha", hora_pedida: "18:00" }, today, ignored)?.horaPedida).toBeNull();
  });

  it("no es un objeto: nada", () => {
    expect(parseFicha("hola", today, [])).toBeNull();
    expect(parseFicha(null, today, [])).toBeNull();
  });
});

describe("finalCase: el modelo propone, el CRM confirma (en el orden de la tabla)", () => {
  const ficha = (caso: FollowUpFicha["caso"], extra: Partial<FollowUpFicha> = {}): FollowUpFicha => ({
    caso,
    pendiente: null,
    siguientePaso: null,
    valeLaPena: null,
    motivo: null,
    fechaPedida: null,
    horaPedida: null,
    borrador: null,
    ...extra,
  });
  const hard = (h: Partial<HardSignals> = {}): HardSignals => ({ asesorPendiente: false, stageRole: null, monto: null, pago: null, tieneMedidas: false, ...h });

  it("ya compró (etapa Venta cerrada o pagó el total): no seguir", () => {
    expect(finalCase(ficha("pago_pendiente"), hard({ stageRole: "venta_cerrada" })).caso).toBe("no_seguir");
    expect(finalCase(ficha("cotizacion_sin_respuesta"), hard({ monto: 5500, pago: 5500 })).caso).toBe("no_seguir");
  });

  it("dijo que no: no seguir", () => {
    expect(finalCase(ficha("no_seguir"), hard())).toEqual({ caso: "no_seguir", ajuste: null });
    expect(finalCase(ficha("precio_sin_respuesta", { valeLaPena: false }), hard()).caso).toBe("no_seguir");
  });

  it("el aviso amarillo de asesor gana a lo demás", () => {
    expect(finalCase(ficha("objecion"), hard({ asesorPendiente: true })).caso).toBe("asesor_sin_respuesta");
    expect(finalCase(ficha("asesor_sin_respuesta"), hard()).caso).toBe("asesor_sin_respuesta");
  });

  it("pidió fecha solo con fecha; sin fecha sigue con lo demás", () => {
    expect(finalCase(ficha("pidio_fecha", { fechaPedida: "2026-10-12" }), hard({ stageRole: "cerca_compra" })).caso).toBe("pidio_fecha");
    expect(finalCase(ficha("pidio_fecha"), hard()).caso).toBe("sin_punto_claro");
  });

  it("etapa Cerca de compra sin el pago completo: pago pendiente aunque el modelo dijera otra cosa", () => {
    const r = finalCase(ficha("precio_sin_respuesta"), hard({ stageRole: "cerca_compra", monto: 11000, pago: 3500 }));
    expect(r.caso).toBe("pago_pendiente");
    expect(r.ajuste).toMatch(/precio_sin_respuesta → pago_pendiente/);
  });

  it("con medidas y monto en el Detalle, al menos cotización", () => {
    expect(finalCase(ficha("precio_sin_respuesta"), hard({ tieneMedidas: true, monto: 5500 })).caso).toBe("cotizacion_sin_respuesta");
    expect(finalCase(ficha("objecion"), hard({ tieneMedidas: true, monto: 5500 })).caso).toBe("objecion");
    expect(finalCase(ficha("faltan_medidas"), hard({ tieneMedidas: true })).caso).toBe("faltan_medidas");
  });

  it("sin caso del modelo: sin punto claro", () => {
    expect(finalCase(null, hard())).toEqual({ caso: "sin_punto_claro", ajuste: "sin caso → sin_punto_claro (el modelo no dio caso)" });
  });
});
