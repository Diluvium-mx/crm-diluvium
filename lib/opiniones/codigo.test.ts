import { describe, expect, it } from "vitest";
import { nuevoCodigo, nuevoToken, prefijoCodigo, TOKEN_RE } from "./codigo";

describe("nuevoToken", () => {
  it("son 22 letras base64url y no se repiten", () => {
    const tokens = new Set(Array.from({ length: 200 }, nuevoToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(TOKEN_RE);
  });
});

describe("prefijoCodigo", () => {
  it("toma las 4 primeras letras del nombre, sin acentos ni espacios", () => {
    expect(prefijoCodigo("Diluvium")).toBe("DILU");
    expect(prefijoCodigo("Ñandú Compuertas")).toBe("NAND");
    expect(prefijoCodigo("A1 B")).toBe("AB");
  });

  it("sin letras usa REF", () => {
    expect(prefijoCodigo("123 —")).toBe("REF");
  });
});

describe("nuevoCodigo", () => {
  it("prefijo, guion y 4 letras sin 0/O ni 1/I/L", () => {
    for (let i = 0; i < 300; i++) {
      const c = nuevoCodigo("DILU");
      expect(c).toMatch(/^DILU-[2-9A-HJKMNP-Z]{4}$/);
    }
  });

  it("usa el azar que se le pasa", () => {
    expect(nuevoCodigo("DILU", () => 0)).toBe("DILU-2222");
  });
});
