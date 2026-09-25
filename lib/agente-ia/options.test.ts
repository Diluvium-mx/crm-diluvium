import { describe, expect, it } from "vitest";
import { buildApiProviders, buildModelOptions } from "./options";
import { FIXED_PROFILE } from "./model-cost";

describe("buildApiProviders (panel APIs de IA)", () => {
  it("tres estados por proveedor y nunca el valor de la llave", () => {
    const view = buildApiProviders({ OPENAI_API_KEY: "sk-secreto", ANTHROPIC_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "g-secreto" });
    expect(view.map((p) => [p.id, p.state])).toEqual([
      ["openai", "conectada"],
      ["anthropic", "falta_llave"],
      // Google tiene llave pero el CRM aún no tiene su adaptador.
      ["google", "falta_soporte"],
      ["xai", "falta_soporte"],
      ["openrouter", "falta_soporte"],
    ]);
    expect(view.find((p) => p.id === "anthropic")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(JSON.stringify(view)).not.toContain("secreto");
  });
});

describe("buildModelOptions", () => {
  it("cada opción trae su costo aproximado (null sin precio) y el porqué si está deshabilitada", () => {
    const options = buildModelOptions("cerebro", { profile: FIXED_PROFILE, overrides: {} });
    const gemini = options.find((o) => o.id === "gemini-3.8-flash");
    expect(gemini?.costPer100Usd).toBeNull();
    expect(gemini?.available).toBe(false);
    expect(gemini?.disabledReason).toBe("Falta soporte en el CRM (llega con la parte (c) de Fase D)");
    const sonnet = options.find((o) => o.id === "claude-sonnet-5");
    expect(sonnet?.costPer100Usd).toBeGreaterThan(0);
  });
});
