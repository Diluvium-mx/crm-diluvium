import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_KEYS,
  defaultStages,
  furthestStage,
  isForward,
  isStageKey,
  roleKey,
  stageKeyFromName,
  stagesInstructions,
  validateStageSet,
  type FunnelStage,
} from "./stages";

const stages = defaultStages();

describe("etapas del Embudo (puro)", () => {
  it("las 5 de siempre, en orden, con sus papeles", () => {
    expect(DEFAULT_STAGE_KEYS).toEqual(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]);
    expect(roleKey(stages, "entrada")).toBe("inbox");
    expect(roleKey(stages, "cerca_compra")).toBe("cerca_compra");
    expect(roleKey(stages, "venta_cerrada")).toBe("compra");
    expect(validateStageSet(stages)).toEqual([]);
  });

  it("solo hacia adelante según el ORDEN actual (no según la clave)", () => {
    expect(isForward(stages, "inbox", "prospecto")).toBe(true);
    expect(isForward(stages, "interesado", "compra")).toBe(true);
    expect(isForward(stages, "compra", "cerca_compra")).toBe(false);
    expect(isForward(stages, "interesado", "interesado")).toBe(false);
    // Reordenado: Compra antes de Cerca de compra → ahora "compra → cerca_compra" es adelante.
    const reordered = stages.map((s) => ({ ...s, position: s.key === "compra" ? 4 : s.key === "cerca_compra" ? 5 : s.position }));
    expect(isForward(reordered, "compra", "cerca_compra")).toBe(true);
    expect(isForward(reordered, "cerca_compra", "compra")).toBe(false);
    // Una clave que ya no existe nunca es "adelante".
    expect(isForward(stages, "inbox", "ganado")).toBe(false);
    expect(isStageKey(stages, "compra")).toBe(true);
    expect(isStageKey(stages, "ganado")).toBe(false);
  });

  it("varias mover_etapa en una respuesta: gana la más adelantada; claves desconocidas se ignoran", () => {
    expect(furthestStage(stages, ["prospecto", "compra", "interesado"])).toBe("compra");
    expect(furthestStage(stages, ["ganado"])).toBeNull();
    expect(furthestStage(stages, ["ganado", "prospecto"])).toBe("prospecto");
  });

  it("clave estable a partir del nombre, sin acentos y única", () => {
    expect(stageKeyFromName("Cerca de compra", [])).toBe("cerca_de_compra");
    expect(stageKeyFromName("Cotización enviada", [])).toBe("cotizacion_enviada");
    expect(stageKeyFromName("Inbox", ["inbox"])).toBe("inbox_2");
    expect(stageKeyFromName("Inbox", ["inbox", "inbox_2"])).toBe("inbox_3");
    expect(stageKeyFromName("  ¡¡¡  ", [])).toBe("etapa");
  });

  it("el juego completo: entre 3 y 10, cada papel en exactamente una etapa, sin nombres repetidos", () => {
    expect(validateStageSet(stages.slice(0, 2))).toContain("El Embudo necesita al menos 3 etapas.");
    const many: FunnelStage[] = [...stages, ...Array.from({ length: 6 }, (_, i) => ({ ...stages[1], id: `x${i}`, key: `x${i}`, name: `X${i}`, role: null }))];
    expect(validateStageSet(many)).toContain("El Embudo no puede tener más de 10 etapas.");
    const noEntry = stages.map((s) => ({ ...s, role: s.role === "entrada" ? null : s.role }));
    expect(validateStageSet(noEntry).some((e) => e.includes("Entrada"))).toBe(true);
    const twoWon = stages.map((s) => ({ ...s, role: s.key === "prospecto" ? ("venta_cerrada" as const) : s.role }));
    expect(validateStageSet(twoWon).some((e) => e.includes("Venta cerrada") && e.includes("hay 2"))).toBe(true);
    const dupName = stages.map((s) => ({ ...s, name: s.key === "prospecto" ? "compra" : s.name }));
    expect(validateStageSet(dupName)).toContain('Ya hay una etapa llamada "Compra".');
  });

  it("el bloque para el agente lleva las etapas vigentes en orden, con clave, nombre y regla", () => {
    const withNew = [...stages, { id: "n", key: "seguimiento", name: "Seguimiento", position: 6, color: "#000000", role: null, botRule: "Cuando pide que le escriban después.", modelSlot: 1 as const }];
    const text = stagesInstructions(withNew);
    expect(text).toContain("ETAPAS DEL EMBUDO");
    expect(text).toContain("1. inbox — \"Inbox\" (aquí llegan los contactos nuevos)");
    expect(text).toContain("2. prospecto — \"Prospecto\": Cuando el cliente contesta por primera vez.");
    expect(text).toContain("6. seguimiento — \"Seguimiento\": Cuando pide que le escriban después.");
    // Renombrar cambia el nombre en el bloque sin tocar la clave.
    const renamed = stages.map((s) => (s.key === "compra" ? { ...s, name: "Venta cerrada" } : s));
    expect(stagesInstructions(renamed)).toContain("5. compra — \"Venta cerrada\"");
  });
});
