import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignLogoMotions, LOGO_MOTIONS, parseLogoMotions, type LogoMotions } from "./logo-motions";
import { MODEL_LOGO_IDS } from "./logos";

// Azar repetible para las pruebas (mulberry32).
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("movimientos de los logos", () => {
  it("hay más movimientos que marcas + 1 (así las dos reglas siempre se pueden cumplir)", () => {
    expect(LOGO_MOTIONS.length).toBeGreaterThan(MODEL_LOGO_IDS.length + 1);
  });

  it("cada marca recibe un movimiento y dos marcas nunca comparten", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const motions = assignLogoMotions({}, seeded(seed));
      expect(Object.keys(motions).sort()).toEqual([...MODEL_LOGO_IDS].sort());
      expect(new Set(Object.values(motions)).size).toBe(MODEL_LOGO_IDS.length);
    }
  });

  it("ninguna marca repite el movimiento de la vez anterior, recarga tras recarga", () => {
    const random = seeded(42);
    let previous: LogoMotions = {};
    for (let i = 0; i < 500; i++) {
      const next = assignLogoMotions(previous, random);
      for (const logo of MODEL_LOGO_IDS) {
        if (previous[logo]) expect(next[logo]).not.toBe(previous[logo]);
      }
      expect(new Set(Object.values(next)).size).toBe(MODEL_LOGO_IDS.length);
      previous = next;
    }
  });

  it("sí varía: en muchas recargas cada marca pasa por varios movimientos", () => {
    const random = seeded(7);
    const seen = new Map<string, Set<string>>();
    let previous: LogoMotions = {};
    for (let i = 0; i < 200; i++) {
      previous = assignLogoMotions(previous, random);
      for (const [logo, motion] of Object.entries(previous)) {
        seen.set(logo, (seen.get(logo) ?? new Set()).add(motion));
      }
    }
    for (const logo of MODEL_LOGO_IDS) expect(seen.get(logo)?.size).toBe(LOGO_MOTIONS.length);
  });

  it("lee lo guardado en el navegador e ignora lo que no sirve", () => {
    expect(parseLogoMotions(null)).toEqual({});
    expect(parseLogoMotions("{roto")).toEqual({});
    expect(parseLogoMotions("[1,2]")).toEqual({});
    expect(parseLogoMotions(JSON.stringify({ openai: "vuelta", claude: "bailar", mistral: "salto", grok: 3 }))).toEqual({ openai: "vuelta" });
  });

  it("cada movimiento tiene su regla en app/globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    for (const motion of LOGO_MOTIONS) expect(css).toContain(`[data-motion="${motion}"]`);
  });
});
