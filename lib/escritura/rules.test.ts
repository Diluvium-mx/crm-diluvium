import { describe, expect, it } from "vitest";
import { VIGENCIA_LETRA_MS, esCajaAnimable, esSalto, nacimientos, renglonDeCajaUnica, tramos } from "./rules";

const caja = (etiqueta: string, tipo = "", extra: Partial<{ soloLectura: boolean; deshabilitada: boolean }> = {}) => ({
  etiqueta,
  tipo,
  soloLectura: false,
  deshabilitada: false,
  ...extra,
});
const VIEJA = Number.NEGATIVE_INFINITY;

describe("cursor y letras al escribir: qué cajas se animan", () => {
  it("textos de varios renglones y de un renglón, sí", () => {
    expect(esCajaAnimable(caja("TEXTAREA"))).toBe(true);
    expect(esCajaAnimable(caja("INPUT", "text"))).toBe(true);
    expect(esCajaAnimable(caja("INPUT", "tel"))).toBe(true);
    expect(esCajaAnimable(caja("INPUT", "url"))).toBe(true);
    expect(esCajaAnimable(caja("INPUT", "search"))).toBe(true);
  });

  it("contraseña, correo, número, fecha y casillas, no", () => {
    for (const tipo of ["password", "email", "number", "date", "time", "checkbox", "radio", "file", "range"]) {
      expect(esCajaAnimable(caja("INPUT", tipo))).toBe(false);
    }
    expect(esCajaAnimable(caja("SELECT"))).toBe(false);
  });

  it("de solo lectura o deshabilitadas, no", () => {
    expect(esCajaAnimable(caja("TEXTAREA", "", { soloLectura: true }))).toBe(false);
    expect(esCajaAnimable(caja("INPUT", "text", { deshabilitada: true }))).toBe(false);
  });
});

describe("cursor y letras al escribir: cuándo nació cada letra", () => {
  it("escribir al final: solo la letra nueva nace ahora", () => {
    expect(nacimientos("hol", "hola", [1, 2, 3], 10)).toEqual([1, 2, 3, 10]);
  });

  it("escribir en medio: lo de antes y lo de después conservan su hora", () => {
    expect(nacimientos("hla", "hola", [1, 2, 3], 10)).toEqual([1, 10, 2, 3]);
  });

  it("letras repetidas: la nueva es la última", () => {
    expect(nacimientos("aa", "aaa", [1, 2], 10)).toEqual([1, 2, 10]);
  });

  it("borrar: no nace nada y se van las horas de lo borrado", () => {
    expect(nacimientos("hola", "hoa", [1, 2, 3, 4], 10)).toEqual([1, 2, 4]);
  });

  it("pegar o insertar un mensaje rápido: todo lo insertado nace junto", () => {
    expect(nacimientos("hi", "h, buen día i", [1, 2], 10)).toEqual([1, ...Array(11).fill(10), 2]);
  });

  it("si las horas no cuadran con el texto, todo cuenta como viejo", () => {
    expect(nacimientos("abc", "abcd", [1], 10)).toEqual([VIEJA, VIEJA, VIEJA, 10]);
  });
});

describe("cursor y letras al escribir: tramos que se dibujan", () => {
  it("lo viejo va junto como texto normal; lo nuevo, con su edad", () => {
    const ahora = 1000;
    expect(tramos("hola", [VIEJA, VIEJA, VIEJA, ahora - 50], ahora)).toEqual([
      { texto: "hol", edad: null },
      { texto: "a", edad: 50 },
    ]);
  });

  it("letras nacidas al mismo tiempo (pegado) van en un solo tramo", () => {
    expect(tramos("abcd", [VIEJA, 900, 900, 950], 1000)).toEqual([
      { texto: "a", edad: null },
      { texto: "bc", edad: 100 },
      { texto: "d", edad: 50 },
    ]);
  });

  it("pasada la vigencia, la letra ya es texto normal", () => {
    expect(tramos("ab", [0, 0], VIGENCIA_LETRA_MS)).toEqual([{ texto: "ab", edad: null }]);
  });
});

describe("cursor y letras al escribir: cuándo se desliza el cursor", () => {
  it("al teclear en el mismo renglón va directo (no se queda atrás)", () => {
    expect(esSalto({ x: 100, y: 10 }, { x: 108, y: 10 })).toBe(false);
    expect(esSalto({ x: 108, y: 10 }, { x: 100, y: 10 })).toBe(false);
  });

  it("al cambiar de renglón o brincar lejos se desliza", () => {
    expect(esSalto({ x: 300, y: 10 }, { x: 12, y: 30 })).toBe(true);
    expect(esSalto({ x: 12, y: 10 }, { x: 300, y: 10 })).toBe(true);
  });

  it("la primera vez que aparece no se desliza desde ningún lado", () => {
    expect(esSalto(null, { x: 50, y: 10 })).toBe(false);
  });
});

describe("cursor y letras al escribir: renglón de las cajas de un renglón", () => {
  it("si el alto de renglón cabe, se usa tal cual", () => {
    expect(renglonDeCajaUnica("20px", 26)).toBe("20px");
  });

  it("si no cabe o es normal, el navegador usa el normal de la letra", () => {
    expect(renglonDeCajaUnica("20px", 16)).toBe("normal");
    expect(renglonDeCajaUnica("normal", 26)).toBe("normal");
  });
});
