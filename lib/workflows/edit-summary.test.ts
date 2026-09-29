import { describe, expect, it } from "vitest";
import { saveSummary, type WorkflowFields } from "./edit-summary";

const precio: WorkflowFields = {
  name: "Precio 2",
  enabled: true,
  agentDescription: "Cuando una persona pregunte por precio, empezando una conversación",
  triggerAgent: true,
  triggerKeywords: ["cuesta", "costo", "precio"],
  triggerCommand: "/precio2",
  triggerStage: null,
  triggerStartOnly: false,
  triggerStartOnlyAgent: true,
  maxSendsPerChat: null,
  isAnswer: false,
  steps: [
    { kind: "send_text", text: "Tenemos varios tamaños…" },
    { kind: "send_text", text: "¿Usted tiene problemas de inundaciones?" },
  ],
};
const stageName = (key: string) => (key === "cerca_compra" ? "Cerca de compra" : key);

describe("saveSummary (un solo aviso al guardar el workflow)", () => {
  it("varios cambios a la vez salen juntos, con el mismo texto del Historial", () => {
    const after = { ...precio, triggerStartOnly: true, triggerKeywords: [...precio.triggerKeywords, "cuánto cuesta"], steps: precio.steps.slice(0, 1) };
    expect(saveSummary(precio, after, stageName)).toEqual({
      kind: "editar",
      antes: "2 pasos · Palabras clave: cuesta, costo, precio · Cuándo: En cualquier momento",
      despues: "1 paso · Palabras clave: cuesta, costo, precio, cuánto cuesta · Cuándo: Solo al inicio",
    });
  });
  it("la etapa por su nombre; un workflow nuevo se resume; sin cambios no hay nada que confirmar", () => {
    expect(saveSummary(precio, { ...precio, triggerStage: "cerca_compra" }, stageName)).toMatchObject({ despues: "Al entrar a: Cerca de compra" });
    expect(saveSummary(null, { ...precio, enabled: false }, stageName)).toEqual({ kind: "crear", resumen: "Apagado · 2 pasos" });
    expect(saveSummary(precio, { ...precio }, stageName)).toEqual({ kind: "sin_cambios" });
  });
});
