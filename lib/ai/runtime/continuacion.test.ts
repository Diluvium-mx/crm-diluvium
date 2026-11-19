import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { ACCION_LISTA, continuationMessages, pendingToolCalls } from "./continuacion";

// «Luna callada» (19-nov-2026): la segunda vuelta continúa la MISMA conversación con «listo» por acción.
const leido: ModelMessage[] = [{ role: "user", content: "Sí, normalmente en septiembre y octubre" }];
type Partes = Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string>;
const respuesta = (...parts: Partes): ModelMessage[] => [{ role: "assistant", content: parts }];

describe("continuación con «listo» (Luna callada)", () => {
  it("devuelve «listo» por cada acción pedida, con su id, después de sus llamadas (sin razonamiento ni ids del proveedor)", () => {
    const resp = respuesta(
      { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_1" } } },
      { type: "text", text: "  " },
      { type: "tool-call", toolCallId: "call_a", toolName: "actualizar_detalle", input: { tiene_inundaciones: "si" }, providerOptions: { openai: { itemId: "fc_a" } } },
      { type: "tool-call", toolCallId: "call_b", toolName: "mover_etapa", input: { etapa: "prospecto" } },
    );
    const msgs = continuationMessages(leido, resp);
    expect(msgs).not.toBeNull();
    expect(msgs).toHaveLength(3);
    // Lo que leyó + sus llamadas (limpias) + los resultados.
    expect(msgs![0]).toEqual(leido[0]);
    expect(msgs![1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "call_a", toolName: "actualizar_detalle", input: { tiene_inundaciones: "si" } },
        { type: "tool-call", toolCallId: "call_b", toolName: "mover_etapa", input: { etapa: "prospecto" } },
      ],
    });
    expect(JSON.stringify(msgs)).not.toMatch(/rs_1|fc_a|reasoning/);
    expect(msgs![2]).toEqual({
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "call_a", toolName: "actualizar_detalle", output: { type: "text", value: ACCION_LISTA } },
        { type: "tool-result", toolCallId: "call_b", toolName: "mover_etapa", output: { type: "text", value: ACCION_LISTA } },
      ],
    });
    expect(ACCION_LISTA).toBe("listo");
    // No toca lo que leyó el modelo.
    expect(leido).toHaveLength(1);
  });

  it("sin los mensajes del proveedor (Anthropic, Google…) o sin acciones no se puede continuar: queda el reintento de siempre", () => {
    expect(continuationMessages(leido, undefined)).toBeNull();
    expect(continuationMessages(leido, [])).toBeNull();
    expect(continuationMessages(leido, respuesta({ type: "text", text: "Hola" }))).toBeNull();
    expect(continuationMessages(leido, [{ role: "assistant", content: "texto suelto" }])).toBeNull();
  });

  it("no contesta las acciones que ejecuta el propio proveedor ni las que ya tienen resultado; una sola vez por id", () => {
    const resp: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_web", toolName: "web_search", input: {}, providerExecuted: true },
          { type: "tool-call", toolCallId: "call_ya", toolName: "mover_etapa", input: { etapa: "prospecto" } },
          { type: "tool-call", toolCallId: "call_b", toolName: "fijar_cotizacion", input: { monto: 5500 } },
          { type: "tool-call", toolCallId: "call_b", toolName: "fijar_cotizacion", input: { monto: 5500 } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_ya", toolName: "mover_etapa", output: { type: "text", value: "hecho" } }] },
    ];
    expect(pendingToolCalls(resp)).toEqual([{ toolCallId: "call_b", toolName: "fijar_cotizacion" }]);
    // En la conversación solo va la llamada que recibe su «listo» (una vez).
    expect(continuationMessages(leido, resp)![1]).toEqual({ role: "assistant", content: [{ type: "tool-call", toolCallId: "call_b", toolName: "fijar_cotizacion", input: { monto: 5500 } }] });
    expect(continuationMessages(leido, resp)!.at(-1)).toEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call_b", toolName: "fijar_cotizacion", output: { type: "text", value: "listo" } }],
    });
  });
});
