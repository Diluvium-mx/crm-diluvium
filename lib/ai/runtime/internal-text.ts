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

// Letras de otro alfabeto (chino, japonés, coreano, cirílico, árabe…). El 2-oct salió «屹» y el 6-oct
// «娱乐平台招商» como burbuja aparte detrás de una pregunta buena: basura de GPT-5.6 Luna (el Goal, las
// FAQs y los workflows no tienen ni un carácter así). Decisión del dueño (6-oct): NO detener la
// respuesta ni pausar al Agente IA — esas letras se BORRAN y sale el resto (stripForeignScript, en
// run.ts al leer la respuesta y otra vez en la puerta de envío). Acentos, ñ, ü, º/ª, °, m² y emojis
// no son de otra escritura y pasan.
const FOREIGN_LETTER = String.raw`(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])\p{L}`;
const FOREIGN_SCRIPT = new RegExp(FOREIGN_LETTER, "u");
// Una tira de letras ajenas con sus marcas, espacios intermedios y puntuación CJK («。», «、»).
const FOREIGN_RUN = new RegExp(String.raw`(?:${FOREIGN_LETTER}[\p{M}\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20]*)+(?:[^\S\n]+(?:${FOREIGN_LETTER}[\p{M}\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20]*)+)*`, "gu");
const HAS_CONTENT = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/** ¿Trae letras de otro alfabeto? */
export function hasForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

/**
 * El texto sin las letras de otro alfabeto. Un renglón que se queda sin nada (solo era basura, o
 * basura con puntuación) desaparece; los demás quedan igual. "" = no quedó nada para el cliente.
 */
export function stripForeignScript(text: string): string {
  if (!hasForeignScript(text)) return text;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (!hasForeignScript(line)) {
      lines.push(line);
      continue;
    }
    const clean = line
      .replace(FOREIGN_RUN, "")
      .replace(/[^\S\n]{2,}/g, " ")
      .replace(/[^\S\n]+([?!.,;:)»])/g, "$1")
      .replace(/([¿¡(«])[^\S\n]+/g, "$1")
      .trim();
    if (HAS_CONTENT.test(clean)) lines.push(clean);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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

// Reintento automático (10-oct-2026, dueño). Del 7 al 10-oct, 10 respuestas de GPT-5.6 Luna se detuvieron por
// texto interno: 7 eran una respuesta buena seguida de «[tool]», «[tool call]», «(update tool after written)» o
// «[tool call?] Need tool update after written…» (el modelo escribió que iba a llamar una herramienta en vez de
// llamarla; empezó 18 minutos después del sufijo del 8-oct, «primero tu texto y, en la misma respuesta, las
// herramientas») y 3 eran la señal de no contestar escrita con espacios, «[ NADA_QUE_AGREGAR ]», ante un «ok» o
// un «gracias». Antes cada una dejaba la tarjeta y al cliente sin respuesta hasta que un vendedor entrara. Ahora
// el CRM le pide otra respuesta al MISMO modelo UNA vez con esta nota (va en el contexto, no en el system: la
// caché no cambia); si la nueva también trae texto interno, la tarjeta y la pausa de siempre. La nota no repite
// el texto malo para no dárselo al modelo como ejemplo.
export const INTERNAL_TEXT_RETRY_NOTE =
  "Tu respuesta anterior NO se le envió al cliente porque traía una nota interna escrita como texto (corchetes, «tool», el nombre de una herramienta, JSON o una nota para ti o para el sistema). Escribe otra vez tu respuesta solo con lo que el cliente debe leer. Si hace falta una acción (Detalle, cotización, etapa, aviso o un archivo), llama su herramienta en esta misma respuesta: no escribas que la vas a llamar.";

/** La respuesta completa en un renglón y recortada, para el registro (ai_usage.error). */
export function replyExcerpt(text: string, max = 500): string {
  const flat = text.trim().replace(/\s*\n+\s*/g, " ⏎ ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
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
      // La respuesta completa (10-oct-2026): antes solo quedaba el renglón malo y no se sabía si traía texto bueno.
      log: `texto interno (${internal.reason}): ${quote(internal.text)} — respuesta: «${replyExcerpt(parts.join("\n"))}»`,
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
