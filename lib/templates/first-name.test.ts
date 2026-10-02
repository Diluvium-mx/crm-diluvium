import { describe, expect, it } from "vitest";
import { firstNameOf } from "./first-name";

describe("firstNameOf", () => {
  it("toma el primer nombre", () => {
    expect(firstNameOf("Ana María López")).toBe("Ana");
    expect(firstNameOf("  José   ")).toBe("José");
  });
  it("teléfono, vacío o sin letras: nada (lo escribe el vendedor)", () => {
    expect(firstNameOf("+52 668 123 4567")).toBe("");
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf(null)).toBe("");
    expect(firstNameOf("🙂")).toBe("");
  });
});
