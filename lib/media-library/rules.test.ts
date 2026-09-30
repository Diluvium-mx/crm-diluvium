import { describe, expect, it } from "vitest";
import { assetStorageKey, bytesMatchMime, isMultimedia, kindForMime, MediaRejectedError, stepsUsingAsset, THUMBNAIL_MAX_BYTES, validateThumbnail, validateUpload } from "./rules";

describe("validateUpload", () => {
  it("acepta imagen, video y documento dentro de los límites de WhatsApp", () => {
    expect(validateUpload({ fileName: "tabla.png", mimeType: "image/png", bytes: 1_000 })).toEqual({ kind: "image", fileName: "tabla.png" });
    expect(validateUpload({ fileName: "v.mp4", mimeType: "video/mp4", bytes: 16 * 1024 * 1024 }).kind).toBe("video");
    expect(validateUpload({ fileName: "d.pdf", mimeType: "application/pdf; charset=binary", bytes: 10 }).kind).toBe("document");
  });
  it("rechaza tipo no permitido, tamaño excedido y vacío (el cliente vería un envío fallido)", () => {
    expect(() => validateUpload({ fileName: "a.gif", mimeType: "image/gif", bytes: 10 })).toThrow(MediaRejectedError);
    expect(() => validateUpload({ fileName: "a.png", mimeType: "image/png", bytes: 5 * 1024 * 1024 + 1 })).toThrow(/5 MB/);
    expect(() => validateUpload({ fileName: "v.mp4", mimeType: "video/mp4", bytes: 17 * 1024 * 1024 })).toThrow(/16 MB/);
    expect(() => validateUpload({ fileName: "a.png", mimeType: "image/png", bytes: 0 })).toThrow(/vacío/);
    expect(() => validateUpload({ fileName: "  ", mimeType: "image/png", bytes: 1 })).toThrow(/Nombre/);
  });
  it("S2: rechaza nombres con controles, invisibles o marcas bidi (el nombre llega al cliente)", () => {
    expect(() => validateUpload({ fileName: "Factura_\u202Efdp.exe", mimeType: "application/pdf", bytes: 10 })).toThrow(/Nombre/);
    expect(() => validateUpload({ fileName: "a\u200b.pdf", mimeType: "application/pdf", bytes: 10 })).toThrow(/Nombre/);
    expect(() => validateUpload({ fileName: "carpeta/a.pdf", mimeType: "application/pdf", bytes: 10 })).toThrow(/Nombre/);
  });
  it("kindForMime ignora mayúsculas y parámetros", () => {
    expect(kindForMime("IMAGE/JPEG")).toBe("image");
    expect(kindForMime("application/octet-stream")).toBeNull();
  });
});

describe("assetStorageKey", () => {
  it("aísla por organización y limpia el nombre", () => {
    expect(assetStorageKey("org1", "a1", "Tabla de tamaños (v2).png")).toBe("org/org1/library/a1-Tabla_de_tamanos_v2_.png");
    expect(assetStorageKey("org1", "a1", "../../x")).not.toContain("..");
  });
});

describe("stepsUsingAsset", () => {
  it("cuenta solo los pasos send_media con ese archivo", () => {
    const steps = [
      { payload: { kind: "send_media" as const, assetId: "a1", title: "t" } },
      { payload: { kind: "send_media" as const, assetId: "a2", title: "t" } },
      { payload: { kind: "send_text" as const, text: "a1" } },
    ];
    expect(stepsUsingAsset(steps, "a1")).toBe(1);
    expect(stepsUsingAsset(steps, "zzz")).toBe(0);
  });
});

describe("isMultimedia", () => {
  it("Multimedia del chat: fotos y videos de la Biblioteca; los documentos no", () => {
    expect(isMultimedia("image")).toBe(true);
    expect(isMultimedia("video")).toBe(true);
    expect(isMultimedia("document")).toBe(false);
  });
});

describe("validateThumbnail", () => {
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]).toString("base64");
  it("acepta un JPEG chico en base64", () => {
    expect(validateThumbnail(` ${jpeg(10_000)} `)).toBe(jpeg(10_000));
  });
  it("rechaza lo que no es JPEG, lo que no es base64 y lo que pasa de 64 KB", () => {
    expect(() => validateThumbnail(Buffer.from("\x89PNG....").toString("base64"))).toThrow(MediaRejectedError);
    expect(() => validateThumbnail("no es base64!")).toThrow(MediaRejectedError);
    expect(() => validateThumbnail("")).toThrow(MediaRejectedError);
    expect(() => validateThumbnail(jpeg(THUMBNAIL_MAX_BYTES))).toThrow(MediaRejectedError);
  });
});

describe("bytesMatchMime (S2: el contenido coincide con el tipo declarado)", () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const MP4 = new Uint8Array([0, 0, 0, 0x20, ...enc("ftypisom"), 0, 0, 2, 0]);
  const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc("[Content_Types].xml")]);
  it("acepta lo que sí es del tipo declarado", () => {
    expect(bytesMatchMime(JPEG, "image/jpeg")).toBe(true);
    expect(bytesMatchMime(MP4, "video/mp4")).toBe(true);
    expect(bytesMatchMime(MP4, "video/3gpp")).toBe(true);
    expect(bytesMatchMime(enc("%PDF-1.4"), "application/pdf; charset=binary")).toBe(true);
    expect(bytesMatchMime(OLE, "application/msword")).toBe(true);
    expect(bytesMatchMime(DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(bytesMatchMime(enc("hola"), "text/plain")).toBe(true);
  });
  it("rechaza un «PDF» que es HTML, una imagen que es otra cosa y un binario como texto", () => {
    expect(bytesMatchMime(enc("<html><script>x</script>"), "application/pdf")).toBe(false);
    expect(bytesMatchMime(enc("%PDF-1.4"), "image/png")).toBe(false);
    expect(bytesMatchMime(new Uint8Array([0x4d, 0x5a, 0, 0]), "text/plain")).toBe(false);
    expect(bytesMatchMime(JPEG, "application/zip")).toBe(false);
  });
});
