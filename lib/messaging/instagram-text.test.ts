import { describe, expect, it } from "vitest";
import { INSTAGRAM_TEXT_MAX_BYTES, splitInstagramText, utf8Bytes } from "./instagram-text";

const fits = (parts: string[], max = INSTAGRAM_TEXT_MAX_BYTES) => parts.every((p) => utf8Bytes(p) <= max);
// Sin espacios, para comparar que no se perdió ni cambió nada al cortar.
const squash = (text: string) => text.replace(/\s+/g, "");

describe("splitInstagramText", () => {
  it("un texto que cabe sale en una sola parte, sin espacios en las orillas", () => {
    expect(splitInstagramText("  Hola, ¿qué medida tiene tu entrada?  ")).toEqual(["Hola, ¿qué medida tiene tu entrada?"]);
  });

  it("vacío = ninguna parte", () => {
    expect(splitInstagramText("   \n ")).toEqual([]);
  });

  it("cuenta BYTES, no caracteres: 600 «ñ» (1,200 bytes) no caben en una", () => {
    const text = "ñ".repeat(600);
    expect(text.length).toBeLessThan(INSTAGRAM_TEXT_MAX_BYTES);
    const parts = splitInstagramText(text);
    expect(parts.length).toBe(2);
    expect(fits(parts)).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  it("corta primero por párrafos", () => {
    const a = "Primer párrafo. ".repeat(30).trim();
    const b = "Segundo párrafo. ".repeat(30).trim();
    const parts = splitInstagramText(`${a}\n\n${b}`);
    expect(parts).toEqual([a, b]);
  });

  it("un párrafo largo se corta por oraciones, sin perder texto", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Esta es la oración número ${i + 1} sobre la compuerta.`).join(" ");
    const parts = splitInstagramText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(fits(parts)).toBe(true);
    expect(parts.every((p) => p.endsWith("."))).toBe(true);
    expect(squash(parts.join(""))).toBe(squash(text));
  });

  it("una palabra enorme se corta sin partir emojis", () => {
    const text = "🌊".repeat(300); // 4 bytes cada uno = 1,200 bytes
    const parts = splitInstagramText(text);
    expect(fits(parts)).toBe(true);
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
  });

  it("respeta el máximo que se le pase", () => {
    const parts = splitInstagramText("uno dos tres cuatro cinco seis", 10);
    expect(fits(parts, 10)).toBe(true);
    expect(parts.join(" ")).toBe("uno dos tres cuatro cinco seis");
  });
});
