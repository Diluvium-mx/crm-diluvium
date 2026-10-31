// Lector del Cliente de prueba de staging SIN IA (30-oct-2026, pedido del dueño: probar el seguimiento en staging sin
// gastar saldo; docs/staging.md › Cliente de prueba). En el chat del simulador (lib/messaging/simulador.ts) la lectura
// no llama al modelo: contesta siempre lo mismo, sin red y con 0 tokens. Cuando se pide la ficha de seguimiento (el
// último mensaje es nuestro, un acuse del cliente o «Despertar»), una ficha de ejemplo; el Detalle y la etapa no se
// tocan. Lo demás es el camino de siempre (guardar el seguimiento, su hora, la píldora, el envío simulado). Las
// respuestas del Agente IA al Cliente de prueba siguen usando el modelo real (eso no cambia).
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { esCuentaSimulada, simuladorActivo } from "@/lib/messaging/simulador";
import { LECTOR_MODEL_ID, LECTOR_TOOL } from "./lector-core";

/** ¿Este chat es el del Cliente de prueba, con el simulador activo (staging o local)? En producción nunca. */
export function esLecturaSimulada(channel: { providerAccountId: string }): boolean {
  return simuladorActivo() && esCuentaSimulada(channel.providerAccountId);
}

/** La ficha de seguimiento que «lee» siempre en el Cliente de prueba (con la forma que manda el modelo). */
export const FICHA_DE_PRUEBA = {
  caso: "cotizacion_sin_respuesta",
  pendiente: "Ejemplo sin IA (Cliente de prueba): quedó pendiente que confirme si avanza con su compuerta.",
  siguiente_paso: "Confirmar si avanza y compartirle los datos para el anticipo.",
  vale_la_pena: true,
  motivo: null,
  fecha_pedida: null,
  hora_pedida: null,
  borrador: "¿Pudo revisar la cotización que le compartimos?",
  caso_de_fondo: null,
  plantilla_2: null,
  plantilla_3: null,
} as const;

/** Si el borrador de ejemplo choca con algo del chat (p. ej. el vendedor ya hizo esa pregunta), el «rehecho». */
export const BORRADOR_REHECHO = "¿Le gustaría que avancemos con su compuerta?";

const SIN_TOKENS = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** El callModel del lector para el Cliente de prueba: `followUp` = esta lectura pide la ficha de seguimiento. */
export function lectorSimulado(followUp: boolean): (modelId: string, input: CallModelInput) => Promise<CallModelResult> {
  return async (modelId, input) => {
    const herramientas = Object.keys(input.tools ?? {});
    const toolCalls = herramientas.includes(LECTOR_TOOL)
      ? [{ toolName: LECTOR_TOOL, input: followUp ? { seguimiento: FICHA_DE_PRUEBA } : {} }]
      : herramientas.map((toolName) => ({ toolName, input: { borrador: BORRADOR_REHECHO } }));
    return { modelId: modelId || LECTOR_MODEL_ID, provider: "openai", providerModelId: "simulado", text: "", usage: SIN_TOKENS, finishReason: "tool-calls", toolCalls };
  };
}
