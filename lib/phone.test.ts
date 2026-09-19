import { describe, expect, it } from "vitest";
import { canonicalPhone, normalizePhone, phoneLookupVariants } from "./phone";

describe("normalizePhone", () => {
  it.each(["+525512345678", "+12345678", "+123456789012345"])(
    "conserva E.164 válido, incluidos los límites de longitud: %s",
    (phone) => expect(normalizePhone(phone)).toBe(phone),
  );

  it("convierte el prefijo 00 en +", () => {
    expect(normalizePhone("00525512345678")).toBe("+525512345678");
  });

  it("limpia espacios, paréntesis, guiones y puntos", () => {
    expect(normalizePhone("  +52 (55) 1234-56.78  ")).toBe("+525512345678");
  });

  it("combina el prefijo 00 con la limpieza de separadores", () => {
    expect(normalizePhone("  0052 (55) 1234-56.78  ")).toBe("+525512345678");
  });

  it.each([
    ["sin +", "525512345678"],
    ["demasiado corto", "+1234567"],
    ["demasiado largo", "+1234567890123456"],
    ["cero después de +", "+025512345678"],
    ["vacío", ""],
    ["solo espacios", "   "],
    ["con letras", "+52551234abcd"],
  ])("rechaza un teléfono %s", (_description, phone) => {
    expect(() => normalizePhone(phone)).toThrow(Error);
  });
});

describe("canonicalPhone / phoneLookupVariants (México 52 vs 521)", () => {
  it("quita el 1 heredado de los celulares mexicanos", () => {
    expect(canonicalPhone("+5216682419579")).toBe("+526682419579");
    expect(canonicalPhone("+526682419579")).toBe("+526682419579");
  });

  it("busca ambas formas para no duplicar al cliente", () => {
    expect(phoneLookupVariants("+5216682419579")).toEqual(["+526682419579", "+5216682419579"]);
    expect(phoneLookupVariants("+526682419579")).toEqual(["+526682419579", "+5216682419579"]);
  });

  it("no toca números de otros países ni fijos mexicanos con otra longitud", () => {
    expect(phoneLookupVariants("+14155550123")).toEqual(["+14155550123"]);
    expect(canonicalPhone("+5215512345")).toBe("+5215512345");
  });
});
