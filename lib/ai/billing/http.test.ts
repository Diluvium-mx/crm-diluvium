import { describe, expect, it } from "vitest";
import { BillingHttpError, getJson, redactKeys, type FetchLike } from "./http";

describe("redactKeys", () => {
  it("oculta llaves de Anthropic, OpenRouter y xAI", () => {
    const text = "sk-ant-admin01-xxxx sk-or-v1-xxxx xai-xxxx";
    expect(redactKeys(text)).toBe("[llave oculta] [llave oculta] [llave oculta]");
  });
});

describe("getJson", () => {
  it("devuelve el JSON de una respuesta exitosa", async () => {
    const fetchImpl: FetchLike = async () => new Response('{"ok":true}');
    await expect(getJson(fetchImpl, "https://billing.example.test/report", {})).resolves.toEqual({ ok: true });
  });

  it("en no-2xx arroja BillingHttpError con status, host y cuerpo corto sin la llave", async () => {
    const key = "sk-ant-admin01-xxxx";
    const body = `falló ${key} ${"detalle ".repeat(80)}`;
    const fetchImpl: FetchLike = async () => new Response(body, { status: 429 });

    const error = await getJson(fetchImpl, "https://billing.example.test/v1/report", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BillingHttpError);
    if (!(error instanceof BillingHttpError)) throw new Error("Se esperaba BillingHttpError");
    expect(error.status).toBe(429);
    expect(error.message).toContain("billing.example.test respondió 429");
    expect(error.message).toContain("[llave oculta]");
    expect(error.message).not.toContain(key);
    expect(error.message.length).toBeLessThan(body.length);
  });

  it("reporta JSON inválido sin incluir la URL completa", async () => {
    const fetchImpl: FetchLike = async () => new Response("no es json");
    await expect(getJson(fetchImpl, "https://billing.example.test/v1/report", {})).rejects.toMatchObject({
      status: 200,
      message: "billing.example.test respondió algo que no es JSON",
    });
  });
});
