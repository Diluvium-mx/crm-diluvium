// Texto interno del Agente IA (5-oct-2026, dueño: «nunca de los nuncas»). PURO (sin BD).
//
// Del 30-sep al 4-oct, 6 mensajes llegaron a 5 clientes con lo que el modelo «pensaba hacer» en
// vez de hacerlo: «[tool call] wf_video… actualizar_detalle {"tiene_inundaciones":…}», «[We need
// tool after response]», «[tool call?]», «[actions]» y «*(sin acción adicional, la respuesta ya fue
// enviada por el sistema)*». Siempre DESPUÉS de una respuesta buena (aparte o en su último renglón):
// el modelo escribió la llamada como texto. Causa: el sufijo del CRM decía «primero tu texto y luego
// la llamada» (brain.ts), y algunos modelos la escribían.
//
// Regla: si CUALQUIER parte de la respuesta parece texto interno, no sale nada; el vendedor recibe
// la tarjeta «El agente no pudo responder» y el Agente IA queda en pausa en ese chat hasta que
// elija Reintentar o Apagar (run.ts). Probado contra los 4,731 mensajes reales del Agente IA en
// producción (26-sep → 5-oct), renglón por renglón (4,825): marca los 6 y ninguno bueno.

const TOOL_NAMES = /\b(wf_[a-z0-9_]+|actualizar_detalle|fijar_cotizacion|mover_etapa|aviso_vendedor)\b/;

const RULES: readonly { reason: string; test: (t: string) => boolean }[] = [
  // Todo el mensaje entre corchetes: «[tool call?]», «[We need tool after response]».
  { reason: "mensaje entre corchetes", test: (t) => /^\[[^\]]*\]$/.test(t) },
  { reason: "llamada a herramienta escrita como texto", test: (t) => /\b(tool|function)[ _-]?(calls?|use)\b/i.test(t) },
  { reason: "nombre de una acción interna", test: (t) => TOOL_NAMES.test(t) },
  { reason: "datos en formato JSON", test: (t) => /\{\s*"[A-Za-z_]+"\s*:/.test(t) },
  // Todo el mensaje entre paréntesis (con o sin * o _): «*(sin acción adicional…)*».
  { reason: "nota entre paréntesis", test: (t) => /^[*_]*\([\s\S]*\)[*_]*$/.test(t) },
  { reason: "nota para el sistema", test: (t) => /sin acci[oó]n adicional|respuesta ya fue enviada|nota interna|\bwe need\b/i.test(t) },
];

/** Por qué el texto parece interno (para el registro y la tarjeta), o null si es para el cliente. */
export function internalTextReason(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return RULES.find((r) => r.test(t))?.reason ?? null;
}

/**
 * El primer RENGLÓN de la respuesta que parece interno, con su motivo; null si todo es para el
 * cliente. Por renglón y no por mensaje: «…¿me comparte una fotografía de cada entrada?\n\n[actions]»
 * (1-oct) iba pegado al final de una pregunta buena.
 */
export function findInternalText(parts: readonly string[]): { text: string; reason: string } | null {
  for (const line of parts.flatMap((p) => p.split("\n"))) {
    const reason = internalTextReason(line);
    if (reason) return { text: line.trim(), reason };
  }
  return null;
}

const SUFFIX = "No se le mandó nada al cliente y el Agente IA queda en pausa en este chat. Contéstale tú, o usa Reintentar para que vuelva a intentarlo.";

function quote(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/**
 * ¿La respuesta quedó sin completar? Texto interno, cortada por el tope de tokens o una acción
 * pedida que no se puede hacer (datos inválidos, herramienta que no existe). `card` = cuerpo de
 * la tarjeta para el vendedor; `log` = registro corto. El Detalle sin datos válidos no cuenta
 * (es de apoyo: no le promete nada al cliente).
 */
export function unfinishedReply(
  parts: readonly string[],
  finishReason: string | undefined,
  ignored: readonly string[],
): { card: string; log: string } | null {
  const internal = findInternalText(parts);
  if (internal) {
    return {
      card: `El Agente IA escribió una nota interna (${internal.reason}) en su respuesta: «${quote(internal.text)}». ${SUFFIX}`,
      log: `texto interno (${internal.reason}): ${quote(internal.text)}`,
    };
  }
  if (finishReason === "length") {
    return {
      card: `La respuesta del Agente IA se cortó antes de terminar: pudo quedar incompleta o sin alguna acción. ${SUFFIX}`,
      log: "respuesta cortada por el tope de tokens",
    };
  }
  const failed = ignored.filter((i) => !i.endsWith("sin datos válidos"));
  if (failed.length) {
    return {
      card: `El Agente IA pidió una acción que no se pudo hacer (${failed.join("; ")}). ${SUFFIX}`,
      log: `acción sin ejecutar: ${failed.join("; ")}`,
    };
  }
  return null;
}
