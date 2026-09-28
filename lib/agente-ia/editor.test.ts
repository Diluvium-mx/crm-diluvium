import { describe, expect, it } from "vitest";
import {
  applyCustomValues,
  approxTokens,
  countWords,
  faqSchema,
  faqsAsText,
  goalSchema,
  MAX_VERSION_NAME,
  profileSchema,
  restoreVersionQuestion,
  versionNameSchema,
} from "./editor";

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

describe("validación", () => {
  it("Goal no vacío; FAQ con pregunta y respuesta; nombre del agente obligatorio", () => {
    expect(goalSchema.safeParse("   ").success).toBe(false);
    expect(faqSchema.safeParse({ question: "¿Precio?", answer: "" }).success).toBe(false);
    expect(faqSchema.parse({ question: " ¿Precio? ", answer: "$5,500" })).toEqual({ question: "¿Precio?", answer: "$5,500", enabled: true });
    expect(profileSchema.safeParse({ agentName: " ", companyName: "" }).success).toBe(false);
    expect(profileSchema.safeParse({}).success).toBe(false);
    expect(profileSchema.safeParse({ companyName: "Diluvium" }).success).toBe(true);
  });
});

describe("nombre de una versión (lápiz ✎)", () => {
  it("se recorta; vacío o solo espacios = sin nombre (null)", () => {
    expect(versionNameSchema.parse("  Antes de la promo  ")).toBe("Antes de la promo");
    expect(versionNameSchema.parse("")).toBeNull();
    expect(versionNameSchema.parse("   ")).toBeNull();
  });
  it("máximo 80 caracteres (contados después de recortar)", () => {
    expect(versionNameSchema.parse("x".repeat(MAX_VERSION_NAME))).toBe("x".repeat(MAX_VERSION_NAME));
    expect(versionNameSchema.parse(` ${"x".repeat(MAX_VERSION_NAME)} `)).toBe("x".repeat(MAX_VERSION_NAME));
    const r = versionNameSchema.safeParse("x".repeat(MAX_VERSION_NAME + 1));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/80 caracteres/);
  });
  it("la pregunta de «Restaurar» lleva el nombre solo si lo hay", () => {
    expect(restoreVersionQuestion("Antes de la promo", "26 sep 2026, 11:53 a.m.")).toBe("¿Restaurar la versión «Antes de la promo» del 26 sep 2026, 11:53 a.m.?");
    expect(restoreVersionQuestion(null, "26 sep 2026, 11:53 a.m.")).toBe("¿Restaurar la versión del 26 sep 2026, 11:53 a.m.?");
    expect(restoreVersionQuestion("  ", "26 sep 2026, 11:53 a.m.")).toBe("¿Restaurar la versión del 26 sep 2026, 11:53 a.m.?");
  });
});

describe("faqsAsText (botón Copiar de las FAQs)", () => {
  it("todas con guion y sin números, la respuesta debajo con sangría y una línea en blanco entre preguntas", () => {
    const text = faqsAsText([
      { question: " ¿Cuánto cuesta? ", answer: "Desde $5,500.\n\nEl envío va incluido.  ", enabled: true },
      { question: "¿Hacen factura?", answer: "Sí.", enabled: false },
    ]);
    expect(text).toBe("- ¿Cuánto cuesta?\n  Desde $5,500.\n\n  El envío va incluido.\n\n- ¿Hacen factura? (inactiva)\n  Sí.");
    expect(text).not.toMatch(/^\d/mu);
  });

  it("sin FAQs no copia nada", () => {
    expect(faqsAsText([])).toBe("");
  });
});
