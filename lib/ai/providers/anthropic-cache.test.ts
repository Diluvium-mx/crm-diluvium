import { describe, expect, it } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage } from "ai";
import { ANTHROPIC_CACHE_CONTROL, systemBlocks, withHistoryCacheBreakpoint } from "./anthropic-cache";

const cc = { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } };

describe("caché del historial (Anthropic)", () => {
  it("marca el mensaje justo antes del último turno del cliente, sin tocar el original", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿en qué te ayudo?" },
      { role: "user", content: "precio?" },
    ];
    const out = withHistoryCacheBreakpoint(msgs);
    expect(out[1].providerOptions).toEqual(cc);
    expect(out[0].providerOptions).toBeUndefined();
    expect(out[2].providerOptions).toBeUndefined();
    expect(msgs[1].providerOptions).toBeUndefined();
  });

  it("si después del último turno del cliente hay mensajes nuestros, marca antes de ese turno", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
    ];
    expect(withHistoryCacheBreakpoint(msgs)[1].providerOptions).toEqual(cc);
  });

  it("primer mensaje (un solo turno): nada que marcar", () => {
    const out = withHistoryCacheBreakpoint([{ role: "user", content: "hola" }]);
    expect(out[0].providerOptions).toBeUndefined();
  });

  it("con fotos o PDF (URL firmada estable toda la hora) el punto también va antes del último turno del cliente", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿en qué te ayudo?" },
      { role: "user", content: [{ type: "image", image: new URL("https://bucket.test/a.jpg?X-Amz-Date=1") }] },
      { role: "assistant", content: "¡Qué bonita entrada!" },
      { role: "user", content: "precio?" },
    ];
    const out = withHistoryCacheBreakpoint(msgs);
    expect(out[3].providerOptions).toEqual(cc);
    expect(out[1].providerOptions).toBeUndefined();
    // Aunque la foto esté en el primer mensaje.
    const first = withHistoryCacheBreakpoint([{ role: "user", content: [{ type: "image", image: new URL("https://x.test/b.jpg") }] }, { role: "assistant", content: "ok" }, { role: "user", content: "y?" }]);
    expect(first[1].providerOptions).toEqual(cc);
  });
});

describe("caché en dos partes: el system va en dos bloques con marca (11-nov-2026)", () => {
  it("sin corte o fuera de rango, un solo bloque; con corte, dos que juntos son el mismo texto", () => {
    expect(systemBlocks("GOAL\n\nFAQS")).toHaveLength(1);
    expect(systemBlocks("GOAL\n\nFAQS", 0)).toHaveLength(1);
    expect(systemBlocks("GOAL\n\nFAQS", 11)).toHaveLength(1);
    const b = systemBlocks("GOAL\n\nFAQS", 4);
    expect(b.map((m) => m.content)).toEqual(["GOAL", "\n\nFAQS"]);
    for (const m of b) expect(m.providerOptions?.anthropic?.cacheControl).toEqual(ANTHROPIC_CACHE_CONTROL);
  });

  it("lo que sale hacia Anthropic: dos bloques de texto, cada uno con cache_control de 1 h", async () => {
    let body: { system?: { type: string; text: string; cache_control?: unknown }[] } = {};
    const fetchFalso = async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const anthropic = createAnthropic({ apiKey: "prueba", fetch: fetchFalso as typeof fetch });
    await generateText({ model: anthropic("claude-sonnet-5-5"), system: systemBlocks("GOAL\n\nFAQS", 4), messages: [{ role: "user", content: "hola" }], maxRetries: 0 });
    expect(body.system).toEqual([
      { type: "text", text: "GOAL", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "\n\nFAQS", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
  });
});
