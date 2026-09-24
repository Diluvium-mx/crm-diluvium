import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOWS, toolNameFor } from "./defaults";
import { commandSchema, keywordsSchema, stepsSchema } from "./steps";

describe("DEFAULT_WORKFLOWS", () => {
  it("slugs y comandos únicos, pasos y palabras clave válidos", () => {
    const slugs = DEFAULT_WORKFLOWS.map((w) => w.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const commands = DEFAULT_WORKFLOWS.map((w) => w.triggerCommand).filter(Boolean);
    expect(new Set(commands).size).toBe(commands.length);
    for (const w of DEFAULT_WORKFLOWS) {
      expect(() => stepsSchema.parse(w.steps)).not.toThrow();
      expect(() => keywordsSchema.parse(w.triggerKeywords)).not.toThrow();
      expect(() => commandSchema.parse(w.triggerCommand)).not.toThrow();
      expect(w.agentDescription.length).toBeGreaterThan(40);
      expect(toolNameFor(w.slug)).toMatch(/^wf_[a-z_]+$/);
    }
  });
  it("textos y palabras clave iguales a GHL (auditoría 24-sep-2026)", () => {
    const by = (slug: string) => DEFAULT_WORKFLOWS.find((w) => w.slug === slug)!;
    expect(by("tabla_tamanos_estandar").steps[0]).toEqual({ kind: "wait", seconds: 30 });
    expect(by("tabla_tamanos_estandar").steps[1]).toMatchObject({ text: "Aquí le comparto una foto de los tamaños estándar disponibles para envío inmediato 🙌" });
    expect(by("tabla_tamanos_estandar").triggerKeywords).toEqual(["tamaños", "medidas", "tallas", "que tamaño son", "que medidas hay", "cuales son las medidas"]);
    expect(by("datos_bancarios").steps[0]).toMatchObject({ text: "Aquí le paso nuestros datos bancarios ✅" });
    expect(by("datos_bancarios").triggerKeywords).toEqual([]);
    expect(by("video_instalacion_estandar").triggerKeywords).toContain("ponen");
    expect(by("video_instalacion_medida").triggerKeywords).toContain("portón");
    expect(by("tapones_inflables").triggerKeywords).toEqual(["tapones", "tapones inflables"]);
    expect(by("tapones_inflables").steps.map((st) => st.kind)).toEqual(["send_text", "send_text", "send_media"]);
    for (const slug of ["tabla_tamanos_mini", "donde_medir", "medidas_especiales"]) expect(by(slug).triggerKeywords).toEqual([]);
    for (const w of DEFAULT_WORKFLOWS) expect(w.agentDescription).not.toMatch(/ya se envió/i);
  });
  it("respeta el Goal: nunca 'talla', precios solo de la base", () => {
    for (const w of DEFAULT_WORKFLOWS) {
      for (const st of w.steps) {
        if (st.kind !== "send_text") continue;
        expect(st.text.toLowerCase()).not.toContain("talla");
        for (const amount of st.text.match(/\$[\d,]+/g) ?? []) {
          expect(["$5,500", "$7,000", "$3,000", "$749", "$799", "$849", "$3,500", "$11,000"]).toContain(amount);
        }
      }
    }
  });
});
