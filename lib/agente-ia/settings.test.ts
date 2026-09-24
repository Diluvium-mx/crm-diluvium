import { describe, expect, it } from "vitest";
import { agentModeSchema, priceSchema, toAgentMode } from "./settings";

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
