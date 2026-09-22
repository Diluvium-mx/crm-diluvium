import { describe, it, expect } from "vitest";
import { buildFaqBlock, buildBrainSystem, FAQ_SECTION_HEADER, type Faq } from "./knowledge";

const faqs: Faq[] = [
  { position: 2, question: "¿Dónde están?", answer: "En Los Mochis." },
  { position: 1, question: "¿Cuánto cuesta?", answer: "$5,500 MXN." },
  { position: 3, question: "¿Hacen envíos?", answer: "Sí.", enabled: false },
];

describe("buildFaqBlock", () => {
  it("ordena por posición y usa el formato P:/R:", () => {
    expect(buildFaqBlock(faqs)).toBe(
      "P: ¿Cuánto cuesta?\nR: $5,500 MXN.\n\nP: ¿Dónde están?\nR: En Los Mochis.",
    );
  });

  it("excluye las FAQ deshabilitadas (enabled === false)", () => {
    expect(buildFaqBlock(faqs)).not.toContain("¿Hacen envíos?");
  });

  it("no muta el arreglo de entrada", () => {
    const input: Faq[] = [
      { position: 2, question: "b", answer: "b" },
      { position: 1, question: "a", answer: "a" },
    ];
    buildFaqBlock(input);
    expect(input.map((f) => f.position)).toEqual([2, 1]);
  });

  it("recorta espacios en pregunta y respuesta", () => {
    expect(buildFaqBlock([{ position: 1, question: "  hola  ", answer: "  mundo  " }])).toBe(
      "P: hola\nR: mundo",
    );
  });

  it("devuelve cadena vacía sin FAQ habilitadas", () => {
    expect(buildFaqBlock([{ position: 1, question: "x", answer: "y", enabled: false }])).toBe("");
  });
});

describe("buildBrainSystem", () => {
  it("compone Goal + encabezado + bloque de FAQs", () => {
    const sys = buildBrainSystem("GOAL AQUI", faqs);
    expect(sys).toBe(
      `GOAL AQUI\n\n${FAQ_SECTION_HEADER}\n\nP: ¿Cuánto cuesta?\nR: $5,500 MXN.\n\nP: ¿Dónde están?\nR: En Los Mochis.`,
    );
  });

  it("sin FAQs devuelve solo el Goal (recortado)", () => {
    expect(buildBrainSystem("  GOAL  ", [])).toBe("GOAL");
    expect(buildBrainSystem("GOAL", [])).not.toContain(FAQ_SECTION_HEADER);
  });
});
