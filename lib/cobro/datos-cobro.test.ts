import { describe, expect, it } from "vitest";
import { clabeChecksumOk, clabeMasked, datosCobroSchema } from "./datos-cobro";

describe("CLABE", () => {
  it("acepta una CLABE con dígito verificador válido y rechaza una con un dígito cambiado", () => {
    // 002010077777777771: ejemplo público de Banamex con verificador correcto.
    expect(clabeChecksumOk("002010077777777771")).toBe(true);
    expect(clabeChecksumOk("002010077777777772")).toBe(false);
    expect(clabeChecksumOk("00201007777777777")).toBe(false);
    expect(clabeChecksumOk("abc")).toBe(false);
  });
  it("el formulario acepta CLABE vacía o válida (con espacios) y rechaza una inválida", () => {
    expect(datosCobroSchema.parse({ banco: "BBVA", beneficiario: "Diluvium", clabe: "", cuenta: "", concepto: "", notas: "" }).clabe).toBe("");
    expect(datosCobroSchema.parse({ banco: "", beneficiario: "", clabe: "0020 1007 7777 7777 71", cuenta: "", concepto: "", notas: "" }).clabe).toBe("002010077777777771");
    expect(() => datosCobroSchema.parse({ banco: "", beneficiario: "", clabe: "002010077777777772", cuenta: "", concepto: "", notas: "" })).toThrow(/CLABE/);
  });
  it("enmascara la CLABE dejando solo los últimos 4", () => {
    expect(clabeMasked("002010077777777771")).toBe("•••• 7771");
    expect(clabeMasked("")).toBe("");
  });
});
