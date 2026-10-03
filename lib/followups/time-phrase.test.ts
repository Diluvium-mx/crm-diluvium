// {{1}} de las plantillas de seguimiento con tiempo y qué plantilla sale en cada intento (3-oct-2026).
import { describe, expect, it } from "vitest";
import { CASE_TEMPLATE, templateForAttempt, TIME_PHRASE_TEMPLATES } from "./cases";
import { timePhrase } from "./time-phrase";

const CDMX = "America/Mexico_City";
const mx = (local: string) => new Date(`${local}:00-06:00`);

describe("timePhrase: cuándo nos escribió el cliente, en su calendario y en minúsculas", () => {
  // Envío: miércoles 7-oct-2026 a las 10:00 (centro).
  const sale = mx("2026-10-07T10:00");
  it.each([
    ["2026-10-07T08:30", "hoy"],
    ["2026-10-06T15:00", "el día de ayer"],
    ["2026-10-06T18:59", "el día de ayer"],
    ["2026-10-06T19:00", "anoche"],
    ["2026-10-06T23:40", "anoche"],
    ["2026-10-05T12:00", "antier"],
    ["2026-10-04T12:00", "el domingo"],
    ["2026-10-01T12:00", "el jueves"],
    ["2026-09-30T12:00", "la semana pasada"],
    ["2026-09-24T12:00", "la semana pasada"],
    ["2026-09-23T12:00", "hace unas semanas"],
    ["2026-09-07T12:00", "hace un tiempo"],
  ])("escribió %s → «%s»", (local, phrase) => {
    expect(timePhrase(mx(local), sale, CDMX)).toBe(phrase);
  });

  it("cuenta en la zona del cliente: 23:30 en Tijuana es otro día que en el centro", () => {
    const tijuana = "America/Tijuana";
    const escribio = new Date("2026-10-06T23:30:00-07:00"); // martes 23:30 Tijuana = miércoles 00:30 centro
    const salida = new Date("2026-10-07T11:00:00-07:00");
    expect(timePhrase(escribio, salida, tijuana)).toBe("anoche");
    expect(timePhrase(escribio, salida, CDMX)).toBe("hoy");
  });

  it("nunca empieza con mayúscula", () => {
    for (let d = 0; d < 40; d++) {
      const p = timePhrase(new Date(mx("2026-10-07T10:00").getTime() - d * 86_400_000), mx("2026-10-07T10:00"), CDMX);
      expect(p[0]).toBe(p[0].toLowerCase());
    }
  });
});

describe("templateForAttempt", () => {
  const approved = new Set(["seg_valorar", "seg_medidas"]);
  it("1.º y 2.º: la del caso si ya está aprobada; si no, la de respaldo", () => {
    expect(templateForAttempt("cotizacion_sin_respuesta", 2, "seguimiento_proteccion", approved)).toBe("seg_valorar");
    expect(templateForAttempt("pago_pendiente", 1, "hola_buenos_dias", approved)).toBe("seg_valorar");
    expect(templateForAttempt("precio_sin_respuesta", 2, "hola_buenas_tardes", approved)).toBe("hola_buenas_tardes");
    expect(templateForAttempt("sin_punto_claro", 2, "hola_buenas_tardes", approved)).toBe("hola_buenas_tardes");
  });
  it("3.º: siempre la de respaldo (otro texto); con texto (sin plantilla) no cambia nada", () => {
    expect(templateForAttempt("cotizacion_sin_respuesta", 3, "hola_buenas_tardes", approved)).toBe("hola_buenas_tardes");
    expect(templateForAttempt("faltan_medidas", 1, null, approved)).toBeNull();
  });
  it("solo información usa seg_precio de fábrica (seg_informacion repite lo del agua); seg_informacion solo si el lector la elige", () => {
    const all = new Set(["seg_precio", "seg_informacion"]);
    expect(templateForAttempt("solo_informacion", 2, "hola_buenas_tardes", all)).toBe("seg_precio");
    expect(templateForAttempt("solo_informacion", 2, "hola_buenas_tardes", all, { plantilla2: "seg_informacion" })).toBe("seg_informacion");
  });
  it("la que eligió el lector: si está aprobada y no repite la del intento anterior; un saludo sale con el de la hora", () => {
    const all = new Set(["seg_valorar", "seg_objecion", "seguimiento_proteccion"]);
    expect(templateForAttempt("pago_pendiente", 3, "hola_buenos_dias", all, { plantilla3: "seg_objecion" }, "seg_valorar")).toBe("seg_objecion");
    expect(templateForAttempt("pago_pendiente", 3, "hola_buenos_dias", all, { plantilla3: "seg_valorar" }, "seg_valorar")).toBe("hola_buenos_dias");
    expect(templateForAttempt("pago_pendiente", 3, "hola_buenos_dias", all, { plantilla3: "seg_medidas" }, null)).toBe("hola_buenos_dias");
    expect(templateForAttempt("pago_pendiente", 3, "hola_buenas_tardes", all, { plantilla3: "hola_buenos_dias" }, "seg_valorar")).toBe("hola_buenas_tardes");
    expect(templateForAttempt("pago_pendiente", 3, "hola_buenos_dias", all, { plantilla3: "inventada" })).toBe("hola_buenos_dias");
    // Sin otra opción, sale la de la puerta
    expect(templateForAttempt("sin_punto_claro", 2, "hola_buenas_tardes", all, { plantilla2: "hola_buenas_tardes" }, "hola_buenos_dias")).toBe("hola_buenas_tardes");
  });
  it("las 6 plantillas: 4 con tiempo en {{1}} y 2 sin variable", () => {
    expect(new Set([...Object.values(CASE_TEMPLATE), "seg_informacion"])).toEqual(new Set(["seg_precio", "seg_informacion", "seg_valorar", "seg_medidas", "seg_asesor", "seg_objecion"]));
    expect([...TIME_PHRASE_TEMPLATES].sort()).toEqual(["seg_informacion", "seg_medidas", "seg_precio", "seg_valorar"]);
  });
});
