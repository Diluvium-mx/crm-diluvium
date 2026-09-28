import { describe, expect, it } from "vitest";
import { agentStateLabel, describeAction, describeWorkflowEdit, formatMazatlan, historyFilterSchema, historyRange, type WorkflowSnapshot } from "./labels";

describe("historial de cambios: textos y filtros", () => {
  it("fecha y hora de Mazatlán (UTC−7)", () => {
    expect(formatMazatlan(new Date("2026-09-28T21:05:00Z"))).toBe("28-sep-2026 14:05");
    expect(formatMazatlan(new Date("2026-10-01T03:30:00Z"))).toBe("30-sep-2026 20:30");
  });

  it("estado del agente en un chat", () => {
    expect(agentStateLabel("activo", null)).toBe("Activo");
    expect(agentStateLabel("pausado_humano", null)).toBe("Pausado hasta «Activar»");
    expect(agentStateLabel("pausado_humano", new Date("2026-09-29T05:30:00Z"))).toBe("Pausado hasta 28-sep-2026 22:30");
  });

  it("qué: una frase por acción", () => {
    expect(describeAction("modelos", "modelo_1", null)).toBe("Cambió el Modelo 1");
    expect(describeAction("etapas", "borrar", "Prospecto")).toBe("Borró la etapa «Prospecto»");
    expect(describeAction("canales", "apagar", "WhatsApp Diluvium")).toBe("Apagó el agente en WhatsApp Diluvium");
    expect(describeAction("canales", "limpiar_pruebas", "Número de prueba, Sandbox")).toBe(
      "Limpieza de chats de prueba: borró los chats de «Número de prueba, Sandbox»",
    );
    expect(describeAction("workflows", "encender", "Banco")).toBe("Encendió el workflow «Banco»");
    expect(describeAction("pausas", "pausa_auto", "Juan Pérez")).toBe("Un vendedor contestó: el agente se pausó en el chat de Juan Pérez");
    expect(describeAction("pausas", "activar", null)).toBe("Activó el agente en el chat de un contacto");
  });

  it("fechas Desde/Hasta en hora de Mazatlán, ambos días incluidos", () => {
    const { start, end } = historyRange("2026-09-28", "2026-09-28");
    expect(start?.toISOString()).toBe("2026-09-28T07:00:00.000Z");
    expect(end?.toISOString()).toBe("2026-09-29T07:00:00.000Z");
    expect(historyRange(null, "no-es-fecha")).toEqual({ start: null, end: null });
  });

  it("filtros: pausas automáticas ocultas de fábrica; tipo desconocido no pasa", () => {
    expect(historyFilterSchema.parse({}).includeAuto).toBe(false);
    expect(historyFilterSchema.safeParse({ type: "contactos" }).success).toBe(false);
    expect(historyFilterSchema.safeParse({ from: "28/09/2026" }).success).toBe(false);
  });

  describe("workflow editado: solo lo que cambió", () => {
    const base: WorkflowSnapshot = {
      name: "Banco",
      enabled: false,
      agentDescription: "Datos bancarios",
      triggerAgent: true,
      triggerKeywords: ["banco"],
      triggerCommand: "/banco",
      triggerStage: null,
      steps: [{ kind: "send_text", text: "Hola" }],
    };

    it("sin cambios = nada (las llaves de los pasos en otro orden no cuentan)", () => {
      expect(describeWorkflowEdit(base, { ...base, steps: [{ text: "Hola", kind: "send_text" }] })).toBeNull();
    });

    it("nombre, encendido, pasos y palabras clave", () => {
      const after = { ...base, name: "Datos bancarios", enabled: true, triggerKeywords: ["banco", "cuenta"], steps: [...base.steps, { kind: "wait", seconds: 30 }] };
      expect(describeWorkflowEdit(base, after)).toEqual({
        before: "Nombre: «Banco» · Apagado · 1 paso · Palabras clave: banco",
        after: "Nombre: «Datos bancarios» · Encendido · 2 pasos · Palabras clave: banco, cuenta",
      });
    });

    it("mismo número de pasos pero distintos, comando, etapa y descripción", () => {
      const after = { ...base, steps: [{ kind: "send_text", text: "Buen día" }], triggerCommand: null, triggerStage: "Interesado", agentDescription: "Otra" };
      expect(describeWorkflowEdit(base, after)).toEqual({
        before: "1 paso · Comando: /banco · Al entrar a: ninguna · Descripción para el agente",
        after: "1 paso (editados) · Comando: ninguno · Al entrar a: Interesado · Descripción para el agente (editada)",
      });
    });
  });
});
