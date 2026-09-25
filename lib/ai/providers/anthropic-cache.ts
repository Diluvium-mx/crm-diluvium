import type { ModelMessage } from "ai";

// Segundo punto de caché de Anthropic (Fase E, pendiente E, 25-sep-2026): además del
// system, se marca el mensaje JUSTO ANTES del último turno del cliente. El historial
// hasta ahí es idéntico en la siguiente respuesta (lo nuevo se agrega al final y el
// contexto del CRM viaja solo en el último turno), así que Anthropic lo lee de caché
// (10 % del precio) en vez de cobrarlo completo cada vez. PURO; no toca el arreglo
// original. Con un solo turno (primer mensaje) no hay nada que marcar.
export function withHistoryCacheBreakpoint(messages: readonly ModelMessage[]): ModelMessage[] {
  const out = [...messages];
  let lastUser = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser <= 0) return out;
  const target = out[lastUser - 1];
  out[lastUser - 1] = {
    ...target,
    providerOptions: { ...target.providerOptions, anthropic: { ...target.providerOptions?.anthropic, cacheControl: { type: "ephemeral" } } },
  } as ModelMessage;
  return out;
}
