import { describe, expect, it } from "vitest";
import { defaultStages, type FunnelStage } from "@/lib/contacts/stages";
import { brainCandidates, brainModelForStage, handoffStage, impliedStage, slotForStage, type ModelConfig } from "./model-by-stage";

// Las 5 de siempre: Modelo 1 en Inbox, Prospecto e Interesado (como producción hoy).
const stages = defaultStages();
const cfg: ModelConfig = { modelo1: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", stages };
const all = () => true;
const withSlots = (m1: readonly string[]): FunnelStage[] => stages.map((s) => ({ ...s, modelSlot: m1.includes(s.key) ? 1 : 2 }));

describe("modelo por etapa (Fase E; el modelo de cada etapa vive en funnel_stages.model_slot)", () => {
  it("Inbox, Prospecto e Interesado → Modelo 1; Cerca de compra y Compra → Modelo 2", () => {
    for (const s of ["inbox", "prospecto", "interesado"]) expect(brainModelForStage(cfg, s)).toEqual({ modelId: "gpt-5.6-luna", slot: 1 });
    for (const s of ["cerca_compra", "compra"]) expect(brainModelForStage(cfg, s)).toEqual({ modelId: "claude-sonnet-5", slot: 2 });
  });

  it("sin etapa o con una clave que ya no existe (columna borrada) → Modelo 2", () => {
    expect(brainModelForStage(cfg, null).slot).toBe(2);
    expect(brainModelForStage(cfg, "perdido").slot).toBe(2);
    expect(slotForStage([], "inbox")).toBe(2);
  });

  it("respeta lo elegido en el editor (Modelo 1 también en Compra; una etapa nueva con Modelo 1)", () => {
    expect(brainModelForStage({ ...cfg, stages: withSlots(["compra"]) }, "compra").slot).toBe(1);
    expect(brainModelForStage({ ...cfg, stages: withSlots([]) }, "inbox").slot).toBe(2);
    const nueva = [...stages, { id: "n", key: "seguimiento", name: "Seguimiento", position: 6, color: "#000000", role: null, botRule: "", modelSlot: 1 as const }];
    expect(brainModelForStage({ ...cfg, stages: nueva }, "seguimiento").slot).toBe(1);
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
  it("la etapa implícita: mover_etapa o el workflow de datos bancarios (→ la etapa con papel Cerca de compra); la más adelantada gana", () => {
    expect(impliedStage(stages, [])).toBeNull();
    expect(impliedStage(stages, [{ kind: "workflow", slug: "tabla_tamanos_estandar" }])).toBeNull();
    expect(impliedStage(stages, [{ kind: "workflow", slug: "datos_bancarios" }])).toBe("cerca_compra");
    expect(impliedStage(stages, [{ kind: "etapa", etapa: "compra" }, { kind: "workflow", slug: "datos_bancarios" }])).toBe("compra");
    expect(impliedStage(stages, [{ kind: "etapa", etapa: "prospecto" }, { kind: "etapa", etapa: "interesado" }])).toBe("interesado");
    expect(impliedStage(stages, [{ kind: "etapa", etapa: "ganado" }])).toBeNull();
  });

  it("datos bancarios sigue al PAPEL: si 'Cerca de compra' pasa a otra columna, el traspaso apunta a esa", () => {
    const moved = [
      ...stages.map((s) => (s.key === "cerca_compra" ? { ...s, role: null } : s)),
      { id: "n", key: "esperando_pago", name: "Esperando pago", position: 6, color: "#000000", role: "cerca_compra" as const, botRule: "", modelSlot: 2 as const },
    ];
    expect(impliedStage(moved, [{ kind: "workflow", slug: "datos_bancarios" }])).toBe("esperando_pago");
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
    expect(handoffStage({ ...cfg, stages: withSlots(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]) }, "inbox", "compra")).toBeNull();
    expect(handoffStage({ ...cfg, modeloCerebro: "gpt-5.6-luna" }, "inbox", "compra")).toBeNull();
  });

  it("'solo hacia adelante' sigue el orden ACTUAL: reordenado, un 'retroceso' ya no es traspaso", () => {
    const reordered = stages.map((s) => ({ ...s, position: s.key === "cerca_compra" ? 2 : s.key === "prospecto" ? 4 : s.position }));
    expect(handoffStage({ ...cfg, stages: reordered }, "prospecto", "cerca_compra")).toBeNull();
    expect(handoffStage({ ...cfg, stages: reordered }, "inbox", "cerca_compra")).toBe("cerca_compra");
  });
});
