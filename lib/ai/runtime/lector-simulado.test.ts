import { describe, expect, it } from "vitest";
import { LECTOR_TOOL } from "./lector-core";
import { BORRADOR_REHECHO, esLecturaSimulada, FICHA_DE_PRUEBA, lectorSimulado } from "./lector-simulado";
import { SIMULADOR } from "@/lib/messaging/simulador";

const tools = (name: string) => ({ [name]: {} }) as never;

describe("lector del Cliente de prueba sin IA", () => {
  it("solo el chat del simulador (con el simulador activo) se lee sin IA", () => {
    expect(esLecturaSimulada({ providerAccountId: SIMULADOR.accountId })).toBe(true);
    expect(esLecturaSimulada({ providerAccountId: "zacc_real" })).toBe(false);
  });

  it("con ficha pedida: devuelve la ficha de ejemplo y 0 tokens", async () => {
    const r = await lectorSimulado(true)("gpt-5.6-luna", { system: "", messages: [], tools: tools(LECTOR_TOOL) });
    expect(r.toolCalls).toEqual([{ toolName: LECTOR_TOOL, input: { seguimiento: FICHA_DE_PRUEBA } }]);
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("sin ficha pedida: no toca el Detalle; el borrador rehecho es otro fijo", async () => {
    expect((await lectorSimulado(false)("gpt-5.6-luna", { system: "", messages: [], tools: tools(LECTOR_TOOL) })).toolCalls).toEqual([{ toolName: LECTOR_TOOL, input: {} }]);
    const rehecho = await lectorSimulado(true)("gpt-5.6-luna", { system: "", messages: [], tools: tools("reescribir_borrador") });
    expect(rehecho.toolCalls).toEqual([{ toolName: "reescribir_borrador", input: { borrador: BORRADOR_REHECHO } }]);
  });
});
