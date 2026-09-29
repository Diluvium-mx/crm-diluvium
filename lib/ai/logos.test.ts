import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./catalog";
import { MODEL_LOGOS } from "./logos";

const publicFile = (src: string) => join(process.cwd(), "public", src);

describe("logos de los modelos", () => {
  it("cada logo apunta a un SVG que existe en public/logos-ia/ y no trae código", () => {
    for (const logo of Object.values(MODEL_LOGOS)) {
      expect(logo.src).toMatch(/^\/logos-ia\/[a-z]+\.svg$/);
      expect(existsSync(publicFile(logo.src))).toBe(true);
      expect(readFileSync(publicFile(logo.src), "utf8")).not.toMatch(/<script|on[a-z]+=|href=/i);
    }
  });

  it("cada modelo del catálogo tiene logo; Qwen lleva el de Qwen aunque vaya por OpenRouter", () => {
    for (const model of MODEL_CATALOG) {
      expect(MODEL_LOGOS[model.logo]).toBeDefined();
    }
    expect(MODEL_CATALOG.find((m) => m.id === "qwen-3.7-flash")?.logo).toBe("qwen");
  });
});
