import { describe, expect, it } from "vitest";
import { buildBrainSystemWithRuntime, LENGTH_LINES, RUNTIME_SUFFIX } from "./brain";

const faqs = [{ question: "¿Precio?", answer: "$5,500", position: 1, enabled: true }];

describe("longitud de respuesta (Opciones del bot)", () => {
  it("balanceada (fábrica) deja el system IDÉNTICO al de antes; corta/detallada agregan una sola línea al final", () => {
    const base = buildBrainSystemWithRuntime("GOAL", faqs);
    expect(base).toBe(buildBrainSystemWithRuntime("GOAL", faqs, "balanceada"));
    expect(base.endsWith(RUNTIME_SUFFIX)).toBe(true);
    for (const length of ["corta", "detallada"] as const) {
      const s = buildBrainSystemWithRuntime("GOAL", faqs, length);
      expect(s.startsWith(base)).toBe(true); // el Goal, las FAQs y el sufijo no cambian (caché intacta)
      expect(s).toBe(`${base}\n${LENGTH_LINES[length]}`);
    }
  });
});
