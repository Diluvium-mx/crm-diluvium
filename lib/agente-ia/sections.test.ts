import { describe, expect, it } from "vitest";
import { AGENT_SECTIONS, parseAgentSection } from "./sections";

describe("subpestañas del Agente IA (?seccion=)", () => {
  it("las ocho, en el orden de la barra (Etapas después de Modelos, Historial al final)", () => {
    expect(AGENT_SECTIONS.map((s) => s.id)).toEqual(["modelos", "etapas", "goal", "faqs", "opciones", "tallas", "canales", "historial"]);
    expect(parseAgentSection("historial")).toBe("historial");
    expect(parseAgentSection("etapas")).toBe("etapas");
  });
  it("lee la de la URL; nada, repetida o desconocida = Modelos", () => {
    expect(parseAgentSection("opciones")).toBe("opciones");
    expect(parseAgentSection(["canales", "goal"])).toBe("canales");
    expect(parseAgentSection(undefined)).toBe("modelos");
    expect(parseAgentSection("implementar")).toBe("modelos");
    expect(parseAgentSection("")).toBe("modelos");
  });
});
