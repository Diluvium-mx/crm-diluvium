import { describe, expect, it } from "vitest";
import { agentSettingsSchema, agentModeSchema, priceSchema, toAgentMode } from "./settings";

const ok = {
  responseDelaySeconds: 15,
  maxWaitSeconds: 60,
  pauseOnHumanReply: true,
  antiLoopMaxPerHour: 30,
  maxRepliesPerContact: null,
  contextMessages: 20,
  maxBubbles: 2,
  dailyBudgetUsd: 20,
};

describe("agentSettingsSchema", () => {
  it("acepta los valores por defecto (config de Angela en GHL + mejoras)", () => {
    expect(agentSettingsSchema.parse(ok)).toEqual(ok);
  });
  it("sin tope por contacto = null; con tope, entero ≥ 1", () => {
    expect(agentSettingsSchema.safeParse({ ...ok, maxRepliesPerContact: 50 }).success).toBe(true);
    expect(agentSettingsSchema.safeParse({ ...ok, maxRepliesPerContact: 0 }).success).toBe(false);
  });
  it("la espera máxima no puede ser menor que la espera antes de responder", () => {
    const r = agentSettingsSchema.safeParse({ ...ok, responseDelaySeconds: 90, maxWaitSeconds: 60 });
    expect(r.success).toBe(false);
  });
  it("rechaza fuera de rango (burbujas, contexto, anti-bucle, espera, presupuesto)", () => {
    for (const bad of [
      { maxBubbles: 0 },
      { maxBubbles: 6 },
      { contextMessages: 51 },
      { antiLoopMaxPerHour: 0 },
      { responseDelaySeconds: 1.5 },
      { dailyBudgetUsd: 0 },
      { dailyBudgetUsd: 1_001 },
    ]) {
      expect(agentSettingsSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});

describe("agentModeSchema / priceSchema", () => {
  it("solo Apagado (off) | Encendido (auto): ya no hay modo borrador", () => {
    expect(agentModeSchema.safeParse("auto").success).toBe(true);
    expect(agentModeSchema.safeParse("off").success).toBe(true);
    expect(agentModeSchema.safeParse("borrador").success).toBe(false);
    expect(agentModeSchema.safeParse("on").success).toBe(false);
  });
  it("un canal viejo en borrador se muestra como apagado", () => {
    expect(toAgentMode("borrador")).toBe("off");
    expect(toAgentMode("auto")).toBe("auto");
  });
  it("precios no negativos", () => {
    expect(priceSchema.safeParse({ modelId: "x", inputPerMTok: 0.2, outputPerMTok: 1.2 }).success).toBe(true);
    expect(priceSchema.safeParse({ modelId: "x", inputPerMTok: -1, outputPerMTok: 1 }).success).toBe(false);
  });
});
