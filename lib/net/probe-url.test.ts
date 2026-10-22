// Prueba de un enlace antes de mandarlo (envío blindado, 22-oct-2026): solo el primer byte, como
// lo pediría WhatsApp; nunca lanza.
import { describe, expect, it } from "vitest";
import { probeUrl } from "./probe-url";

function fetchReturning(make: () => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return make();
  }) as typeof fetch;
  return { impl, calls };
}

describe("probeUrl", () => {
  it.each([200, 206])("%i = el enlace entrega el archivo", async (status) => {
    const { impl, calls } = fetchReturning(() => new Response("x", { status }));
    await expect(probeUrl("https://bucket.example/a.png?firma=1", impl)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ url: "https://bucket.example/a.png?firma=1", headers: { Range: "bytes=0-0" } }]);
  });

  it("403 (firma con la llave vieja, como el 21-oct) = no sirve, con el motivo", async () => {
    const { impl } = fetchReturning(() => new Response("SignatureDoesNotMatch", { status: 403 }));
    await expect(probeUrl("https://bucket.example/a.png", impl)).resolves.toEqual({ ok: false, reason: "respondió 403" });
  });

  it("sin respuesta = no sirve; no lanza", async () => {
    const { impl } = fetchReturning(() => Promise.reject(new Error("ECONNRESET")));
    await expect(probeUrl("https://bucket.example/a.png", impl)).resolves.toEqual({ ok: false, reason: "no respondió (ECONNRESET)" });
  });
});
