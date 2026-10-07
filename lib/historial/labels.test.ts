import { describe, expect, it } from "vitest";
import {
  agentStateLabel,
  describeAction,
  describeWorkflowEdit,
  formatMazatlan,
  HISTORY_TYPES,
  historyFilterSchema,
  historyRange,
  isAutomaticAction,
  templateStatusLabel,
  workflowAssetIds,
  workflowDetail,
  type WorkflowSnapshot,
} from "./labels";

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

  it("Bloque E: frases de los tipos nuevos (regla, nombre, tallas, mensajes rápidos, plantillas, vendedores, pausas automáticas)", () => {
    expect(describeAction("etapas", "regla", "Cotizado")).toBe("Cambió la regla del Agente IA de la etapa «Cotizado»");
    expect(describeAction("nombre", "editar", null)).toBe("Cambió el nombre del agente");
    expect(describeAction("tallas", "editar", null)).toBe("Cambió las tallas y medidas");
    expect(describeAction("mensajes_rapidos", "borrar", "Saludo")).toBe("Borró el mensaje rápido «Saludo»");
    expect(describeAction("plantillas", "alta", "bienvenida")).toBe("Dio de alta la plantilla «bienvenida» (va a revisión de Meta)");
    expect(describeAction("plantillas", "sincronizar", null)).toBe("Cambió el estado de las plantillas en Meta (Ver estado)");
    expect(describeAction("plantillas", "editar", "saludo")).toBe("Editó el texto de la plantilla «saludo» (vuelve a revisión de Meta)");
    expect(describeAction("plantillas", "borrar", "prueba")).toBe("Borró la plantilla «prueba» en Meta");
    expect(describeAction("vendedores", "contrasena", "Ana")).toBe("Restableció la contraseña de «Ana»");
    expect(describeAction("vendedores", "rol", "Ana")).toBe("Cambió el rol de «Ana»");
    expect(describeAction("pausas", "pausa_tope", "Juan")).toBe("Llegó al máximo de respuestas: el agente se pausó en el chat de Juan");
    expect(describeAction("pausas", "pausa_asesor", "Juan")).toBe("El cliente pidió un asesor: el agente se pausó en el chat de Juan");
    expect(describeAction("pausas", "vuelta_sola", "Juan")).toBe("Se cumplió la hora de regreso: el agente volvió solo en el chat de Juan");
    expect(["pausa_auto", "pausa_tope", "pausa_asesor", "vuelta_sola"].every(isAutomaticAction)).toBe(true);
    expect(isAutomaticAction("pausar")).toBe(false);
    expect(templateStatusLabel("approved")).toBe("Aprobada");
    expect(templateStatusLabel("PAUSED")).toBe("PAUSED");
    expect(HISTORY_TYPES.map((t) => t.label)).toEqual([
      "Opciones del Agente IA",
      "Seguimientos",
      "Goal y FAQs",
      "Nombre del agente",
      "Modelos",
      "Etapas",
      "Canales",
      "Workflows",
      "Tallas y medidas",
      "Mensajes rápidos",
      "Plantillas",
      "Vendedores",
      "Pausas por chat",
    ]);
  });

  it("foto de un workflow para 'Ver cambios': archivo por su nombre (o 'archivo borrado')", () => {
    const w: WorkflowSnapshot = {
      name: "Banco",
      enabled: true,
      agentDescription: "",
      triggerAgent: false,
      triggerStartOnly: false,
      triggerStartOnlyAgent: true,
      maxSendsPerChat: null,
      isAnswer: false,
      triggerKeywords: [],
      triggerCommand: null,
      triggerStage: null,
      steps: [
        { kind: "send_media", assetId: "a1", title: "BBVA", caption: "" },
        { kind: "send_media", assetId: "a2", title: "Santander" },
        { kind: "send_media", assetId: null, title: "Pendiente" },
        { kind: "wait", seconds: 5 },
      ],
    };
    expect(workflowAssetIds(w.steps, [{ kind: "send_media", assetId: "a1" }])).toEqual(["a1", "a2"]);
    expect(workflowDetail(w, (id) => (id === "a1" ? "bbva.jpg" : null)).steps).toEqual([
      { kind: "send_media", title: "BBVA", file: "bbva.jpg", caption: null },
      { kind: "send_media", title: "Santander", file: "archivo borrado", caption: null },
      { kind: "send_media", title: "Pendiente", file: null, caption: null },
      { kind: "wait", seconds: 5 },
    ]);
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
      triggerStartOnly: false,
      triggerStartOnlyAgent: true,
      maxSendsPerChat: null,
      isAnswer: false,
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

    it("«Solo al inicio» encendido y apagado", () => {
      expect(describeWorkflowEdit(base, { ...base, triggerStartOnly: true })).toEqual({
        before: "Cuándo: En cualquier momento",
        after: "Cuándo: Solo al inicio",
      });
    });

    it("tercera opción, máximo por chat y «es la respuesta» (29-sep-2026)", () => {
      expect(describeWorkflowEdit(base, { ...base, triggerStartOnly: true, triggerStartOnlyAgent: false, maxSendsPerChat: 2, isAnswer: true })).toEqual({
        before: "Cuándo: En cualquier momento · Máximo por chat: sin límite · Es la respuesta: No",
        after: "Cuándo: Solo al inicio por palabra clave; el Agente IA cuando haga falta · Máximo por chat: 2 veces · Es la respuesta: Sí",
      });
      // Sin «Solo al inicio», la segunda columna no cuenta como cambio.
      expect(describeWorkflowEdit(base, { ...base, triggerStartOnlyAgent: false })).toBeNull();
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
