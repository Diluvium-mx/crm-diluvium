import { describe, expect, it } from "vitest";
import { AGENT_SECTIONS, parseAgentSection } from "./sections";

describe("subpestañas del Agente IA (?seccion=)", () => {
  it("las seis, en el orden de la barra", () => {
    expect(AGENT_SECTIONS.map((s) => s.id)).toEqual(["modelos", "goal", "faqs", "opciones", "tallas", "canales"]);
  });
  it("lee la de la URL; nada, repetida o desconocida = Modelos", () => {
    expect(parseAgentSection("opciones")).toBe("opciones");
    expect(parseAgentSection(["canales", "goal"])).toBe("canales");
    expect(parseAgentSection(undefined)).toBe("modelos");
    expect(parseAgentSection("implementar")).toBe("modelos");
    expect(parseAgentSection("")).toBe("modelos");
  });
});
