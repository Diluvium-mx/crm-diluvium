import { describe, expect, it } from "vitest";
import { assetStorageKey, kindForMime, MediaRejectedError, stepsUsingAsset, validateUpload } from "./rules";

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
