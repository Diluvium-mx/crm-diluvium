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
