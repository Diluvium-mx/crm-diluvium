// «Luna callada» (19-nov-2026): lo que el adaptador de OpenAI le manda a la API Responses en la segunda
// vuelta. Sin llamadas reales (regla del dueño, sin bancos con modelos): `fetch` es un doble que guarda la
// petición y contesta como la API. Así se comprueba el formato exacto que verá OpenAI: su razonamiento y su
// llamada de la primera vuelta, «listo» como resultado de esa llamada y tool_choice "none".
import { tool, type ModelMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { continuationMessages } from "@/lib/ai/runtime/continuacion";
import { openaiAdapter } from "./openai";

const usage = { input_tokens: 1_000, input_tokens_details: { cached_tokens: 900 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 30 } };

// Primera vuelta: Luna razona y pide UNA acción, sin mensaje (el caso de producción).
const soloAcciones = {
  id: "resp_1",
  created_at: 1_763_500_000,
  model: "gpt-5.6-luna",
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "mover_etapa", arguments: '{"etapa":"prospecto"}', status: "completed" },
  ],
  usage,
};
// Segunda vuelta: el mensaje para el cliente.
const conTexto = {
  id: "resp_2",
  created_at: 1_763_500_010,
  model: "gpt-5.6-luna",
  output: [
    { type: "reasoning", id: "rs_2", summary: [] },
    { type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Entiendo. ¿Cuánto mide de ancho su entrada?", annotations: [] }] },
  ],
  usage,
};

function fakeFetch(replies: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const fn = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fn, bodies };
}

const tools = { mover_etapa: tool({ description: "Mueve al contacto de etapa.", inputSchema: z.object({ etapa: z.string() }) }) };
const leido: ModelMessage[] = [{ role: "user", content: "Sí, normalmente en septiembre y octubre" }];

afterEach(() => vi.unstubAllGlobals());

describe("adaptador OpenAI: continuación con «listo» (Luna callada)", () => {
  it("la primera vuelta devuelve sus acciones y su respuesta; la segunda manda razonamiento + llamada + «listo» con tool_choice none", async () => {
    const { fn, bodies } = fakeFetch([soloAcciones, conTexto]);
    vi.stubGlobal("fetch", fn);

    const first = await openaiAdapter.generate("gpt-5.6-luna", "sk-prueba", { system: "Eres Ángela.", messages: leido, tools });
    expect(first.text).toBe("");
    expect(first.toolCalls).toEqual([{ toolName: "mover_etapa", input: { etapa: "prospecto" } }]);
    expect(first.responseMessages?.length).toBeGreaterThan(0);
    // Sin toolChoice, el de siempre ("auto": puede pedir acciones).
    expect(bodies[0].tool_choice).toBe("auto");

    const messages = continuationMessages(leido, first.responseMessages);
    expect(messages).not.toBeNull();
    const second = await openaiAdapter.generate("gpt-5.6-luna", "sk-prueba", { system: "Eres Ángela.", messages: messages!, tools, toolChoice: "none" });
    expect(second.text).toBe("Entiendo. ¿Cuánto mide de ancho su entrada?");
    expect(second.toolCalls).toEqual([]);

    const body = bodies[1];
    expect(body.tool_choice).toBe("none");
    // Las mismas herramientas (misma caché del prompt en OpenAI).
    expect(JSON.stringify(body.tools)).toBe(JSON.stringify(bodies[0].tools));
    const input = body.input as Record<string, unknown>[];
    // Exactamente: instrucciones, lo que leyó, su llamada y «listo» como resultado. Sin su razonamiento ni
    // ids internos (rs_…, fc_…): con ellos OpenAI a veces rechaza la petición (continuacion.ts).
    expect(input).toEqual([
      { role: "developer", content: "Eres Ángela." },
      { role: "user", content: [{ type: "input_text", text: "Sí, normalmente en septiembre y octubre" }] },
      { type: "function_call", call_id: "call_1", name: "mover_etapa", arguments: '{"etapa":"prospecto"}' },
      { type: "function_call_output", call_id: "call_1", output: "listo" },
    ]);
    expect(JSON.stringify(input)).not.toMatch(/rs_1|fc_1|item_reference/);
  });
});
