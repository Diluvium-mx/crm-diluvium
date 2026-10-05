import { describe, expect, it } from "vitest";
import { sizesInstructions } from "@/lib/contacts/sizes";
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

describe("TAMAÑOS (tabla de Tallas y medidas en el system)", () => {
  const sizes = [
    { linea: "mini" as const, talla: "M", minCm: 89, maxCm: 97, posicion: 4 },
    { linea: "estandar" as const, talla: "M", minCm: 91, maxCm: 100, posicion: 3 },
    { linea: "estandar" as const, talla: "CH", minCm: 79, maxCm: 90, posicion: 2 },
  ];

  it("sin rangos el system queda idéntico al de antes", () => {
    expect(buildBrainSystemWithRuntime("GOAL", faqs, stages, "balanceada", [])).toBe(buildBrainSystemWithRuntime("GOAL", faqs, stages));
  });

  it("va después de las FAQs y antes del sufijo, con la estándar primero y cada línea en su orden", () => {
    const s = buildBrainSystemWithRuntime("GOAL", faqs, stages, "balanceada", sizes);
    const tamanos = sizesInstructions(sizes);
    expect(tamanos).toContain("Compuerta estándar: CH 79 a 90 cm | M 91 a 100 cm");
    expect(tamanos).toContain("Mini compuerta: M 89 a 97 cm");
    expect(tamanos.indexOf("Compuerta estándar")).toBeLessThan(tamanos.indexOf("Mini compuerta"));
    expect(s.indexOf("$5,500")).toBeLessThan(s.indexOf(tamanos));
    expect(s).toContain(`${tamanos}\n\n${RUNTIME_SUFFIX}`);
  });
});
