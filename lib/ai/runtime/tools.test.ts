import { describe, expect, it } from "vitest";
import { buildAgentTools, TOOL_AVISO_VENDEDOR, TOOL_FIJAR_COTIZACION, TOOL_MOVER_ETAPA, validateToolCalls } from "./tools";

const rows = [
  { id: "w1", slug: "tabla_tamanos_estandar", name: "Tabla", description: "Envía la tabla de tamaños." },
  { id: "w2", slug: "datos_bancarios", name: "Banco", description: "Envía los datos bancarios." },
];

describe("herramientas del cerebro (Fase D reestructurada)", () => {
  it("una por workflow de media + fijar_cotizacion, mover_etapa y aviso_vendedor; ninguna de cobro/etapa/humano como workflow", () => {
    const t = buildAgentTools(rows);
    expect(Object.keys(t.tools)).toEqual(["wf_tabla_tamanos_estandar", "wf_datos_bancarios", TOOL_FIJAR_COTIZACION, TOOL_MOVER_ETAPA, TOOL_AVISO_VENDEDOR]);
    expect(Object.keys(t.tools)).not.toContain("wf_pago_confirmado");
    expect(Object.keys(t.tools)).not.toContain("wf_cambiar_etapa");
    expect(Object.keys(t.tools)).not.toContain("wf_transferir_humano");
  });
  it("valida llamadas: argumentos con Zod, desconocida se ignora, la misma media una vez", () => {
    const t = buildAgentTools(rows);
    const { valid, ignored } = validateToolCalls(
      [
        { toolName: "wf_tabla_tamanos_estandar", input: {} },
        { toolName: "wf_tabla_tamanos_estandar", input: {} },
        { toolName: "wf_pago_confirmado", input: {} },
        { toolName: TOOL_MOVER_ETAPA, input: { etapa: "compra" } },
        { toolName: TOOL_MOVER_ETAPA, input: { etapa: "ganado" } },
        { toolName: TOOL_FIJAR_COTIZACION, input: { monto: 5500 } },
        { toolName: TOOL_AVISO_VENDEDOR, input: { motivo: "cotejar_deposito", detalle: "Pagó", monto: "$5,500", referencia: "ABC 123", banco: "BBVA", fecha: "23/09/2026", tipo: "total" } },
        { toolName: TOOL_AVISO_VENDEDOR, input: { motivo: "otro", detalle: "x" } },
      ],
      t,
    );
    expect(valid.map((v) => v.kind)).toEqual(["workflow", "etapa", "cotizacion", "aviso"]);
    expect(ignored).toEqual([
      "wf_pago_confirmado: herramienta desconocida o deshabilitada",
      `${TOOL_MOVER_ETAPA}: argumentos inválidos`,
      `${TOOL_AVISO_VENDEDOR}: argumentos inválidos`,
    ]);
  });
});
