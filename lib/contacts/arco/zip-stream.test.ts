// Zip en streaming de la exportación (ARCO, 7-oct-2026) y comprobante del reintento de archivos.
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipStream, type ZipEntry } from "./zip-stream";
import { PendingFilesTokenError, signPendingFiles, verifyPendingFiles } from "./pending-files-token";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

describe("zip en streaming", () => {
  it("textos comprimidos y archivos por pedazos, en orden y completos", async () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: "datos.json", data: new TextEncoder().encode('{"nombre":"José"}\n') };
      yield { name: "chat.txt", data: new TextEncoder().encode("[2026-10-03 10:12] Cliente: Hola\n") };
      yield { name: "archivos/2026-10-03_1012_1-foto.jpg", body: streamOf([big.subarray(0, 100_000), big.subarray(100_000)]) };
    }
    const files = unzipSync(await collect(zipStream(entries())));
    expect(Object.keys(files)).toEqual(["datos.json", "chat.txt", "archivos/2026-10-03_1012_1-foto.jpg"]);
    expect(strFromU8(files["datos.json"])).toBe('{"nombre":"José"}\n');
    expect(strFromU8(files["chat.txt"])).toContain("Cliente: Hola");
    expect(files["archivos/2026-10-03_1012_1-foto.jpg"]).toEqual(big);
  });

  it("un archivo que falla a la mitad corta la descarga con error (nunca un zip corrupto como bueno)", async () => {
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: "datos.json", data: new TextEncoder().encode("{}") };
      yield {
        name: "archivos/x.jpg",
        body: new ReadableStream({
          pull(controller) {
            controller.error(new Error("se cayó el bucket"));
          },
        }),
      };
    }
    await expect(collect(zipStream(entries()))).rejects.toThrow("se cayó el bucket");
  });
});

describe("comprobante para reintentar el borrado de archivos", () => {
  const previous = process.env.BETTER_AUTH_SECRET;
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "secreto-de-pruebas-arco-0123456789";
  });
  afterAll(() => {
    process.env.BETTER_AUTH_SECRET = previous;
  });

  it("solo sirve a la misma organización y usuario, sin alterarlo y por 7 días", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const token = signPendingFiles({ organizationId: "org_a", userId: "u1", keys: ["org/org_a/messages/m1/0-a.jpg"], issuedAt: now });
    expect(verifyPendingFiles(token, { organizationId: "org_a", userId: "u1", now }).keys).toEqual(["org/org_a/messages/m1/0-a.jpg"]);
    expect(() => verifyPendingFiles(token, { organizationId: "org_b", userId: "u1", now })).toThrow(PendingFilesTokenError);
    expect(() => verifyPendingFiles(token, { organizationId: "org_a", userId: "u2", now })).toThrow(PendingFilesTokenError);
    expect(() => verifyPendingFiles(token, { organizationId: "org_a", userId: "u1", now: now + 8 * 24 * 3_600_000 })).toThrow(PendingFilesTokenError);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, o: "org_a", u: "u1", k: ["org/org_a/library/a1-tabla.jpg"], t: now })).toString("base64url");
    expect(() => verifyPendingFiles(`${forged}.${sig}`, { organizationId: "org_a", userId: "u1", now })).toThrow(PendingFilesTokenError);
    expect(() => verifyPendingFiles(`${body}.x`, { organizationId: "org_a", userId: "u1", now })).toThrow(PendingFilesTokenError);
  });
});
