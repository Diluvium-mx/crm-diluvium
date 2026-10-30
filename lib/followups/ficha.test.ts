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
      casoDeFondo: null,
      plantilla2: null,
      plantilla3: null,
    });
    expect(ignored).toEqual([]);
  });

  it("pidió fecha: guarda el asunto pendiente; en otro caso se ignora. Plantillas: solo nombres limpios", () => {
    const ignored: string[] = [];
    const f = parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-05", caso_de_fondo: "faltan_medidas", plantilla_2: "seg_medidas", plantilla_3: "Hola!!" }, today, ignored);
    expect(f?.casoDeFondo).toBe("faltan_medidas");
    expect(f?.plantilla2).toBe("seg_medidas");
    expect(f?.plantilla3).toBeNull();
    expect(parseFicha({ caso: "objecion", caso_de_fondo: "faltan_medidas" }, today, ignored)?.casoDeFondo).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", caso_de_fondo: "no_seguir" }, today, ignored)?.casoDeFondo).toBeNull();
  });

  it("descarta lo raro sin tirar lo demás: caso inexistente, fecha pasada, hora mal escrita", () => {
    const ignored: string[] = [];
    expect(parseFicha({ caso: "llamar", pendiente: "x" }, today, ignored)?.caso).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-04" }, today, ignored)?.fechaPedida).toBeNull();
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-10-05", hora_pedida: "25:00" }, today, ignored)?.horaPedida).toBeNull();
    expect(ignored).toHaveLength(3);
  });

  it("fecha lejana (30-oct-2026): hasta 120 días se toma tal cual; más lejos, se recorre al día 120 (nunca se descarta)", () => {
    const ignored: string[] = [];
    // «voy a casa hasta diciembre» (29-oct) y «a fin de año» (22-oct): con el tope de 60 días la segunda se tiraba.
    const oct29 = { zone: "America/Mexico_City", now: new Date("2026-10-29T21:25:00-06:00") };
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-12-01", caso_de_fondo: "faltan_medidas" }, oct29, ignored)?.fechaPedida).toBe("2026-12-01");
    const oct22 = { zone: "America/Mexico_City", now: new Date("2026-10-22T12:00:00-06:00") };
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-12-20" }, oct22, ignored)?.fechaPedida).toBe("2026-12-20");
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-12-31" }, oct22, ignored)?.fechaPedida).toBe("2026-12-31");
    expect(ignored).toEqual([]);
    // 5-oct + 120 días = 2-feb-2027.
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2027-03-01" }, today, ignored)?.fechaPedida).toBe("2027-02-02");
    expect(ignored).toEqual(["seguimiento.fecha_pedida: 2027-03-01 a más de 120 días; se toma el 2027-02-02"]);
  });

  it("año viejo por error (auditoría F4, 14-oct-2026): se toma con el año de hoy o el siguiente si cae en el rango", () => {
    const ignored: string[] = [];
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2025-10-10" }, today, ignored)?.fechaPedida).toBe("2026-10-10");
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2024-10-12" }, today, ignored)?.fechaPedida).toBe("2026-10-12");
    // Con el año de hoy ya pasó y con el siguiente queda muy lejos: se descarta como antes.
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2025-10-04" }, today, ignored)?.fechaPedida).toBeNull();
    expect(ignored).toEqual(["seguimiento.fecha_pedida: 2025-10-04 ya pasó"]);
    const diciembre = { zone: today.zone, now: new Date("2026-12-28T18:00:00Z") };
    expect(parseFicha({ caso: "pidio_fecha", fecha_pedida: "2026-01-03" }, diciembre, [])?.fechaPedida).toBe("2027-01-03");
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
    casoDeFondo: null,
    plantilla2: null,
    plantilla3: null,
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
