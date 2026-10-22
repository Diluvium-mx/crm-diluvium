// De dónde sale un archivo de la Biblioteca (envío blindado, 22-oct-2026): bucket probado, luego
// la copia en Zernio; sin ninguno, los motivos.
import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";
import { pickMediaSource, zernioCopyUsable, ZERNIO_COPY_VALID_MS, type MediaAssetSource } from "./media-source";

const NOW = new Date("2026-10-22T18:00:00Z");
const COPY = "https://media.zernio.com/temp/123_tabla.jpeg";

function asset(over: Partial<MediaAssetSource> = {}): MediaAssetSource {
  return { storageKey: "org/o1/library/a1-tabla", fileName: "tabla.jpeg", mimeType: "image/jpeg", zernioCopyUrl: COPY, zernioCopyAt: new Date(NOW.getTime() - 86_400_000), ...over };
}

function storage(opts: { probe?: "ok" | "403"; signFails?: boolean; noProbe?: boolean } = {}): ObjectStorage {
  const base = {
    signedGetUrl: async () => {
      if (opts.signFails) throw new Error("sin credenciales");
      return "https://t3.storageapi.dev/bucket/org/o1/library/a1-tabla?firma=1";
    },
  };
  const probe = opts.noProbe
    ? {}
    : { probeSignedUrl: async () => (opts.probe === "403" ? { ok: false as const, reason: "respondió 403" } : { ok: true as const }) };
  return { ...base, ...probe } as unknown as ObjectStorage;
}

function zernioFetch(status: number) {
  const calls: string[] = [];
  const impl = (async (input: URL | string) => {
    calls.push(String(input));
    return new Response("x", { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("zernioCopyUsable", () => {
  it("vigente hasta los 6.5 días (Zernio la borra a los 7)", () => {
    expect(zernioCopyUsable(asset({ zernioCopyAt: new Date(NOW.getTime() - ZERNIO_COPY_VALID_MS + 1000) }), NOW)).toBe(true);
    expect(zernioCopyUsable(asset({ zernioCopyAt: new Date(NOW.getTime() - ZERNIO_COPY_VALID_MS) }), NOW)).toBe(false);
  });

  it("sin copia, no", () => {
    expect(zernioCopyUsable(asset({ zernioCopyUrl: null, zernioCopyAt: null }), NOW)).toBe(false);
  });
});

describe("pickMediaSource", () => {
  it("el bucket responde: sale del bucket y no se toca Zernio", async () => {
    const z = zernioFetch(200);
    const picked = await pickMediaSource({ storage: storage({ probe: "ok" }), asset: asset(), now: NOW, fetchImpl: z.impl });
    expect(picked).toEqual({ url: "https://t3.storageapi.dev/bucket/org/o1/library/a1-tabla?firma=1", origin: "bucket" });
    expect(z.calls).toEqual([]);
  });

  it("el bucket da 403 (llaves cambiadas, 21-oct): sale desde la copia en Zernio", async () => {
    const z = zernioFetch(206);
    const picked = await pickMediaSource({ storage: storage({ probe: "403" }), asset: asset(), now: NOW, fetchImpl: z.impl });
    expect(picked).toEqual({ url: COPY, origin: "zernio" });
    expect(z.calls).toEqual([COPY]);
  });

  it("no se pudo ni firmar: también sale desde Zernio", async () => {
    const picked = await pickMediaSource({ storage: storage({ signFails: true }), asset: asset(), now: NOW, fetchImpl: zernioFetch(200).impl });
    expect(picked).toEqual({ url: COPY, origin: "zernio" });
  });

  it("ninguno entrega: sin URL y con el motivo de cada uno", async () => {
    const picked = await pickMediaSource({ storage: storage({ probe: "403" }), asset: asset(), now: NOW, fetchImpl: zernioFetch(404).impl });
    expect(picked).toEqual({ url: null, reasons: ["bucket: respondió 403", "copia en Zernio: respondió 404"] });
  });

  it("copia vencida: no se usa", async () => {
    const z = zernioFetch(200);
    const picked = await pickMediaSource({
      storage: storage({ probe: "403" }),
      asset: asset({ zernioCopyAt: new Date(NOW.getTime() - 7 * 86_400_000) }),
      now: NOW,
      fetchImpl: z.impl,
    });
    expect(picked).toEqual({ url: null, reasons: ["bucket: respondió 403", "copia en Zernio: no hay o ya venció"] });
    expect(z.calls).toEqual([]);
  });

  it("rescate (prefer zernio): primero la copia", async () => {
    const picked = await pickMediaSource({ storage: storage({ probe: "ok" }), asset: asset(), now: NOW, prefer: "zernio", fetchImpl: zernioFetch(200).impl });
    expect(picked).toEqual({ url: COPY, origin: "zernio" });
  });

  it("almacenamiento sin prueba (dobles de prueba): el enlace firmado se da por bueno, como antes", async () => {
    const picked = await pickMediaSource({ storage: storage({ noProbe: true }), asset: asset({ zernioCopyUrl: null, zernioCopyAt: null }), now: NOW });
    expect(picked).toMatchObject({ origin: "bucket" });
  });
});
