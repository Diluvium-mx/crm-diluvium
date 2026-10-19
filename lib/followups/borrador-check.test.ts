import { describe, expect, it } from "vitest";
import { borradorProblems } from "./borrador-check";

const workflow = [
  "Hola, gracias por escribir a Diluvium. La compuerta anti-inundaciones está en $5,500 con envío gratis a todo México.",
  "¿Usted tiene problemas de inundaciones?",
];

describe("borradorProblems (reglas del dueño, 3-oct-2026)", () => {
  it("bien: una pregunta nueva, sin precio repetido", () => {
    expect(borradorProblems({ borrador: "¿Qué ancho tiene la entrada que quiere proteger? Con esa medida le digo qué tamaño le queda.", companyTexts: workflow })).toEqual([]);
  });
  it("la misma pregunta con otras palabras (inundaciones / se le mete el agua)", () => {
    expect(borradorProblems({ borrador: "¿Se le mete el agua en su casa cuando llueve?", companyTexts: workflow })).toEqual([
      "vuelve a preguntar si se le mete el agua, que ya se le preguntó",
    ]);
  });
  it("repite el precio que ya se le dio; una medida no es precio", () => {
    expect(borradorProblems({ borrador: "La compuerta sigue en $5,500. ¿Le quedó alguna duda?", companyTexts: workflow })).toEqual(["repite el precio que ya se le dio ($5,500)"]);
    expect(borradorProblems({ borrador: "Para su entrada de 120 cm, ¿le quedó alguna duda?", companyTexts: ["¿Su entrada mide 120 cm?"] })).toEqual([]);
  });
  it("letras de otro idioma (caso 6-oct) → se rehace", () => {
    expect(borradorProblems({ borrador: "¿Pudo medir la entrada? 娱乐平台招商", companyTexts: [] })).toEqual(["trae letras de otro idioma (debe ser solo español)"]);
  });
  it("más de una pregunta", () => {
    expect(borradorProblems({ borrador: "¿Pudo medir? ¿Le quedó alguna duda?", companyTexts: [] })[0]).toMatch(/2 preguntas/);
  });
  it("copia casi literal de una pregunta ya hecha", () => {
    const asked = ["¿Cuánto mide de ancho cada una de las dos entradas, de izquierda a derecha?"];
    expect(borradorProblems({ borrador: "¿Cuánto mide de ancho cada una de sus dos entradas?", companyTexts: ["¿Cuántas personas viven en la casa?", ...asked, "¿Le funciona?"] })[0]).toMatch(
      /repite una pregunta/,
    );
    // Preguntar si ya pudo medir (faltan medidas) no es la misma pregunta.
    expect(borradorProblems({ borrador: "¿Pudo medir el ancho de las entradas?", companyTexts: asked })).toEqual([]);
  });
  // 19-oct-2026, chat de luz: «¿Cuántas entradas necesita proteger?» → «ya te digo». La última pregunta de la empresa es
  // la pendiente: el seguimiento la retoma con otras palabras; antes se quedaba sin mensaje.
  describe("la pregunta pendiente (la última que hizo la empresa)", () => {
    const luz = [
      "¿Usted tiene problemas de inundaciones?",
      "La compuerta estándar le funciona, ya que protege hasta 60 cm de altura. ¿Cuántas entradas necesita proteger?",
      "Claro, quedo pendiente. La compuerta estándar le funciona para una altura de agua de hasta 60 cm.",
    ];
    it("con otras palabras sí se puede", () => {
      expect(borradorProblems({ borrador: "Quedo atento a cuántas puertas o accesos quiere cubrir para armarle la cotización. ¿Ya lo pudo revisar?", companyTexts: luz })).toEqual([]);
      expect(borradorProblems({ borrador: "Para armarle la cotización, ¿en cuántas entradas la colocaría?", companyTexts: luz })).toEqual([]);
    });
    it("casi copiada, se pide con otras palabras", () => {
      expect(borradorProblems({ borrador: "¿Ya sabe cuántas entradas necesita proteger?", companyTexts: luz })).toEqual([
        "copia casi igual la pregunta pendiente «Cuántas entradas necesita proteger?»: retómala con otras palabras",
      ]);
    });
    it("una pregunta vieja sigue sin repetirse, aunque sea por tema", () => {
      expect(borradorProblems({ borrador: "¿Se le mete el agua cuando llueve?", companyTexts: luz })).toEqual(["vuelve a preguntar si se le mete el agua, que ya se le preguntó"]);
    });
  });
});
