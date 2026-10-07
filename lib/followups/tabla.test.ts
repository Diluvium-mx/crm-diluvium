// Tabla editable de los seguimientos (Agente IA › Seguimientos, Parte 4): fábrica, validación, lo guardado
// y la lista de cambios. Sin base de datos.
import { describe, expect, it } from "vitest";
import { CASE_RULES } from "./cases";
import {
  EDITABLE_CASES,
  FACTORY_TABLE,
  lastStep,
  nextStep,
  tableChanges,
  tableFromInput,
  tableFromStored,
  tableProblems,
  tableToInput,
  tableToStored,
  type FollowUpTable,
} from "./tabla";

function edit(fn: (t: { casos: Record<string, { on: boolean; intentos: boolean[]; from: string; to: string; busca: string }>; vendedores: Record<string, { from: string; to: string } | null> }) => void) {
  const input = tableToInput(FACTORY_TABLE);
  fn(input as never);
  return input;
}

describe("fábrica", () => {
  it("es la tabla de siempre: hora e intentos de cases.ts, todos encendidos, vendedores lun–vie 9–18 y sáb 9–13", () => {
    for (const c of EDITABLE_CASES) {
      const s = FACTORY_TABLE.casos[c];
      expect(s.on).toBe(true);
      expect(s.intentos.filter(Boolean)).toHaveLength(CASE_RULES[c].total);
      expect({ from: s.from, to: s.to }).toEqual(CASE_RULES[c].slot);
      expect(s.busca.length).toBeGreaterThan(10);
    }
    expect(FACTORY_TABLE.casos.precio_sin_respuesta.intentos).toEqual([true, true, false]);
    expect(FACTORY_TABLE.casos.pago_pendiente.intentos).toEqual([true, true, true]);
    expect(FACTORY_TABLE.vendedores[1]).toEqual({ from: "09:00", to: "18:00" });
    expect(FACTORY_TABLE.vendedores[6]).toEqual({ from: "09:00", to: "13:00" });
    expect(FACTORY_TABLE.vendedores[7]).toBeNull();
    expect(EDITABLE_CASES).not.toContain("no_seguir");
  });

  it("guardada igual a la fábrica = null en las dos columnas (un cambio futuro de la fábrica sí llega)", () => {
    expect(tableToStored(FACTORY_TABLE)).toEqual({ casos: null, vendedores: null });
    expect(tableFromStored(null, null)).toEqual(FACTORY_TABLE);
  });
});

describe("validación (lo que se dice junto a cada control)", () => {
  it("la fábrica no tiene problemas", () => {
    expect(tableProblems(tableToInput(FACTORY_TABLE))).toEqual({});
  });

  it("hora fuera de 7–21, «hasta» antes de «desde», encendido sin intentos y «qué busca» vacío", () => {
    const input = edit((t) => {
      t.casos.pago_pendiente.from = "06:30";
      t.casos.objecion.from = "20:00";
      t.casos.objecion.to = "19:00";
      t.casos.faltan_medidas.intentos = [false, false, false];
      t.casos.sin_punto_claro.busca = "   ";
      t.vendedores["2"] = { from: "18:00", to: "09:00" };
    });
    expect(tableProblems(input)).toEqual({
      "pago_pendiente.from": "La hora va de 7:00 a 21:00 (hora del cliente).",
      "objecion.to": "«Hasta» debe ser después de «desde».",
      "faltan_medidas.intentos": "Prende al menos un intento o apaga el caso.",
      "sin_punto_claro.busca": "Escribe qué busca el mensaje.",
      "2.to": "La salida debe ser después de la entrada.",
    });
  });

  it("un caso apagado puede quedar sin intentos; «qué busca» se guarda en un renglón", () => {
    const input = edit((t) => {
      t.casos.precio_sin_respuesta.on = false;
      t.casos.precio_sin_respuesta.intentos = [false, false, false];
      t.casos.pago_pendiente.busca = "  El comprobante\n de pago.  ";
    });
    expect(tableProblems(input)).toEqual({});
    expect(tableFromInput(input).casos.pago_pendiente.busca).toBe("El comprobante de pago.");
  });
});

describe("lo guardado", () => {
  it("un caso que ya no valida vuelve al de fábrica; los demás se respetan; un día inválido, igual", () => {
    const t = tableFromStored(
      { pago_pendiente: { on: false, intentos: [true, false, false], from: "11:00", to: "12:00", busca: "Comprobante." }, objecion: { on: true, intentos: [true], from: "x" } },
      { "1": { from: "08:00", to: "17:00" }, "2": "basura", "7": { from: "10:00", to: "12:00" } },
    );
    expect(t.casos.pago_pendiente).toEqual({ on: false, intentos: [true, false, false], from: "11:00", to: "12:00", busca: "Comprobante." });
    expect(t.casos.objecion).toEqual(FACTORY_TABLE.casos.objecion);
    expect(t.vendedores[1]).toEqual({ from: "08:00", to: "17:00" });
    expect(t.vendedores[2]).toEqual(FACTORY_TABLE.vendedores[2]);
    expect(t.vendedores[7]).toEqual({ from: "10:00", to: "12:00" });
  });
});

describe("intentos", () => {
  const steps = (intentos: [boolean, boolean, boolean]): FollowUpTable => ({
    ...FACTORY_TABLE,
    casos: { ...FACTORY_TABLE.casos, cotizacion_sin_respuesta: { ...FACTORY_TABLE.casos.cotizacion_sin_respuesta, intentos } },
  });

  it("el siguiente prendido salta los apagados; el último prendido es el total", () => {
    const t = steps([false, true, true]);
    expect(nextStep(t, "cotizacion_sin_respuesta", 0)).toBe(2);
    expect(nextStep(t, "cotizacion_sin_respuesta", 2)).toBe(3);
    expect(nextStep(t, "cotizacion_sin_respuesta", 3)).toBeNull();
    expect(lastStep(t, "cotizacion_sin_respuesta")).toBe(3);
    const u = steps([true, false, true]);
    expect(nextStep(u, "cotizacion_sin_respuesta", 1)).toBe(3);
    expect(lastStep(steps([true, true, false]), "cotizacion_sin_respuesta")).toBe(2);
  });
});

describe("cambios (confirmación e Historial)", () => {
  it("una línea por dato, con el nombre del caso y antes → después", () => {
    const after = tableFromInput(
      edit((t) => {
        t.casos.faltan_medidas.intentos[2] = true;
        t.casos.precio_sin_respuesta.on = false;
        t.casos.pago_pendiente.from = "09:00";
        t.casos.sin_punto_claro.busca = "Otra cosa.";
        t.vendedores["7"] = { from: "10:00", to: "14:00" };
      }),
    );
    expect(tableChanges(FACTORY_TABLE, after)).toEqual([
      { title: "Pago pendiente · hora", before: "10:00–11:00", after: "09:00–11:00" },
      { title: "Faltan medidas · 3.er intento", before: "apagado", after: "prendido" },
      { title: "Precio sin respuesta", before: "encendido", after: "apagado" },
      { title: "Sin punto claro · qué busca", before: FACTORY_TABLE.casos.sin_punto_claro.busca, after: "Otra cosa." },
      { title: "Horario de los vendedores · Dom", before: "no trabaja", after: "10:00–14:00" },
    ]);
    expect(tableChanges(FACTORY_TABLE, tableFromInput(tableToInput(FACTORY_TABLE)))).toEqual([]);
  });
});
