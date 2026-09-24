import { describe, expect, it } from "vitest";
import { buildAgentTools, TOOL_FIJAR_COTIZACION, validateToolCalls } from "./tools";

const rows = [
  { id: "w1", slug: "tabla_tamanos_estandar", name: "Tabla", description: "Envía la tabla de tamaños." },
  { id: "w2", slug: "cambiar_etapa", name: "Etapa", description: "Mueve la etapa." },
  { id: "w3", slug: "pago_confirmado", name: "Pago", description: "Confirma un pago." },
];

describe("herramientas del cerebro (Fase D)", () => {
  it("una por workflow (wf_<slug>, descripción = 'Cuándo usarlo') + fijar_cotizacion", () => {
    const t = buildAgentTools(rows);
    expect(Object.keys(t.tools)).toEqual(["wf_tabla_tamanos_estandar", "wf_cambiar_etapa", "wf_pago_confirmado", TOOL_FIJAR_COTIZACION]);
    expect(t.tools.wf_tabla_tamanos_estandar.description).toBe("Envía la tabla de tamaños.");
    expect(t.byName.get("wf_cambiar_etapa")).toEqual({ id: "w2", slug: "cambiar_etapa", name: "Etapa" });
  });
  it("valida llamadas: desconocida/deshabilitada se ignora, argumentos con Zod, repetida cuenta una vez", () => {
    const t = buildAgentTools(rows);
    const { valid, ignored } = validateToolCalls(
      [
        { toolName: "wf_tabla_tamanos_estandar", input: {} },
        { toolName: "wf_tabla_tamanos_estandar", input: {} },
        { toolName: "wf_cambiar_etapa", input: { etapa: "compra" } },
        { toolName: "wf_cambiar_etapa", input: { etapa: "ganado" } },
        { toolName: "wf_datos_bancarios", input: {} },
        { toolName: TOOL_FIJAR_COTIZACION, input: { monto: 5500 } },
        { toolName: TOOL_FIJAR_COTIZACION, input: { monto: -1 } },
        { toolName: "wf_pago_confirmado", input: { monto: "$5,500", fecha: null, banco: "BBVA", referencia: "ABC123" } },
      ],
      t,
    );
    expect(valid).toEqual([
      { kind: "workflow", workflow: { id: "w1", slug: "tabla_tamanos_estandar", name: "Tabla" }, args: {} },
      { kind: "workflow", workflow: { id: "w2", slug: "cambiar_etapa", name: "Etapa" }, args: { etapa: "compra" } },
      { kind: "cotizacion", monto: 5500 },
      { kind: "workflow", workflow: { id: "w3", slug: "pago_confirmado", name: "Pago" }, args: { monto: "$5,500", fecha: null, banco: "BBVA", referencia: "ABC123" } },
    ]);
    expect(ignored).toEqual(["wf_cambiar_etapa: argumentos inválidos", "wf_datos_bancarios: herramienta desconocida o deshabilitada", `${TOOL_FIJAR_COTIZACION}: argumentos inválidos`]);
  });
});
