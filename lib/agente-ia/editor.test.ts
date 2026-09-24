import { describe, expect, it } from "vitest";
import { applyCustomValues, approxTokens, costTier, countWords, faqSchema, goalSchema, profileSchema } from "./editor";

const values = { contacto: "Juan", vendedor: "Laura", empresa: "Diluvium", agente: "Ángela" };

describe("valores personalizados", () => {
  it("sustituye los 4 valores (con espacios y mayúsculas dentro de las llaves)", () => {
    expect(applyCustomValues("Hola {{contacto.nombre}}, soy {{ Agente.Nombre }} de {{empresa.nombre}}; te atiende {{vendedor.nombre}}.", values)).toBe(
      "Hola Juan, soy Ángela de Diluvium; te atiende Laura.",
    );
  });
  it("deja intacto lo que no es un valor conocido", () => {
    expect(applyCustomValues("{{otro.nombre}} y {{contacto}}", values)).toBe("{{otro.nombre}} y {{contacto}}");
  });
});

describe("contadores del Goal", () => {
  it("palabras y tokens aproximados", () => {
    expect(countWords("  Hola   mundo\nnuevo ")).toBe(3);
    expect(countWords("   ")).toBe(0);
    expect(approxTokens("x".repeat(380))).toBe(100);
  });
});

describe("indicador de costo", () => {
  it("$ a $$$$ por precio de salida; sin precio → null", () => {
    expect(costTier(1.2)).toBe(1);
    expect(costTier(5)).toBe(2);
    expect(costTier(10)).toBe(3);
    expect(costTier(20)).toBe(4);
    expect(costTier(null)).toBeNull();
  });
});

describe("validación", () => {
  it("Goal no vacío; FAQ con pregunta y respuesta; nombre del agente obligatorio", () => {
    expect(goalSchema.safeParse("   ").success).toBe(false);
    expect(faqSchema.safeParse({ question: "¿Precio?", answer: "" }).success).toBe(false);
    expect(faqSchema.parse({ question: " ¿Precio? ", answer: "$5,500" })).toEqual({ question: "¿Precio?", answer: "$5,500", enabled: true });
    expect(profileSchema.safeParse({ agentName: " ", companyName: "" }).success).toBe(false);
  });
});
