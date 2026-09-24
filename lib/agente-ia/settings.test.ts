import { describe, expect, it } from "vitest";
import { agentModeSchema, toAgentMode } from "./settings";

describe("agentModeSchema", () => {
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
});
