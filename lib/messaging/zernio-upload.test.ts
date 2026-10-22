// Copia de respaldo de la Biblioteca en Zernio (envío blindado, 22-oct-2026): presign + PUT.
import { describe, expect, it } from "vitest";
import { ZernioApiError, ZernioProvider } from "./zernio";

const UPLOAD = "https://bucket.r2.cloudflarestorage.com/temp/123_tabla.jpeg?X-Amz-Signature=abc";
const PUBLIC = "https://media.zernio.com/temp/123_tabla.jpeg";

function fakeFetch(presign: () => Response, put: () => Response) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
    return url.endsWith("/v1/media/presign") ? presign() : put();
  }) as typeof fetch;
  return { impl, calls };
}

const body = new Uint8Array([1, 2, 3, 4]);

describe("ZernioProvider.uploadMedia", () => {
  it("pide la URL con la llave y sube el archivo SIN la llave", async () => {
    const { impl, calls } = fakeFetch(
      () => Response.json({ uploadUrl: UPLOAD, publicUrl: PUBLIC, key: "temp/123_tabla.jpeg", expiresIn: 3600 }),
      () => new Response(null, { status: 200 }),
    );
    const p = new ZernioProvider({ apiKey: "sk_test", webhookSecret: "s" }, impl);
    await expect(p.uploadMedia({ body, fileName: "tabla.jpeg", contentType: "image/jpeg" })).resolves.toEqual({ publicUrl: PUBLIC });
    expect(calls[0]).toMatchObject({ url: "https://zernio.com/api/v1/media/presign", method: "POST", headers: { Authorization: "Bearer sk_test" } });
    expect(JSON.parse(String(calls[0].body))).toEqual({ filename: "tabla.jpeg", contentType: "image/jpeg", size: 4 });
    expect(calls[1]).toMatchObject({ url: UPLOAD, method: "PUT", headers: { "Content-Type": "image/jpeg" } });
    expect(calls[1].headers).not.toHaveProperty("Authorization");
  });

  it("Zernio no da una URL https: error, sin subir nada", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ uploadUrl: "http://interno/x", publicUrl: PUBLIC }), () => new Response(null));
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, impl);
    await expect(p.uploadMedia({ body, fileName: "a.jpeg", contentType: "image/jpeg" })).rejects.toBeInstanceOf(ZernioApiError);
    expect(calls).toHaveLength(1);
  });

  it("el almacenamiento rechaza la subida: error con el código", async () => {
    const { impl } = fakeFetch(() => Response.json({ uploadUrl: UPLOAD, publicUrl: PUBLIC }), () => new Response("no", { status: 403 }));
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, impl);
    await expect(p.uploadMedia({ body, fileName: "a.jpeg", contentType: "image/jpeg" })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("tipo no aceptado (400 de Zernio): error de la API", async () => {
    const { impl } = fakeFetch(() => Response.json({ error: { code: "INVALID_FIELD_VALUE", message: "contentType" } }, { status: 400 }), () => new Response(null));
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, impl);
    await expect(p.uploadMedia({ body, fileName: "a.docx", contentType: "application/msword" })).rejects.toMatchObject({ httpStatus: 400 });
  });
});
