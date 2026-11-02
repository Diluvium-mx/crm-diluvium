import type { ModelMessage } from "ai";

export const ANTHROPIC_CACHE_CONTROL = { type: "ephemeral", ttl: "1h" } as const;

// Segundo punto de caché de Anthropic (Fase E, pendiente E, 25-sep-2026): además del
// system, se marca el mensaje JUSTO ANTES del último turno del cliente. El historial
// hasta ahí es idéntico en la siguiente respuesta (lo nuevo se agrega al final y el
// contexto del CRM viaja solo en el último turno), así que Anthropic lo lee de caché
// (10 % del precio) en vez de cobrarlo completo cada vez. PURO; no toca el arreglo
// original. Con un solo turno (primer mensaje) no hay nada que marcar.
// Caché de 1 hora (2-oct-2026, decisión del dueño): con la de 5 min, el 70 % del gasto de
// Sonnet era volver a escribir ~19 mil tokens cuando pasaban más de 5 min entre respuestas.
// Las dos marcas (system e historial) llevan el mismo TTL: Anthropic exige que una entrada
// de 1 h vaya antes que cualquiera de 5 min. Detalle: docs/agente-ia.md › Caché de 1 hora.
// Fotos y PDF (2-nov-2026, A3 de la auditoría de velocidad): antes su URL firmada CAMBIABA en cada
// respuesta y el punto iba antes de la primera foto (lo de después nunca se repetía). Ahora se firman
// con la hora redonda (lib/ai/runtime/firma-imagen.ts): la URL es la misma toda esa hora y el
// historial con fotos también se lee de caché; solo al cambiar la hora se vuelve a escribir.
export function withHistoryCacheBreakpoint(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [...messages];
  let lastUser = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  const at = lastUser - 1;
  if (at < 0) return out;
  const target = out[at];
  out[at] = {
    ...target,
    providerOptions: { ...target.providerOptions, anthropic: { ...target.providerOptions?.anthropic, cacheControl: ANTHROPIC_CACHE_CONTROL } },
  } as ModelMessage;
  return out;
}
