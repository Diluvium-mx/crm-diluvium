import { describe, expect, it } from "vitest";
import { defaultStages, stagesInstructions, type FunnelStage } from "@/lib/contacts/stages";
import { buildBrainSystemWithRuntime } from "./brain";
import { buildLectorTools } from "./lector-core";
import { buildAgentTools, moverEtapaDescription } from "./tools";

// La columna temporal «Buen Fin» (4-nov-2026, dueño) no debe tocar nada de lo que el Agente IA tiene en caché:
// con ella o sin ella, las instrucciones, mover_etapa y el lector quedan idénticos a los de antes del 3-nov.
const sin = defaultStages();
const con: FunnelStage[] = [
  ...sin,
  { id: "x", key: "buen_fin", name: "Buen Fin", position: 6, color: "#DC2626", role: null, botRule: "", modelSlot: 1 },
];

describe("columna Buen Fin fuera del Agente IA", () => {
  it("las instrucciones del cerebro y la lista de etapas no cambian", () => {
    expect(stagesInstructions(con)).toBe(stagesInstructions(sin));
    expect(buildBrainSystemWithRuntime("Goal de prueba", [], con)).toBe(buildBrainSystemWithRuntime("Goal de prueba", [], sin));
    expect(stagesInstructions(con)).not.toContain("buen_fin");
  });

  it("mover_etapa no la ofrece", () => {
    expect(buildAgentTools([], con).stageKeys).toEqual(buildAgentTools([], sin).stageKeys);
    expect(moverEtapaDescription(con)).toBe(moverEtapaDescription(sin));
  });

  it("el lector tampoco la ve", () => {
    expect(buildLectorTools(con).stageKeys).toEqual(buildLectorTools(sin).stageKeys);
    expect(buildLectorTools(con).stageKeys).not.toContain("buen_fin");
  });
});
