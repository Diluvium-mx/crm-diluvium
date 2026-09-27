import { describe, expect, it } from "vitest";
import { agentErrorBody, bothModelsFailedBody, classifyModelError, classifySendError, EMPTY_RESPONSE_INFO, sendErrorBody, sendErrorMotive } from "./model-errors";

const api = (statusCode: number, message: string, responseBody = "") => Object.assign(new Error(message), { name: "AI_APICallError", statusCode, responseBody });

describe("errores del modelo en palabras simples", () => {
  it("saturado (429 sin saldo, 5xx, 529) → único que se reintenta solo", () => {
    for (const s of [429, 500, 503, 529]) expect(classifyModelError(api(s, "Overloaded"), "Anthropic")).toMatchObject({ kind: "saturado", autoRetry: true });
  });

  it("sin saldo: 402, insufficient_quota de OpenAI o 'credit balance is too low' de Anthropic → no se reintenta", () => {
    expect(classifyModelError(api(402, "Payment Required"), "OpenRouter").kind).toBe("sin_saldo");
    expect(classifyModelError(api(429, "You exceeded your current quota", '{"error":{"code":"insufficient_quota"}}'), "OpenAI")).toMatchObject({ kind: "sin_saldo", autoRetry: false });
    expect(classifyModelError(api(400, "Your credit balance is too low to access the Anthropic API."), "Anthropic").kind).toBe("sin_saldo");
  });

  it("llave faltante, llave inválida, modelo inexistente, tiempo y conversación rechazada", () => {
    expect(classifyModelError(Object.assign(new Error("x"), { name: "ModelNotConfiguredError", envKey: "GROK_API_KEY" }), "xAI").resumen).toBe("Falta la llave GROK_API_KEY en Railway.");
    expect(classifyModelError(api(401, "invalid x-api-key"), "Anthropic").kind).toBe("llave_invalida");
    // xAI con una llave mal copiada: 400 "invalid-argument", no "rechazó la conversación".
    expect(classifyModelError(api(400, "invalid-argument: Incorrect API key provided. You can obtain an API key from https://console.x.ai."), "xAI").kind).toBe("llave_invalida");
    expect(classifyModelError(api(404, "model not found"), "Google").kind).toBe("modelo_no_existe");
    expect(classifyModelError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "OpenAI").kind).toBe("tiempo");
    const prefill = classifyModelError(api(400, "This model does not support assistant message prefill. The conversation must end with a user message."), "Anthropic");
    expect(prefill).toMatchObject({ kind: "conversacion", autoRetry: false });
    expect(prefill.resumen).toContain("rechazó la conversación (This model does not support assistant message prefill.");
  });

  it("504 Gateway Timeout y 429 de límite de peticiones (con 'billing' en la URL) son saturación, no tiempo ni falta de saldo", () => {
    expect(classifyModelError(api(504, "Gateway Timeout"), "Google")).toMatchObject({ kind: "saturado", autoRetry: true });
    expect(classifyModelError(api(429, "Rate limit reached for requests. Visit https://platform.openai.com/account/billing"), "OpenAI")).toMatchObject({ kind: "saturado", autoRetry: true });
  });

  it("RetryError del AI SDK: cuenta el último intento", () => {
    expect(classifyModelError({ name: "AI_RetryError", lastError: api(529, "Overloaded") }, "Anthropic").kind).toBe("saturado");
  });

  it("la tarjeta dice qué pasó, con qué modelo y qué hacer", () => {
    const body = agentErrorBody(classifyModelError(api(529, "Overloaded"), "Anthropic"), "Claude Sonnet 5", true);
    expect(body).toBe('El agente no pudo responder (Claude Sonnet 5). Anthropic está saturado o con fallas en este momento. Ya se reintentó una vez. El cliente sigue sin respuesta: elige "Reintentar" o "Apagar".');
  });

  it("envío rechazado de forma definitiva → motivo simple; lo dudoso → null; cualquier otra falla → \"Error inesperado\" (parte 1: nunca relanza)", () => {
    const rejected = (code: string, message: string) => Object.assign(new Error(message), { name: "SendRejectedError", code });
    expect(classifySendError(rejected("window_closed", "La ventana de 24 h está cerrada"))).toBe("La ventana de 24 h de WhatsApp ya cerró: solo se puede mandar una plantilla.");
    expect(classifySendError(Object.assign(new Error("recipient not allowed"), { name: "SendFailedError", code: "131030", outcome: "rejected" }))).toBe("WhatsApp rechazó el mensaje (recipient not allowed).");
    expect(classifySendError(Object.assign(new Error("timeout"), { name: "SendFailedError", code: "x", outcome: "unknown" }))).toBeNull();
    expect(classifySendError(new Error("connection terminated"))).toBeNull();
    expect(sendErrorBody("Motivo.")).toBe(
      'El agente no pudo enviar su respuesta por WhatsApp. Motivo. La respuesta quedó guardada y el cliente sigue sin ella: "Reintentar" le manda ese mismo texto; "Apagar" la descarta y apaga al agente en esta conversación.',
    );
    // Parte 1: el rechazo REAL de Zernio llega como subclase (ZernioSendError); antes se
    // quedaba sin clasificar por el nombre y el job se relanzaba (3 respuestas distintas).
    expect(classifySendError(Object.assign(new Error("Re-engagement message"), { name: "ZernioSendError", code: "131047", outcome: "rejected" }))).toBe("WhatsApp rechazó el mensaje (Re-engagement message).");
    expect(sendErrorMotive(new Error("Connection terminated unexpectedly"))).toBe("Error inesperado al enviar: Connection terminated unexpectedly.");
    expect(sendErrorMotive(Object.assign(new Error("x"), { name: "SendRejectedError", code: "not_retryable" }))).toContain("revísalo en el celular");
  });

  it("27-sep: si fallan los dos modelos, la tarjeta dice qué le pasó a cada uno", () => {
    const body = bothModelsFailedBody([
      { label: "GPT-5.6 Luna", info: classifyModelError(api(401, "Incorrect API key provided"), "OpenAI") },
      { label: "Claude Sonnet 5", info: EMPTY_RESPONSE_INFO },
    ]);
    expect(body).toMatch(/^El agente no pudo responder: fallaron los dos modelos\. GPT-5\.6 Luna: .+ Claude Sonnet 5: El modelo contestó sin texto ni acciones\. /);
    expect(body).toContain('elige "Reintentar" o "Apagar"');
  });
});
