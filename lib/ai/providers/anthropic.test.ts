import { describe, expect, it } from "vitest";
import { cacheWrite1hTokens } from "./anthropic";

describe("escritura en la caché de 1 h (uso crudo de Anthropic)", () => {
  it("lee usage.cache_creation.ephemeral_1h_input_tokens", () => {
    expect(cacheWrite1hTokens({ anthropic: { usage: { cache_creation: { ephemeral_1h_input_tokens: 18_903, ephemeral_5m_input_tokens: 0 } } } })).toBe(18_903);
  });

  it("sin desglose (o con un valor raro) → null: se cobra como escritura de 5 min", () => {
    expect(cacheWrite1hTokens(undefined)).toBeNull();
    expect(cacheWrite1hTokens({ anthropic: { usage: {} } })).toBeNull();
    expect(cacheWrite1hTokens({ anthropic: { usage: { cache_creation: { ephemeral_1h_input_tokens: "x" } } } })).toBeNull();
  });
});
