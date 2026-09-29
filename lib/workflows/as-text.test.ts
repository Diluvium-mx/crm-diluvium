import { describe, expect, it } from "vitest";
import { workflowsAsText, type WorkflowForText } from "./as-text";

const base: WorkflowForText = {
  name: "Tabla de tamaños (estándar)",
  enabled: true,
  agentDescription: "Cuando el cliente pregunta por tamaños.",
  triggerAgent: true,
  triggerCommand: "/tamaños",
  triggerKeywords: ["tamaños", "medidas"],
  triggerStage: null,
  steps: [
    { kind: "wait", seconds: 18 },
    { kind: "send_media", assetId: "a1", title: "tabla-tamanos-estandar.png", caption: "Aquí le comparto una foto.\nCon los tamaños." },
    { kind: "send_text", text: "¿Cuánto mide su entrada?\n\nEn centímetros." },
  ],
  missingMedia: [],
};

const labels = (key: string) => (key === "cerca_compra" ? "Cerca de compra" : key);

describe("workflowsAsText (botón Copiar de Workflows)", () => {
  it("cada workflow con guion y sin números; disparadores, cuándo lo usa el agente y los pasos completos en orden", () => {
    expect(workflowsAsText([base], labels)).toBe(
      [
        "- Tabla de tamaños (estándar) — encendido",
        "  Se dispara con: el Agente IA · comando del vendedor /tamaños · palabras clave del cliente: tamaños, medidas",
        "  Cuándo lo usa el Agente IA: Cuando el cliente pregunta por tamaños.",
        "  Pasos:",
        "    - Esperar 18 s",
        "    - Archivo: tabla-tamanos-estandar.png",
        "      Texto del archivo: Aquí le comparto una foto.",
        "        Con los tamaños.",
        "    - Texto: ¿Cuánto mide su entrada?",
        "",
        "      En centímetros.",
      ].join("\n"),
    );
  });

  it("apagados, falta de archivo, etapa por su nombre, sin agente y una línea en blanco entre workflows", () => {
    const off: WorkflowForText = {
      ...base,
      name: "Datos bancarios",
      enabled: false,
      triggerAgent: false,
      triggerCommand: null,
      triggerKeywords: [],
      triggerStage: "cerca_compra",
      steps: [{ kind: "send_media", assetId: null, title: "datos-bancarios.jpg" }],
      missingMedia: ["datos-bancarios.jpg"],
    };
    const text = workflowsAsText([base, off], labels);
    expect(text.split("\n\n- ")).toHaveLength(2);
    expect(text).toContain(
      "- Datos bancarios — apagado, falta archivo\n  Se dispara con: al entrar a la etapa Cerca de compra\n  Pasos:\n    - Archivo: datos-bancarios.jpg (falta archivo)",
    );
    expect(text).not.toContain("Cuándo lo usa el Agente IA: Cuando el cliente pregunta por tamaños.\n  Pasos:\n    - Archivo: datos");
    expect(text).not.toMatch(/^\d/mu);
  });

  it("sin disparadores ni pasos lo dice; sin workflows no copia nada", () => {
    const empty: WorkflowForText = { ...base, triggerAgent: false, triggerCommand: null, triggerKeywords: [], steps: [], enabled: false };
    expect(workflowsAsText([empty], labels)).toBe(
      "- Tabla de tamaños (estándar) — apagado\n  Se dispara con: nada (no se dispara solo)\n  Pasos: ninguno",
    );
    expect(workflowsAsText([], labels)).toBe("");
  });
});
