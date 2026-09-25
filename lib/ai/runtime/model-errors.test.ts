import { describe, expect, it } from "vitest";
import { agentErrorBody, classifyModelError } from "./model-errors";

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
    expect(classifyModelError(api(404, "model not found"), "Google").kind).toBe("modelo_no_existe");
    expect(classifyModelError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "OpenAI").kind).toBe("tiempo");
    const prefill = classifyModelError(api(400, "This model does not support assistant message prefill. The conversation must end with a user message."), "Anthropic");
    expect(prefill).toMatchObject({ kind: "conversacion", autoRetry: false });
    expect(prefill.resumen).toContain("rechazó la conversación (This model does not support assistant message prefill.");
  });

  it("RetryError del AI SDK: cuenta el último intento", () => {
    expect(classifyModelError({ name: "AI_RetryError", lastError: api(529, "Overloaded") }, "Anthropic").kind).toBe("saturado");
  });

  it("la tarjeta dice qué pasó, con qué modelo y qué hacer", () => {
    const body = agentErrorBody(classifyModelError(api(529, "Overloaded"), "Anthropic"), "Claude Sonnet 5", true);
    expect(body).toBe('El agente no pudo responder (Claude Sonnet 5). Anthropic está saturado o con fallas en este momento. Ya se reintentó una vez. El cliente sigue sin respuesta: elige "Reintentar" o "Apagar".');
  });
});
