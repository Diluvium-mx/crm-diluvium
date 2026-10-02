// Hora de cada intento de un seguimiento (docs/seguimientos.md §6 y §6.2), sin base de datos.
// Ciudad de México = UTC-6 todo el año; Mazatlán = UTC-7; Tijuana en octubre = UTC-7 (verano).
import { describe, expect, it } from "vitest";
import { effectiveTotal, inVendorShift, planAttempt, presentAtFor, templateFor, templateTimeOf, windowOpenAt, type PlanInput } from "./schedule";
import { localParts } from "./time";

const CDMX = "America/Mexico_City";
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Hora local de la Ciudad de México ("2026-10-05T12:00") → instante. */
const mx = (local: string) => new Date(`${local}:00-06:00`);
/** Hora de Mazatlán. */
const mzt = (local: string) => new Date(`${local}:00-07:00`);
const at = (d: Date, zone = CDMX) => {
  const p = localParts(d, zone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
};

function plan(input: Partial<PlanInput> & Pick<PlanInput, "caso" | "stopAt">) {
  return planAttempt({ intento: 1, zone: CDMX, windowExpiresAt: null, now: new Date(input.stopAt.getTime() + 4 * MIN), ...input });
}

describe("1.er intento: texto antes del cierre de la ventana, a la hora del caso", () => {
  it("medidas, parado a las 12:00: sale a las 20:00 del mismo día (8 h de silencio), con texto", () => {
    const p = plan({ caso: "faltan_medidas", stopAt: mx("2026-10-05T12:00"), windowExpiresAt: mx("2026-10-06T11:58") });
    expect(at(p.dueAt)).toBe("2026-10-05 20:00");
    expect(p).toMatchObject({ door: "texto", templateName: null });
  });

  it("medidas, parado a las 21:00: sale a las 19:00 del día siguiente", () => {
    const p = plan({ caso: "faltan_medidas", stopAt: mx("2026-10-05T21:00"), windowExpiresAt: mx("2026-10-06T20:55") });
    expect(at(p.dueAt)).toBe("2026-10-06 19:00");
    expect(p.door).toBe("texto");
  });

  it("medidas, parado a las 16:00: la noche ya no cabe; la última hora antes del cierre (redondeada a 5 min)", () => {
    const p = plan({ caso: "faltan_medidas", stopAt: mx("2026-10-05T16:00"), windowExpiresAt: mx("2026-10-06T15:58") });
    expect(at(p.dueAt)).toBe("2026-10-06 14:55");
    expect(p.door).toBe("texto");
  });

  it("pago pendiente: a las 10:00 (para que alcance a pagar ese día)", () => {
    const p = plan({ caso: "pago_pendiente", stopAt: mx("2026-10-05T16:00"), windowExpiresAt: mx("2026-10-06T15:55") });
    expect(at(p.dueAt)).toBe("2026-10-06 10:00");
    expect(p.door).toBe("texto");
  });

  it("cotización: de 18:00 a 20:00; precio e información de noche", () => {
    expect(at(plan({ caso: "cotizacion_sin_respuesta", stopAt: mx("2026-10-05T09:00"), windowExpiresAt: mx("2026-10-06T08:55") }).dueAt)).toBe("2026-10-05 18:00");
    expect(at(plan({ caso: "precio_sin_respuesta", stopAt: mx("2026-10-05T09:00"), windowExpiresAt: mx("2026-10-06T08:55") }).dueAt)).toBe("2026-10-05 19:00");
    expect(at(plan({ caso: "solo_informacion", stopAt: mx("2026-10-05T12:30"), windowExpiresAt: mx("2026-10-06T12:25") }).dueAt)).toBe("2026-10-05 20:30");
  });

  it("si el lector leyó tarde, nunca en el pasado: el siguiente minuto útil, redondeado", () => {
    const p = plan({ caso: "faltan_medidas", stopAt: mx("2026-10-05T12:00"), windowExpiresAt: mx("2026-10-06T11:58"), now: mx("2026-10-05T20:12") });
    expect(at(p.dueAt)).toBe("2026-10-05 20:15");
  });

  it("ventana ya cerrada: plantilla al día siguiente a la hora del caso; los casos de noche, a las 18:00", () => {
    const p = plan({ caso: "precio_sin_respuesta", stopAt: mx("2026-10-05T10:00"), windowExpiresAt: mx("2026-10-04T09:00") });
    expect(at(p.dueAt)).toBe("2026-10-06 18:00");
    expect(p).toMatchObject({ door: "plantilla", templateName: "hola_buenas_tardes" });
  });

  it("nunca dos plantillas en menos de 7 días al mismo contacto", () => {
    const p = plan({ caso: "pago_pendiente", stopAt: mx("2026-10-05T10:00"), windowExpiresAt: null, lastTemplateAt: mx("2026-10-04T10:00") });
    expect(at(p.dueAt)).toBe("2026-10-11 10:00");
    expect(p).toMatchObject({ door: "plantilla", templateName: "hola_buenos_dias" });
  });
});

describe("asesor sin respuesta y pidió fecha", () => {
  it("asesor: 2 h después; de noche, a las 9:00 del día siguiente (con la ventana abierta, texto)", () => {
    expect(at(plan({ caso: "asesor_sin_respuesta", stopAt: mx("2026-10-05T11:00"), windowExpiresAt: mx("2026-10-06T10:58") }).dueAt)).toBe("2026-10-05 13:00");
    const noche = plan({ caso: "asesor_sin_respuesta", stopAt: mx("2026-10-05T20:30"), windowExpiresAt: mx("2026-10-06T20:25") });
    expect(at(noche.dueAt)).toBe("2026-10-06 09:00");
    expect(noche.door).toBe("texto");
  });

  it("pidió el lunes (sin hora): ese día a las 11:00; con la ventana cerrada, plantilla de la mañana", () => {
    const p = plan({ caso: "pidio_fecha", stopAt: mx("2026-10-05T13:00"), windowExpiresAt: mx("2026-10-06T12:55"), fechaPedida: "2026-10-12" });
    expect(at(p.dueAt)).toBe("2026-10-12 11:00");
    expect(p).toMatchObject({ door: "plantilla", templateName: "hola_buenos_dias" });
  });

  it("\"al rato\" (mismo día, sin hora): 3 h después, con texto", () => {
    const p = plan({ caso: "pidio_fecha", stopAt: mx("2026-10-05T13:00"), windowExpiresAt: mx("2026-10-06T12:55"), fechaPedida: "2026-10-05" });
    expect(at(p.dueAt)).toBe("2026-10-05 16:00");
    expect(p.door).toBe("texto");
  });

  it("hora pedida de noche: dentro del horario (21:00) y, si es plantilla, a más tardar a las 19:00", () => {
    const abierta = plan({ caso: "pidio_fecha", stopAt: mx("2026-10-05T13:00"), windowExpiresAt: mx("2026-10-06T12:55"), fechaPedida: "2026-10-05", horaPedida: "22:30" });
    expect(at(abierta.dueAt)).toBe("2026-10-05 21:00");
    expect(abierta.door).toBe("texto");
    const cerrada = plan({ caso: "pidio_fecha", stopAt: mx("2026-10-05T13:00"), windowExpiresAt: mx("2026-10-06T12:55"), fechaPedida: "2026-10-07", horaPedida: "22:30" });
    expect(at(cerrada.dueAt)).toBe("2026-10-07 19:00");
    expect(cerrada).toMatchObject({ door: "plantilla", templateName: "hola_buenas_tardes" });
  });

  it("pidió fecha con el 1.º en plantilla: solo 2 intentos y el 2.º a 7 días", () => {
    expect(effectiveTotal("pidio_fecha", "plantilla")).toBe(2);
    expect(effectiveTotal("pidio_fecha", "texto")).toBe(3);
    expect(effectiveTotal("precio_sin_respuesta", "plantilla")).toBe(2);
    const p = planAttempt({
      caso: "pidio_fecha",
      intento: 2,
      zone: CDMX,
      stopAt: mx("2026-10-05T13:00"),
      windowExpiresAt: mx("2026-10-06T12:55"),
      now: mx("2026-10-12T11:01"),
      fechaPedida: "2026-10-12",
      prevAttemptAt: mx("2026-10-12T11:00"),
      lastTemplateAt: mx("2026-10-12T11:00"),
    });
    expect(at(p.dueAt)).toBe("2026-10-19 11:00");
  });
});

describe("2.º y 3.er intento", () => {
  const base = { zone: CDMX, stopAt: mx("2026-10-05T13:00"), windowExpiresAt: mx("2026-10-06T12:55") };

  it("2.º el día 2 con plantilla: cotización → seguimiento_proteccion a las 18:00", () => {
    const p = planAttempt({ ...base, caso: "cotizacion_sin_respuesta", intento: 2, now: mx("2026-10-05T18:01"), prevAttemptAt: mx("2026-10-05T18:00") });
    expect(at(p.dueAt)).toBe("2026-10-07 18:00");
    expect(p).toMatchObject({ door: "plantilla", templateName: "seguimiento_proteccion" });
  });

  it("2.º de un caso de noche: a las 18:00 con el saludo de la tarde", () => {
    const p = planAttempt({ ...base, caso: "faltan_medidas", intento: 2, now: mx("2026-10-05T20:01"), prevAttemptAt: mx("2026-10-05T20:00") });
    expect(at(p.dueAt)).toBe("2026-10-07 18:00");
    expect(p.templateName).toBe("hola_buenas_tardes");
  });

  it("3.º el día 9 (7 días después del 2.º) y respeta los 7 días entre plantillas", () => {
    const p = planAttempt({
      ...base,
      caso: "cotizacion_sin_respuesta",
      intento: 3,
      now: mx("2026-10-07T18:01"),
      prevAttemptAt: mx("2026-10-07T18:00"),
      lastTemplateAt: mx("2026-10-07T18:00"),
    });
    expect(at(p.dueAt)).toBe("2026-10-14 18:00");
    expect(p.templateName).toBe("hola_buenas_tardes");
  });

  it("pago pendiente: 2.º a las 10:00 con saludo de la mañana; 3.º con seguimiento_proteccion", () => {
    const dos = planAttempt({ ...base, caso: "pago_pendiente", intento: 2, now: mx("2026-10-06T10:01"), prevAttemptAt: mx("2026-10-06T10:00") });
    expect(at(dos.dueAt)).toBe("2026-10-07 10:00");
    expect(dos.templateName).toBe("hola_buenos_dias");
    const tres = planAttempt({ ...base, caso: "pago_pendiente", intento: 3, now: mx("2026-10-07T10:01"), prevAttemptAt: mx("2026-10-07T10:00"), lastTemplateAt: mx("2026-10-07T10:00") });
    expect(at(tres.dueAt)).toBe("2026-10-14 10:00");
    expect(tres.templateName).toBe("seguimiento_proteccion");
  });
});

describe("zona del cliente", () => {
  it("Tijuana (UTC-7 en octubre): la hora del caso es la de Tijuana", () => {
    const zone = "America/Tijuana";
    const stop = new Date("2026-10-05T12:00:00-07:00");
    const p = planAttempt({ caso: "faltan_medidas", intento: 1, zone, stopAt: stop, windowExpiresAt: new Date("2026-10-06T11:58:00-07:00"), now: new Date(stop.getTime() + MIN) });
    expect(at(p.dueAt, zone)).toBe("2026-10-05 20:00");
    expect(p.dueAt.toISOString()).toBe("2026-10-06T03:00:00.000Z");
  });

  it("plantilla de la mañana o de la tarde según la hora del cliente; la de los casos de noche, a las 18:00", () => {
    expect(templateFor("saludo", mx("2026-10-05T11:59"), CDMX)).toBe("hola_buenos_dias");
    expect(templateFor("saludo", mx("2026-10-05T12:00"), CDMX)).toBe("hola_buenas_tardes");
    expect(templateFor("proteccion", mx("2026-10-05T09:00"), CDMX)).toBe("seguimiento_proteccion");
    expect(templateTimeOf("faltan_medidas")).toBe("18:00");
    expect(templateTimeOf("pago_pendiente")).toBe("10:00");
  });

  it("ventana abierta con 1 h de margen", () => {
    const close = mx("2026-10-06T12:00");
    expect(windowOpenAt(close, new Date(close.getTime() - HOUR))).toBe(true);
    expect(windowOpenAt(close, new Date(close.getTime() - HOUR + MIN))).toBe(false);
    expect(windowOpenAt(null, close)).toBe(false);
  });
});

describe("sugerencias: horario de los vendedores (Mazatlán, L–V 9–18, sáb 9–13)", () => {
  const now = mzt("2026-10-01T08:00");
  it("dentro del turno: a su hora", () => {
    expect(inVendorShift(mzt("2026-10-05T10:00"))).toBe(true);
    expect(presentAtFor(mzt("2026-10-05T10:00"), now).toISOString()).toBe(mzt("2026-10-05T10:00").toISOString());
  });
  it("de noche: en la última hora del turno (17:00)", () => {
    expect(presentAtFor(mzt("2026-10-05T20:00"), now).toISOString()).toBe(mzt("2026-10-05T17:00").toISOString());
  });
  it("domingo o lunes temprano: el sábado a las 12:00", () => {
    expect(inVendorShift(mzt("2026-10-04T12:00"))).toBe(false);
    expect(presentAtFor(mzt("2026-10-04T19:00"), now).toISOString()).toBe(mzt("2026-10-03T12:00").toISOString());
    expect(presentAtFor(mzt("2026-10-05T07:00"), now).toISOString()).toBe(mzt("2026-10-03T12:00").toISOString());
  });
  it("si esa hora ya pasó: ahora", () => {
    const late = mzt("2026-10-05T19:30");
    expect(presentAtFor(mzt("2026-10-05T20:00"), late).toISOString()).toBe(late.toISOString());
  });
});
