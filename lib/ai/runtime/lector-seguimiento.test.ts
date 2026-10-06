// La ficha de seguimiento dentro de la MISMA lectura del lector (docs/seguimientos.md §5): solo
// cuando el último mensaje del chat es de la empresa; sin llamada extra al modelo.
import { describe, expect, it } from "vitest";
import { defaultStages } from "@/lib/contacts/stages";
import { buildLectorSystem, buildLectorTools, evidenceFrom, FOLLOW_UP_INSTRUCTIONS, lastIsCompany, LECTOR_TOOL, lectorSchemaFor, parseLectorCalls, type LectorMessage } from "./lector-core";

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
