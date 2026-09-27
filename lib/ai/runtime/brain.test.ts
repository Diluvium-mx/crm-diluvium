import { describe, expect, it } from "vitest";
import { defaultStages, stagesInstructions } from "@/lib/contacts/stages";
import { buildBrainSystemWithRuntime, LENGTH_LINES, RUNTIME_SUFFIX } from "./brain";

const stages = defaultStages();

const faqs = [{ question: "¿Precio?", answer: "$5,500", position: 1, enabled: true }];

describe("longitud de respuesta (Opciones del bot)", () => {
  it("balanceada (fábrica) deja el system IDÉNTICO al de antes; corta/detallada agregan una sola línea al final", () => {
    const base = buildBrainSystemWithRuntime("GOAL", faqs, stages);
    expect(base).toBe(buildBrainSystemWithRuntime("GOAL", faqs, stages, "balanceada"));
    // Columnas del Embudo: las etapas vigentes van al final, después del sufijo fijo.
    expect(base.endsWith(`${RUNTIME_SUFFIX}\n\n${stagesInstructions(stages)}`)).toBe(true);
    const prefix = base.slice(0, base.indexOf(RUNTIME_SUFFIX) + RUNTIME_SUFFIX.length);
    for (const length of ["corta", "detallada"] as const) {
      const s = buildBrainSystemWithRuntime("GOAL", faqs, stages, length);
      expect(s.startsWith(prefix)).toBe(true); // el Goal, las FAQs y el sufijo no cambian (caché intacta)
      expect(s).toBe(base.replace(RUNTIME_SUFFIX, `${RUNTIME_SUFFIX}\n${LENGTH_LINES[length]}`));
    }
  });
});
