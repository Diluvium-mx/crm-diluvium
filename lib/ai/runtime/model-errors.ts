// Errores del modelo en palabras simples (Fase E, "reenvío seguro", 25-sep-2026).
// Decisión del dueño: si el modelo falla, el CRM NO lo vuelve a llamar solo (gasto
// y riesgo de duplicar); deja una tarjeta en el chat con el error explicado y los
// botones "Reintentar" y "Apagar". Única excepción: si el proveedor está SATURADO
// (pasa en segundos) se reintenta UNA vez automáticamente. PURO (sin BD).
// Se clasifica por forma (statusCode, name, mensaje) y no por clase: los errores
// del AI SDK, de fetch y los nuestros (lib/ai/index.ts) llegan distintos.

export type ModelErrorKind =
  | "saturado" // 408/409/429 sin saldo/5xx/529: el proveedor no pudo atender ahora
  | "sin_saldo" // se acabó el crédito o llegó al límite de gasto
  | "sin_llave" // falta la variable de la llave en Railway
  | "llave_invalida" // 401/403
  | "modelo_no_existe" // 404
  | "tiempo" // no contestó a tiempo
  | "conversacion" // 400: el proveedor rechazó lo que le mandamos
  | "vacia" // contestó sin texto ni acciones
  | "otro";

export type ModelErrorInfo = { kind: ModelErrorKind; resumen: string; autoRetry: boolean };

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  statusCode?: unknown;
  responseBody?: unknown;
  lastError?: unknown;
  envKey?: unknown;
  cause?: unknown;
};

const asObj = (e: unknown): ErrorLike => (e && typeof e === "object" ? (e as ErrorLike) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Texto técnico corto del proveedor (para la tarjeta, entre paréntesis).
function detalle(e: ErrorLike): string {
  const raw = str(e.message) || str(e.responseBody);
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}…` : oneLine;
}

// Llave mal copiada o revocada: xAI lo manda como 400 "invalid-argument" (visto el
// 25-sep-2026 con una GROK_API_KEY equivocada), otros como 401/403.
const LLAVE_INVALIDA = /incorrect api key|invalid api key|invalid x-api-key|api key not valid|invalid_api_key|api key is invalid/i;
// Solo textos inequívocos de falta de crédito (un 429 de límite de peticiones que
// menciona "billing" en su URL NO es falta de saldo: es saturación).
const SIN_SALDO = /insufficient[_ ]quota|credit balance|balance is too low|payment required|out of credits|insufficient credits|spending limit/i;

export function classifyModelError(error: unknown, providerLabel: string): ModelErrorInfo {
  let e = asObj(error);
  // RetryError del AI SDK: lo que cuenta es el último intento.
  if (e.lastError) e = asObj(e.lastError);
  const name = str(e.name);
  const status = typeof e.statusCode === "number" ? e.statusCode : null;
  const text = `${str(e.message)} ${str(e.responseBody)}`;

  if (name === "ModelNotConfiguredError") {
    return { kind: "sin_llave", resumen: `Falta la llave ${str(e.envKey) || `de ${providerLabel}`} en Railway.`, autoRetry: false };
  }
  // Sin código HTTP: nuestro tope de tiempo o una falla de red (no se reintenta solo:
  // el proveedor pudo haber procesado y cobrado la llamada).
  if (status === null && (name === "TimeoutError" || name === "AbortError" || /timed? ?out|aborted/i.test(text))) {
    return { kind: "tiempo", resumen: `${providerLabel} tardó demasiado en responder.`, autoRetry: false };
  }
  if (status === 402 || SIN_SALDO.test(text)) {
    return { kind: "sin_saldo", resumen: `Se acabó el saldo de ${providerLabel} (o llegó a su límite de gasto). Recarga saldo y dale Reintentar.`, autoRetry: false };
  }
  if (status === 401 || status === 403 || LLAVE_INVALIDA.test(text)) {
    return { kind: "llave_invalida", resumen: `La llave de ${providerLabel} no es válida o no tiene permiso. Revísala en Railway.`, autoRetry: false };
  }
  if (status === 404) {
    return { kind: "modelo_no_existe", resumen: `${providerLabel} no reconoce el modelo elegido. Elige otro en la pestaña Agente IA.`, autoRetry: false };
  }
  if (status !== null && (status === 408 || status === 409 || status === 429 || status >= 500)) {
    return { kind: "saturado", resumen: `${providerLabel} está saturado o con fallas en este momento.`, autoRetry: true };
  }
  if (status === 400 || status === 413 || status === 422) {
    const d = detalle(e);
    return { kind: "conversacion", resumen: `${providerLabel} rechazó la conversación${d ? ` (${d})` : ""}.`, autoRetry: false };
  }
  const d = detalle(e);
  return { kind: "otro", resumen: `Error inesperado${d ? `: ${d}` : ""}.`, autoRetry: false };
}

export const EMPTY_RESPONSE_INFO: ModelErrorInfo = { kind: "vacia", resumen: "El modelo contestó sin texto ni acciones.", autoRetry: false };

// Texto de la tarjeta 🤖 que ve el vendedor.
export function agentErrorBody(info: ModelErrorInfo, modelLabel: string, retried: boolean): string {
  return `El agente no pudo responder (${modelLabel}). ${info.resumen}${retried ? " Ya se reintentó una vez." : ""} El cliente sigue sin respuesta: elige "Reintentar" o "Apagar".`;
}

// ── Falla al ENVIAR la respuesta por WhatsApp (Fase E, 25-sep; parte 1, 26-sep-2026) ───
// El modelo sí contestó, pero el primer mensaje no salió. Antes la cola reintentaba 3
// veces (y el barrido hasta 5): cada intento pagaba OTRA llamada al modelo y dejaba otra
// burbuja fallida con distinto texto. Desde la parte 1 CUALQUIER falla del 1er mensaje
// deja la respuesta GUARDADA (lib/ai/runtime/saved-reply.ts) y la tarjeta con el motivo
// y "Reintentar" (reenvía el MISMO texto, sin volver a llamar al modelo) / "Apagar".
// Un resultado DUDOSO (timeout, 5xx) no llega aquí: queda "pendiente" y el outbox lo
// concilia sin reenviar.
const SEND_REJECTED_TEXT: Record<string, string> = {
  window_closed: "La ventana de 24 h de WhatsApp ya cerró: solo se puede mandar una plantilla.",
  channel_unavailable: "El canal de WhatsApp de esta conversación no está disponible.",
  not_linked: "La conversación aún no está enlazada con el proveedor de WhatsApp.",
  empty: "La respuesta del agente no es válida para WhatsApp (vacía o demasiado larga).",
  not_found: "La conversación ya no existe.",
  not_retryable: "WhatsApp no confirmó si la respuesta le llegó al cliente: revísalo en el celular antes de reintentar (podría llegarle dos veces).",
};

// Motivo en palabras simples de un rechazo CONOCIDO, o null. Por FORMA y no por nombre:
// el rechazo real de Zernio llega como ZernioSendError (subclase de SendFailedError) y,
// clasificado solo por nombre, caía como "no clasificado" y relanzaba el job (el 400 de
// la simulación de Anuncios del 24-sep: 3 respuestas distintas).
export function classifySendError(error: unknown): string | null {
  const e = asObj(error);
  const name = str(e.name);
  const code = str((e as { code?: unknown }).code);
  if (name === "SendRejectedError") return SEND_REJECTED_TEXT[code] ?? `El CRM no pudo enviar el mensaje (${detalle(e) || code}).`;
  if ((e as { outcome?: unknown }).outcome === "rejected") {
    const d = detalle(e);
    return `WhatsApp rechazó el mensaje${d ? ` (${d})` : ""}.`;
  }
  return null;
}

// Cualquier otra falla del envío (la BD, un error raro del proveedor): mismo trato.
export function sendErrorMotive(error: unknown): string {
  const known = classifySendError(error);
  if (known) return known;
  const d = detalle(asObj(error));
  return `Error inesperado al enviar${d ? `: ${d}` : ""}.`;
}

export function sendErrorBody(motivo: string): string {
  return `El agente no pudo enviar su respuesta por WhatsApp. ${motivo} La respuesta quedó guardada y el cliente sigue sin ella: "Reintentar" le manda ese mismo texto; "Apagar" la descarta y apaga al agente en esta conversación.`;
}
