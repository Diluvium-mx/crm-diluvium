import { describe, expect, it } from "vitest";
import { phoneFromForm } from "./manual-phone";

describe("phoneFromForm", () => {
  it("10 dígitos = México, con espacios, guiones o paréntesis", () => {
    expect(phoneFromForm("668 123 4567")).toBe("+526681234567");
    expect(phoneFromForm("(668) 123-45-67")).toBe("+526681234567");
  });

  it("con lada de país, con o sin +, y el viejo 521", () => {
    expect(phoneFromForm("+52 668 123 4567")).toBe("+526681234567");
    expect(phoneFromForm("52 668 123 4567")).toBe("+526681234567");
    expect(phoneFromForm("521 668 123 4567")).toBe("+526681234567");
    expect(phoneFromForm("+1 202 555 0147")).toBe("+12025550147");
  });

  it("vacío o incompleto: avisa qué escribir", () => {
    expect(() => phoneFromForm("  ")).toThrow(/obligatorio/);
    expect(() => phoneFromForm("668 123")).toThrow(/10 dígitos/);
  });
});
