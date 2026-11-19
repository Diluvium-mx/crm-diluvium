// «Luna callada» (19-nov-2026, decisión del dueño: opción A). Los modelos de razonamiento de OpenAI (Luna)
// tratan cada acción como una pregunta: la piden, terminan su turno y escriben el mensaje para el cliente
// hasta recibir el resultado (guía oficial de OpenAI, «Managing Function Calls With Reasoning Models»). El
// CRM declara las herramientas sin `execute` y nunca les devolvía ese resultado, así que a veces Luna
// contestaba SOLO con acciones (Detalle, etapa, cotización…) y el cliente se quedaba sin respuesta: 22
// avisos `sin_respuesta` del 10 al 17-nov. El reintento desde cero repetía las mismas acciones sin texto
// la mitad de las veces.
//
// Ahora, cuando la respuesta no le manda nada al cliente, el runtime CONTINÚA la misma conversación: le
// devuelve «listo» por cada acción pedida (interno, el cliente nunca lo ve) y le pide el mensaje con
// toolChoice "none" (solo texto; no puede pedir otra acción). Las acciones que cuentan son las de la
// primera vuelta. Mismo número de llamadas que el reintento de antes. Si el proveedor no devuelve sus
// mensajes (hoy solo OpenAI los da) o la segunda vuelta falla, queda el reintento de siempre.
import type { ModelMessage, ToolModelMessage } from "ai";

// Lo que el CRM le contesta al modelo por cada acción pedida. Las acciones se ejecutan después, ya con la
// respuesta completa (run.ts), pero para el modelo quedan hechas.
export const ACCION_LISTA = "listo";

type ToolCallRef = { toolCallId: string; toolName: string };

// Llamadas a herramienta de la respuesta que esperan su resultado: las que ejecutaría el CRM (no las que
// ejecuta el propio proveedor) y que no tienen ya un resultado en los mismos mensajes.
export function pendingToolCalls(responseMessages: readonly ModelMessage[]): ToolCallRef[] {
  const answered = new Set<string>();
  for (const m of responseMessages) {
    if (m.role !== "tool") continue;
    for (const part of m.content) if (part.type === "tool-result") answered.add(part.toolCallId);
  }
  const calls: ToolCallRef[] = [];
  const seen = new Set<string>();
  for (const m of responseMessages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type !== "tool-call" || part.providerExecuted === true) continue;
      if (answered.has(part.toolCallId) || seen.has(part.toolCallId)) continue;
      seen.add(part.toolCallId);
      calls.push({ toolCallId: part.toolCallId, toolName: part.toolName });
    }
  }
  return calls;
}

// La conversación de la segunda vuelta: lo que leyó el modelo + sus llamadas (y su texto, si escribió algo) +
// «listo» por cada llamada. null = no se puede continuar (el proveedor no devolvió sus mensajes o no pidió
// ninguna acción): entonces queda el reintento de siempre.
//
// Sin su razonamiento ni los ids internos del proveedor (solo el id de cada llamada, que une la llamada con
// su «listo»): con ellos, OpenAI a veces rechaza la petición («reasoning was provided without its required
// following item», reportado en su foro y en proyectos con el AI SDK; el arreglo que aplicaron fue quitarlos).
// Así la petición es la forma básica que la API siempre acepta; el modelo vuelve a razonar con lo que ya hizo
// a la vista, como en el reintento de antes.
export function continuationMessages(messages: readonly ModelMessage[], responseMessages: readonly ModelMessage[] | undefined): ModelMessage[] | null {
  if (!responseMessages?.length) return null;
  const calls = pendingToolCalls(responseMessages);
  if (!calls.length) return null;
  const pending = new Set(calls.map((c) => c.toolCallId));
  const own: AssistantContent = [];
  for (const m of responseMessages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "text" && part.text.trim()) own.push({ type: "text", text: part.text });
      else if (part.type === "tool-call" && pending.has(part.toolCallId)) {
        pending.delete(part.toolCallId);
        own.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
      }
    }
  }
  const results: ToolModelMessage = {
    role: "tool",
    content: calls.map((c) => ({ type: "tool-result" as const, toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "text" as const, value: ACCION_LISTA } })),
  };
  return [...messages, { role: "assistant", content: own }, results];
}

type AssistantContent = Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string>;
