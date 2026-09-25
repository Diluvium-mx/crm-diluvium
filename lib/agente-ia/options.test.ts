import { describe, expect, it } from "vitest";
import { buildApiProviders, buildModelOptions } from "./options";
import { FIXED_PROFILE } from "./model-cost";

describe("buildApiProviders (panel APIs de IA)", () => {
  it("tres estados por proveedor y nunca el valor de la llave", () => {
    const view = buildApiProviders({ OPENAI_API_KEY: "sk-secreto", ANTHROPIC_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "g-secreto" });
    expect(view.map((p) => [p.id, p.state])).toEqual([
      ["openai", "conectada"],
      ["anthropic", "falta_llave"],
      // Fase E: los cinco tienen adaptador; sin llave → falta_llave.
      ["google", "conectada"],
      ["xai", "falta_llave"],
      ["openrouter", "falta_llave"],
    ]);
    expect(view.find((p) => p.id === "anthropic")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(JSON.stringify(view)).not.toContain("secreto");
  });
});

describe("buildModelOptions", () => {
  it("cada opción trae su costo aproximado y el porqué si está deshabilitada; Luna está entre las opciones", () => {
    const options = buildModelOptions("cerebro", { profile: FIXED_PROFILE, overrides: {} });
    const gemini = options.find((o) => o.id === "gemini-3.8-flash");
    expect(gemini?.costPer100Usd).toBeGreaterThan(0);
    const sonnet = options.find((o) => o.id === "claude-sonnet-5");
    expect(sonnet?.costPer100Usd).toBeGreaterThan(0);
    expect(options.some((o) => o.id === "gpt-5.6-luna")).toBe(true);
    for (const o of options) {
      if (!o.available) expect(o.disabledReason).toMatch(/^Falta la llave [A-Z_]+ en Railway$/);
    }
  });

  it("'Recomendado' según el selector: Sonnet 5 en el Modelo 2 y Luna en el Modelo 1", () => {
    const m2 = buildModelOptions("cerebro", { profile: FIXED_PROFILE, overrides: {} });
    const m1 = buildModelOptions("cerebro", { profile: FIXED_PROFILE, overrides: {} }, "gpt-5.6-luna");
    expect(m2.filter((o) => o.recommended).map((o) => o.id)).toEqual(["claude-sonnet-5"]);
    expect(m1.filter((o) => o.recommended).map((o) => o.id)).toEqual(["gpt-5.6-luna"]);
  });
});
