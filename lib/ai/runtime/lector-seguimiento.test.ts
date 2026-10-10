// La ficha de seguimiento dentro de la MISMA lectura del lector (docs/seguimientos.md §5): solo
// cuando el último mensaje del chat es de la empresa; sin llamada extra al modelo.
import { describe, expect, it } from "vitest";
import { defaultStages } from "@/lib/contacts/stages";
import { buildLectorSystem, buildLectorTools, evidenceFrom, FOLLOW_UP_INSTRUCTIONS, followUpInstructions, lastIsCompany, LECTOR_TOOL, lectorSchemaFor, parseLectorCalls, type LectorMessage } from "./lector-core";
import { FACTORY_TABLE, type FollowUpTable } from "@/lib/followups/tabla";

const KEYS = defaultStages().map((s) => s.key);
const m = (direction: "in" | "out"): LectorMessage => ({
  id: crypto.randomUUID(),
  direction,
  type: "text",
  body: "x",
  templateName: null,
  attachments: [],
  source: direction === "in" ? "contact" : "ai_agent",
  at: new Date("2026-10-05T12:00:00Z"),
});

describe("lector + seguimiento", () => {
  it("se pide la ficha solo si el último mensaje es de la empresa", () => {
    expect(lastIsCompany([m("in"), m("out")])).toBe(true);
    expect(lastIsCompany([m("out"), m("in")])).toBe(false);
    expect(lastIsCompany([])).toBe(false);
  });

  it("instrucciones y herramienta llevan el seguimiento solo cuando se pide", () => {
    const stages = defaultStages();
    expect(buildLectorSystem(stages)).not.toContain("SEGUIMIENTO");
    expect(buildLectorSystem(stages, { followUp: true })).toContain(FOLLOW_UP_INSTRUCTIONS);
    // Acuse corto del cliente al final (10-oct-2026): el bloque solo va cuando aplica.
    expect(buildLectorSystem(stages, { followUp: true })).not.toContain("EL CHAT TERMINA CON UN MENSAJE CORTO DEL CLIENTE");
    expect(buildLectorSystem(stages, { followUp: true, acuse: true })).toContain("EL CHAT TERMINA CON UN MENSAJE CORTO DEL CLIENTE");
    expect(Object.keys(lectorSchemaFor(KEYS).shape)).not.toContain("seguimiento");
    expect(Object.keys(lectorSchemaFor(KEYS, { followUp: true }).shape)).toContain("seguimiento");
    expect(buildLectorTools(stages, { followUp: true }).stageKeys).toEqual(KEYS);
  });

  it("las instrucciones siguen el orden de prioridad de la tabla y piden el borrador sin saludo", () => {
    const order = ["no_seguir", "asesor_sin_respuesta", "pidio_fecha", "pago_pendiente", "objecion", "cotizacion_sin_respuesta", "faltan_medidas", "precio_sin_respuesta", "solo_informacion", "sin_punto_claro"];
    const positions = order.map((caso) => FOLLOW_UP_INSTRUCTIONS.indexOf(`- ${caso}:`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/SIN saludo al principio/);
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/NUNCA el nombre del cliente/);
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/solo paso a dar seguimiento/);
  });

  it("las frases de pago van en «pidió fecha» con su día y sin hora (opción A de la quincena, 7-oct-2026)", () => {
    const line = FOLLOW_UP_INSTRUCTIONS.split("\n").find((l) => l.startsWith("- pidio_fecha:")) ?? "";
    expect(line).toContain('"en la quincena", "cuando me paguen", "cuando cobre" o "el día de pago" (sin decir qué día) = el próximo día 15 o el último del mes, el que llegue primero');
    expect(line).toContain('"a fin de mes" = el último día del mes; "a principios de mes" = el día 1 del mes siguiente');
    expect(line).toContain('si dijo qué día le pagan ("me pagan el viernes"), ese día');
    expect(line).toContain('solo el día ("mañana", "el lunes", "en la quincena") → sin hora');
    // Sigue igual: sin día ni momento no es fecha.
    expect(line).toContain('"Cuando pueda" o "cuando tenga la cinta", SIN día ni momento, NO es pidio_fecha');
  });

  it("«Qué busca» y la hora salen de la tabla de la organización (Agente IA › Seguimientos)", () => {
    // De fábrica: el texto de siempre (precio e información comparten renglón).
    expect(followUpInstructions(FACTORY_TABLE)).toBe(FOLLOW_UP_INSTRUCTIONS);
    expect(FOLLOW_UP_INSTRUCTIONS).toContain("- precio_sin_respuesta y solo_informacion: avanzar un paso según cómo quedó");
    expect(FOLLOW_UP_INSTRUCTIONS).toContain("(hora del cliente: pago 10:00; objeción y medidas de 19:00 a 20:30, ya en su casa;");
    const table: FollowUpTable = {
      ...FACTORY_TABLE,
      casos: {
        ...FACTORY_TABLE.casos,
        precio_sin_respuesta: { ...FACTORY_TABLE.casos.precio_sin_respuesta, busca: "Saber si ya tiene la medida de su cochera." },
        pago_pendiente: { ...FACTORY_TABLE.casos.pago_pendiente, from: "12:00", to: "13:00" },
        objecion: { ...FACTORY_TABLE.casos.objecion, on: false },
      },
    };
    const text = followUpInstructions(table);
    expect(text).toContain("- precio_sin_respuesta: saber si ya tiene la medida de su cochera.");
    expect(text).toContain("- solo_informacion: avanzar un paso según cómo quedó");
    expect(text).toContain("(hora del cliente: asesor 2 h después y luego de 10:00 a 11:00; pago de 12:00 a 13:00; cotización de 18:00 a 20:00;");
    expect(text).not.toContain("objeción de");
    expect(buildLectorSystem(defaultStages(), { followUp: true, table })).toContain(text);
  });

  it("parseLectorCalls devuelve la ficha (validada) solo con el contexto del seguimiento", () => {
    const input = {
      etapa: null,
      seguimiento: { caso: "faltan_medidas", pendiente: "Falta el ancho", siguiente_paso: "Pedir el ancho", vale_la_pena: true, borrador: "¿Me puede medir el ancho?", fecha_pedida: null, hora_pedida: null, motivo: null },
    };
    const calls = [{ toolName: LECTOR_TOOL, input }];
    const ctx = { zone: "America/Mexico_City", now: new Date("2026-10-05T12:00:00-06:00") };
    expect(parseLectorCalls(calls, KEYS, evidenceFrom([], false), ctx).seguimiento).toMatchObject({ caso: "faltan_medidas", borrador: "¿Me puede medir el ancho?" });
    expect(parseLectorCalls(calls, KEYS, evidenceFrom([], false)).seguimiento).toBeNull();
  });
});
