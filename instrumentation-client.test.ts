// La CSP no permite 'unsafe-eval': en el navegador Zod debe validar sin evaluar
// código (instrumentation-client.ts). Si una versión nueva de Zod ignorara
// `jitless`, esta prueba lo detecta antes de que vuelva el aviso en la consola.
import { afterEach, describe, expect, it } from "vitest";
import { config } from "zod/v4/core";

const NativeFunction = globalThis.Function;

afterEach(() => {
  globalThis.Function = NativeFunction;
});

describe("instrumentation-client: Zod sin evaluar código en el navegador", () => {
  it("activa jitless", async () => {
    await import("./instrumentation-client");
    expect(config().jitless).toBe(true);
  });

  it("crear y validar un z.object no llama a Function", async () => {
    await import("./instrumentation-client");
    const calls: string[] = [];
    globalThis.Function = new Proxy(NativeFunction, {
      apply(target, self, args) {
        calls.push("Function()");
        return Reflect.apply(target, self, args);
      },
      construct(target, args) {
        calls.push("new Function()");
        return Reflect.construct(target, args);
      },
    });
    const { z } = await import("zod");
    const schema = z.object({ question: z.string().trim().min(1), enabled: z.boolean().default(true) });
    expect(schema.safeParse({ question: " Hola " })).toEqual({ success: true, data: { question: "Hola", enabled: true } });
    expect(schema.safeParse({ question: "" }).success).toBe(false);
    expect(calls).toEqual([]);
  });
});
