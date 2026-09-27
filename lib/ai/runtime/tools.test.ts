import { describe, expect, it } from "vitest";
import { defaultStages } from "@/lib/contacts/stages";
import { buildAgentTools, parseDetalle, TOOL_ACTUALIZAR_DETALLE, TOOL_AVISO_VENDEDOR, TOOL_FIJAR_COTIZACION, TOOL_MOVER_ETAPA, validateToolCalls } from "./tools";

const stages = defaultStages();

const rows = [
  { id: "w1", slug: "tabla_tamanos_estandar", name: "Tabla", description: "Envía la tabla de tamaños." },
  { id: "w2", slug: "datos_bancarios", name: "Banco", description: "Envía los datos bancarios." },
];

describe("herramientas del cerebro (Fase D reestructurada)", () => {
  it("una por workflow de media + fijar_cotizacion, mover_etapa, aviso_vendedor y (parte 1) actualizar_detalle al final; ninguna de cobro/etapa/humano como workflow", () => {
    const t = buildAgentTools(rows, stages);
    expect(Object.keys(t.tools)).toEqual(["wf_tabla_tamanos_estandar", "wf_datos_bancarios", TOOL_FIJAR_COTIZACION, TOOL_MOVER_ETAPA, TOOL_AVISO_VENDEDOR, TOOL_ACTUALIZAR_DETALLE]);
    expect(Object.keys(t.tools)).not.toContain("wf_pago_confirmado");
    expect(Object.keys(t.tools)).not.toContain("wf_cambiar_etapa");
    expect(Object.keys(t.tools)).not.toContain("wf_transferir_humano");
  });
  it("valida llamadas: argumentos con Zod, desconocida se ignora, la misma media una vez", () => {
    const t = buildAgentTools(rows, stages);
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

  it("mover_etapa acepta SOLO las claves vigentes de la organización: una etapa nueva sí, una borrada ya no", () => {
    const custom = [...stages.filter((s) => s.key !== "interesado"), { id: "n", key: "seguimiento", name: "Seguimiento", position: 6, color: "#000000", role: null, botRule: "Cuando pide que le escriban después.", modelSlot: 1 as const }];
    const t = buildAgentTools(rows, custom);
    expect(t.stageKeys).toEqual(["inbox", "prospecto", "cerca_compra", "compra", "seguimiento"]);
    const { valid, ignored } = validateToolCalls(
      [
        { toolName: TOOL_MOVER_ETAPA, input: { etapa: "seguimiento" } },
        { toolName: TOOL_MOVER_ETAPA, input: { etapa: "interesado" } },
      ],
      t,
    );
    expect(valid).toEqual([{ kind: "etapa", etapa: "seguimiento" }]);
    expect(ignored).toEqual([`${TOOL_MOVER_ETAPA}: argumentos inválidos`]);
    // La descripción de la herramienta lleva el orden actual con clave y nombre.
    expect((t.tools[TOOL_MOVER_ETAPA] as { description?: string }).description).toContain("compra (Compra) → seguimiento (Seguimiento)");
  });

  it("actualizar_detalle: valida campo por campo (un dato raro no tira los demás), redondea y nunca avisa al vendedor", () => {
    expect(
      parseDetalle({
        tiene_inundaciones: "si",
        nivel_agua_cm: 40.6,
        nivel_agua_texto: "  le llega   a la rodilla ",
        num_entradas: 2,
        anchos_cm: [95.2, "105"],
        porcentaje_convencimiento: "65%",
        comentario: "Tiene cochera con desnivel",
      }),
    ).toEqual({
      tieneInundaciones: "si",
      nivelAguaCm: 41,
      nivelAguaTexto: "le llega a la rodilla",
      numEntradas: 2,
      anchosCm: [95, 105],
      porcentajeConvencimiento: 70,
      comentario: "Tiene cochera con desnivel",
    });
    // Fuera de rango o raro → ese campo se descarta; los demás quedan.
    expect(parseDetalle({ tiene_inundaciones: "tal vez", nivel_agua_cm: 5000, num_entradas: 1.5, anchos_cm: [90, 0], porcentaje_convencimiento: 30 })).toEqual({ porcentajeConvencimiento: 30 });
    expect(parseDetalle({})).toBeNull();
    expect(parseDetalle("basura")).toBeNull();
    const t = buildAgentTools(rows, stages);
    const { valid, ignored } = validateToolCalls(
      [
        { toolName: TOOL_ACTUALIZAR_DETALLE, input: { num_entradas: 3 } },
        { toolName: TOOL_ACTUALIZAR_DETALLE, input: { nivel_agua_cm: -4 } },
      ],
      t,
    );
    expect(valid).toEqual([{ kind: "detalle", detalle: { numEntradas: 3 } }]);
    // Sin "argumentos inválidos": el runtime no le pone aviso al vendedor por esto.
    expect(ignored).toEqual([`${TOOL_ACTUALIZAR_DETALLE}: sin datos válidos`]);
  });
});

describe("mergeHandoffToolCalls (traspaso Luna → Sonnet, 27-sep-2026)", async () => {
  const { mergeHandoffToolCalls } = await import("./tools");
  const wf = (id: string): import("./tools").ValidToolCall => ({ kind: "workflow", workflow: { id, slug: id, name: id } });
  const aviso = (motivo: "cliente_pide_humano" | "cotejar_deposito"): import("./tools").ValidToolCall => ({ kind: "aviso", aviso: { motivo, detalle: motivo } });
  const quote = (monto: number): import("./tools").ValidToolCall => ({ kind: "cotizacion", monto });
  const detalle = (n: number): import("./tools").ValidToolCall => ({ kind: "detalle", detalle: { numEntradas: n } });

  it("conserva el workflow y el aviso de Luna que Sonnet no repitió; los repetidos salen una vez", () => {
    const merged = mergeHandoffToolCalls([wf("datos_bancarios"), aviso("cliente_pide_humano"), wf("tabla")], [wf("tabla"), aviso("cotejar_deposito")]);
    expect(merged.filter((c) => c.kind === "workflow").map((c) => (c.kind === "workflow" ? c.workflow.id : ""))).toEqual(["datos_bancarios", "tabla"]);
    expect(merged.filter((c) => c.kind === "aviso").map((c) => (c.kind === "aviso" ? c.aviso.motivo : ""))).toEqual(["cliente_pide_humano", "cotejar_deposito"]);
  });

  it("la cotización de Luna solo entra si Sonnet no dio otra; la etapa de Luna se descarta (la pone el traspaso)", () => {
    expect(mergeHandoffToolCalls([quote(5500), { kind: "etapa", etapa: "cerca_compra" }], [quote(6000)])).toEqual([quote(6000)]);
    expect(mergeHandoffToolCalls([quote(5500), { kind: "etapa", etapa: "cerca_compra" }], [])).toEqual([quote(5500)]);
  });

  it("el Detalle de Luna va antes que el de Sonnet (Sonnet gana campo por campo en mergeDetalle)", () => {
    expect(mergeHandoffToolCalls([detalle(1)], [detalle(2)])).toEqual([detalle(1), detalle(2)]);
  });

  it("sin llamadas de Luna, salen las de Sonnet tal cual", () => {
    expect(mergeHandoffToolCalls([], [wf("tabla")])).toEqual([wf("tabla")]);
  });
});

