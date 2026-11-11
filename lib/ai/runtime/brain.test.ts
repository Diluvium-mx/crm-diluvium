import { describe, expect, it } from "vitest";
import { sizesInstructions } from "@/lib/contacts/sizes";
import { defaultStages, stagesInstructions } from "@/lib/contacts/stages";
import { linkOptionsInstructions, opcionesDe, type LinkPago } from "@/lib/agente-ia/links-pago";
import { buildBrainSystemParts, buildBrainSystemWithRuntime, LENGTH_LINES, RUNTIME_SUFFIX } from "./brain";

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

describe("caché en dos partes (11-nov-2026)", () => {
  const link: LinkPago = { id: "l1", nombre: "Funda medida especial", monto: 1200, cubre: "total", meses: 0, url: "https://mpago.la/x", soloVendedor: false, posicion: 1 };
  const sizes = [{ linea: "estandar" as const, talla: "CH", minCm: 79, maxCm: 90, posicion: 1 }];

  it("el bloque 1 es SOLO el Goal; FAQs, tallas, sufijo, etapas y links van en el 2", () => {
    const p = buildBrainSystemParts("  GOAL largo  ", faqs, stages, "balanceada", sizes, opcionesDe([link]));
    expect(p.system.slice(0, p.systemCacheBreak)).toBe("GOAL largo");
    const resto = p.system.slice(p.systemCacheBreak);
    expect(resto.startsWith("\n\n")).toBe(true);
    for (const parte of ["$5,500", sizesInstructions(sizes), RUNTIME_SUFFIX, stagesInstructions(stages)]) expect(resto).toContain(parte);
    expect(p.system.endsWith(`${stagesInstructions(stages)}\n\n${linkOptionsInstructions(opcionesDe([link]))}`)).toBe(true);
    expect(resto).toContain("funda_medida_especial = Funda medida especial: cobra $1,200, de contado");
  });

  it("cambiar una FAQ, un link o una columna NO toca el bloque 1", () => {
    const a = buildBrainSystemParts("GOAL", faqs, stages);
    const b = buildBrainSystemParts("GOAL", [...faqs, { question: "¿Funda?", answer: "$1,200", position: 2, enabled: true }], stages.slice(0, 3), "balanceada", sizes, opcionesDe([link]));
    expect(a.system.slice(0, a.systemCacheBreak)).toBe(b.system.slice(0, b.systemCacheBreak));
    expect(a.system).not.toBe(b.system);
  });

  it("sin links el texto es el de siempre (mismo que buildBrainSystemWithRuntime)", () => {
    expect(buildBrainSystemParts("GOAL", faqs, stages).system).toBe(buildBrainSystemWithRuntime("GOAL", faqs, stages));
    expect(buildBrainSystemParts("GOAL", faqs, stages).system).not.toContain("LINKS DE PAGO");
  });
});
