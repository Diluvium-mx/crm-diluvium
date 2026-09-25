import { describe, expect, it } from "vitest";
import {
  CATALOG_IDS,
  DEFAULT_BRAIN_MODEL,
  DEFAULT_FILTER_MODEL,
  getModel,
  MODEL_CATALOG,
  modelsForRole,
} from "./catalog";
import { IMPLEMENTED_PROVIDERS, PROVIDER_META, modelAvailability } from "./provider";

describe("catálogo de modelos", () => {
  it("tiene ids únicos", () => {
    expect(new Set(CATALOG_IDS).size).toBe(CATALOG_IDS.length);
  });

  it("cada modelo tiene un proveedor conocido en PROVIDER_META", () => {
    for (const model of MODEL_CATALOG) {
      expect(PROVIDER_META[model.provider]).toBeDefined();
    }
  });

  it("cada modelo declara al menos un rol", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.roles.length).toBeGreaterThan(0);
    }
  });

  it("los defaults existen y corresponden a su rol", () => {
    const filtro = getModel(DEFAULT_FILTER_MODEL);
    const cerebro = getModel(DEFAULT_BRAIN_MODEL);
    expect(filtro?.roles).toContain("filtro");
    expect(cerebro?.roles).toContain("cerebro");
  });

  it("los defaults son de proveedores con adaptador (usables al poner la llave)", () => {
    expect(IMPLEMENTED_PROVIDERS).toContain(getModel(DEFAULT_FILTER_MODEL)?.provider);
    expect(IMPLEMENTED_PROVIDERS).toContain(getModel(DEFAULT_BRAIN_MODEL)?.provider);
  });

  it("filtro = Luna; cerebro incluye Sonnet 5 + las opciones del brief", () => {
    expect(modelsForRole("filtro").map((m) => m.id)).toEqual(["gpt-5.6-luna"]);
    const cerebro = modelsForRole("cerebro").map((m) => m.id);
    for (const id of [
      "claude-sonnet-5",
      "gpt-5.6-terra",
      "claude-haiku-4-5",
      "gemini-3.8-flash",
      "grok-4.6",
      "qwen-3.7-flash",
    ]) {
      expect(cerebro).toContain(id);
    }
  });

  it("Qwen 3.7 Flash está marcado multimodal (verificado)", () => {
    expect(getModel("qwen-3.7-flash")?.multimodal).toBe(true);
  });

  it("getModel devuelve undefined para un id desconocido", () => {
    expect(getModel("no-existe")).toBeUndefined();
  });
});

describe("modelAvailability", () => {
  it("proveedor con adaptador y llave presente → disponible", () => {
    const a = modelAvailability("claude-sonnet-5", { ANTHROPIC_API_KEY: "sk-test" });
    expect(a).toEqual({ available: true, reason: "ok", envKey: "ANTHROPIC_API_KEY" });
  });

  it("proveedor con adaptador pero sin llave → missing_key", () => {
    const a = modelAvailability("gpt-5.6-luna", {});
    expect(a.available).toBe(false);
    expect(a.reason).toBe("missing_key");
    expect(a.envKey).toBe("OPENAI_API_KEY");
  });

  it("Fase E: google/xai/openrouter ya tienen adaptador; disponibles con su llave y en gris sin ella", () => {
    expect(modelAvailability("qwen-3.7-flash", { QWEN_API_KEY: "sk-test" })).toEqual({ available: true, reason: "ok", envKey: "QWEN_API_KEY" });
    expect(modelAvailability("gemini-3.8-flash", {})).toEqual({ available: false, reason: "missing_key", envKey: "GEMINI_API_KEY" });
    expect(modelAvailability("grok-4.6", { GROK_API_KEY: "xai-test" }).available).toBe(true);
  });

  it("Fase E: Luna también es cerebro (Modelo 1); solo Qwen no lee PDF", () => {
    expect(getModel("gpt-5.6-luna")?.roles).toEqual(["filtro", "cerebro"]);
    expect(MODEL_CATALOG.filter((m) => !m.pdf).map((m) => m.id)).toEqual(["qwen-3.7-flash"]);
  });

  it("id desconocido → unknown_model", () => {
    const a = modelAvailability("no-existe", { OPENAI_API_KEY: "sk-test" });
    expect(a).toEqual({ available: false, reason: "unknown_model", envKey: null });
  });
});
