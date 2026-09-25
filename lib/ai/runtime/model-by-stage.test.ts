import { describe, expect, it } from "vitest";
import { brainModelForStage, DEFAULT_MODEL_1_STAGES, normalizeModel1Stages, pickBrainModel } from "./model-by-stage";

const cfg = { modelo1: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", etapasModelo1: [...DEFAULT_MODEL_1_STAGES] };

describe("modelo por etapa (Fase E)", () => {
  it("Inbox, Prospecto e Interesado → Modelo 1; Cerca de compra y Compra → Modelo 2", () => {
    for (const s of ["inbox", "prospecto", "interesado"]) expect(brainModelForStage(cfg, s)).toEqual({ modelId: "gpt-5.6-luna", slot: 1 });
    for (const s of ["cerca_compra", "compra"]) expect(brainModelForStage(cfg, s)).toEqual({ modelId: "claude-sonnet-5", slot: 2 });
  });

  it("sin etapa o con una etapa desconocida → Modelo 2", () => {
    expect(brainModelForStage(cfg, null).slot).toBe(2);
    expect(brainModelForStage(cfg, "perdido").slot).toBe(2);
  });

  it("respeta lo elegido en la pestaña (p. ej. Modelo 1 también en Compra)", () => {
    expect(brainModelForStage({ ...cfg, etapasModelo1: ["compra"] }, "compra").slot).toBe(1);
    expect(brainModelForStage({ ...cfg, etapasModelo1: [] }, "inbox").slot).toBe(2);
  });

  it("normaliza: solo etapas reales, sin repetir, en el orden del Embudo", () => {
    expect(normalizeModel1Stages(["interesado", "inbox", "inbox", "otra"])).toEqual(["inbox", "interesado"]);
  });

  it("sin llave del Modelo 1 en este entorno contesta el Modelo 2 (nunca se queda callado)", () => {
    expect(pickBrainModel(cfg, "inbox", () => true)).toEqual({ modelId: "gpt-5.6-luna", slot: 1, fallback: false });
    expect(pickBrainModel(cfg, "inbox", (id) => id !== "gpt-5.6-luna")).toEqual({ modelId: "claude-sonnet-5", slot: 2, fallback: true });
    // El Modelo 2 no tiene respaldo: si falta su llave, la llamada falla y la cola reintenta.
    expect(pickBrainModel(cfg, "compra", () => false)).toEqual({ modelId: "claude-sonnet-5", slot: 2, fallback: false });
  });
});
