// Cliente de prueba de staging (30-oct-2026): dónde existe y qué intercepta.
import { describe, expect, it, vi } from "vitest";
import type { MessagingProvider, SendResult } from "./provider";
import { conSimulador, SIMULADOR, simuladorActivo, webhookDelCliente } from "./simulador";
import { ZernioProvider } from "./zernio";

describe("cliente de prueba de staging", () => {
  it("solo en staging de Railway o local sin Railway; producción nunca", () => {
    expect(simuladorActivo({ RAILWAY_ENVIRONMENT_NAME: "staging", NODE_ENV: "production" })).toBe(true);
    expect(simuladorActivo({ RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "production" })).toBe(false);
    expect(simuladorActivo({ RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "development" })).toBe(false);
    expect(simuladorActivo({ NODE_ENV: "development" })).toBe(true);
    expect(simuladorActivo({ NODE_ENV: "test" })).toBe(true);
    expect(simuladorActivo({ NODE_ENV: "production" })).toBe(false);
  });

  it("lo que va a la cuenta simulada no llama al proveedor; lo demás, sí", async () => {
    const real = vi.fn(async (): Promise<SendResult> => ({ providerInternalId: "z1", providerMessageId: "wamid.real" }));
    const p = conSimulador({ name: "zernio", sendText: real, sendTemplate: real, sendMedia: real } as unknown as MessagingProvider);
    const target = { providerConversationId: "c", platform: "whatsapp" as const, humanAgentTag: false, idempotencyKey: "k", text: "hola" };
    const sim = await p.sendText({ ...target, providerAccountId: SIMULADOR.accountId });
    expect(sim.providerMessageId).toMatch(/^wamid\.sim\./);
    expect(real).not.toHaveBeenCalled();
    expect(await p.sendText({ ...target, providerAccountId: "zacc_real" })).toEqual({ providerInternalId: "z1", providerMessageId: "wamid.real" });
    expect(real).toHaveBeenCalledTimes(1);
    expect(p.name).toBe("zernio");
  });

  it("el mensaje del cliente tiene la forma de un webhook de Zernio (lo normaliza el adaptador real)", () => {
    const { event, payload } = webhookDelCliente("Hola, ¿cuánto cuesta?");
    expect(event).toBe("message.received");
    const normalized = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }).normalize(payload);
    expect(normalized).toMatchObject({ kind: "message", providerAccountId: SIMULADOR.accountId, providerConversationId: SIMULADOR.providerConversationId, direction: "in", source: "contact", contactPhone: SIMULADOR.phone, body: "Hola, ¿cuánto cuesta?" });
  });
});
