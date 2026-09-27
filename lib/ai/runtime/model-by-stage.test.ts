import { describe, expect, it } from "vitest";
import { brainCandidates, brainModelForStage, DEFAULT_MODEL_1_STAGES, handoffStage, impliedStage, normalizeModel1Stages } from "./model-by-stage";

const cfg = { modelo1: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", etapasModelo1: [...DEFAULT_MODEL_1_STAGES] };
const all = () => true;

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
});

describe("respaldo entre modelos (27-sep-2026)", () => {
  it("primero el de la etapa y, si falla, el otro", () => {
    expect(brainCandidates(cfg, "inbox", all)).toEqual([
      { modelId: "gpt-5.6-luna", slot: 1 },
      { modelId: "claude-sonnet-5", slot: 2 },
    ]);
    expect(brainCandidates(cfg, "compra", all)).toEqual([
      { modelId: "claude-sonnet-5", slot: 2 },
      { modelId: "gpt-5.6-luna", slot: 1 },
    ]);
  });

  it("un modelo sin llave se salta (nunca se queda callado por una llave faltante), en los dos sentidos", () => {
    expect(brainCandidates(cfg, "inbox", (id) => id !== "gpt-5.6-luna")).toEqual([{ modelId: "claude-sonnet-5", slot: 2 }]);
    expect(brainCandidates(cfg, "compra", (id) => id !== "claude-sonnet-5")).toEqual([{ modelId: "gpt-5.6-luna", slot: 1 }]);
  });

  it("ninguno disponible → el de la etapa (su falla explica qué llave falta); el mismo modelo en los dos espacios cuenta una vez", () => {
    expect(brainCandidates(cfg, "compra", () => false)).toEqual([{ modelId: "claude-sonnet-5", slot: 2 }]);
    expect(brainCandidates({ ...cfg, modelo1: "claude-sonnet-5" }, "inbox", all)).toEqual([{ modelId: "claude-sonnet-5", slot: 1 }]);
  });
});

describe("traspaso del Modelo 1 al Modelo 2 (27-sep-2026)", () => {
  it("la etapa implícita: mover_etapa o el workflow de datos bancarios (→ Cerca de compra); la más adelantada gana", () => {
    expect(impliedStage([])).toBeNull();
    expect(impliedStage([{ kind: "workflow", slug: "tabla_tamanos_estandar" }])).toBeNull();
    expect(impliedStage([{ kind: "workflow", slug: "datos_bancarios" }])).toBe("cerca_compra");
    expect(impliedStage([{ kind: "etapa", etapa: "compra" }, { kind: "workflow", slug: "datos_bancarios" }])).toBe("compra");
    expect(impliedStage([{ kind: "etapa", etapa: "prospecto" }, { kind: "etapa", etapa: "interesado" }])).toBe("interesado");
  });

  it("de una etapa del Modelo 1 a una del Modelo 2 → traspaso, aunque se salte etapas", () => {
    expect(handoffStage(cfg, "interesado", "cerca_compra")).toBe("cerca_compra");
    expect(handoffStage(cfg, "inbox", "compra")).toBe("compra");
    expect(handoffStage(cfg, null, "cerca_compra")).toBeNull(); // sin etapa ya contesta el Modelo 2
  });

  it("sin traspaso: se queda en etapas del Modelo 1, no avanza, ya estaba en el Modelo 2 o es el mismo modelo", () => {
    expect(handoffStage(cfg, "inbox", "interesado")).toBeNull();
    expect(handoffStage(cfg, "interesado", null)).toBeNull();
    expect(handoffStage(cfg, "cerca_compra", "compra")).toBeNull();
    expect(handoffStage({ ...cfg, etapasModelo1: ["inbox", "prospecto", "interesado", "cerca_compra", "compra"] }, "inbox", "compra")).toBeNull();
    expect(handoffStage({ ...cfg, modeloCerebro: "gpt-5.6-luna" }, "inbox", "compra")).toBeNull();
  });
});
