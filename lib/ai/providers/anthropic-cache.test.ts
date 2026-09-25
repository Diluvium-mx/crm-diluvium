import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { withHistoryCacheBreakpoint } from "./anthropic-cache";

const cc = { anthropic: { cacheControl: { type: "ephemeral" } } };

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

  it("con fotos o PDF (URL firmada que cambia) el punto va antes del primer mensaje con archivo", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿en qué te ayudo?" },
      { role: "user", content: [{ type: "image", image: new URL("https://bucket.test/a.jpg?X-Amz-Date=1") }] },
      { role: "assistant", content: "¡Qué bonita entrada!" },
      { role: "user", content: "precio?" },
    ];
    const out = withHistoryCacheBreakpoint(msgs);
    expect(out[1].providerOptions).toEqual(cc);
    expect(out[3].providerOptions).toBeUndefined();
    // Si la primera foto está en el primer mensaje, no hay nada estable que cachear.
    const first = withHistoryCacheBreakpoint([{ role: "user", content: [{ type: "image", image: new URL("https://x.test/b.jpg") }] }, { role: "assistant", content: "ok" }, { role: "user", content: "y?" }]);
    expect(first.every((m) => m.providerOptions === undefined)).toBe(true);
  });
});
