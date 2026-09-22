import { describe, expect, it } from "vitest";
import { canonicalPhone, countryFromPhone, nationalSearchPrefixes, normalizePhone, phoneLookupVariants, phoneParts } from "./phone";

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

describe("regla de México y partes por país (libphonenumber-js)", () => {
  it.each(["+5216682426364", "5216682426364".replace(/^/, "+"), "+52 1 668 242 6364", "0052 1 668 242 6364"])(
    "el 521 heredado de WhatsApp se guarda como +52 + 10 dígitos: %s",
    (raw) => expect(normalizePhone(raw)).toBe("+526682426364"),
  );

  it("nunca produce +521", () => {
    for (const raw of ["+5216682426364", "+526682426364", "+52 668 242 6364"]) {
      expect(normalizePhone(raw).startsWith("+521")).toBe(false);
    }
  });

  it.each([
    ["+526682426364", "52", "6682426364", "MX"],
    ["+14155550123", "1", "4155550123", "US"],
    ["+34612345678", "34", "612345678", "ES"],
    ["+573001234567", "57", "3001234567", "CO"],
    ["+50255123456", "502", "55123456", "GT"],
    ["+5491123456789", "54", "91123456789", "AR"],
  ])("partes de %s", (e164, code, national, iso) => {
    expect(phoneParts(e164)).toEqual({ phoneCountryCode: code, phoneNational: national, phoneCountryIso: iso });
  });

  it("conserva un número que libphonenumber no reconoce (Brasil viejo) sin rechazarlo", () => {
    expect(normalizePhone("+551112345678")).toBe("+551112345678");
  });

  it("sin teléfono no hay partes", () => {
    expect(phoneParts(null)).toEqual({ phoneCountryCode: null, phoneNational: null, phoneCountryIso: null });
  });

  it("país en el estilo de GHL (inglés)", () => {
    expect(countryFromPhone("+526682426364")).toBe("Mexico");
    expect(countryFromPhone(null)).toBeNull();
  });

  it("la búsqueda acepta los 10 dígitos solos, con 52, +52 o el 521 heredado", () => {
    for (const term of ["6682426364", "526682426364", "+52 668 242 6364", "5216682426364"]) {
      expect(nationalSearchPrefixes(term)).toContain("6682426364");
    }
    expect(nationalSearchPrefixes("66")).toEqual([]);
  });
});
