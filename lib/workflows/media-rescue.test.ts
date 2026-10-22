// Rescate de un archivo que WhatsApp no pudo bajar (envío blindado, 22-oct-2026): reglas puras.
import { describe, expect, it } from "vitest";
import { isMediaFetchFailure, libraryAssetId, rescueMessageId } from "./media-rescue";

describe("isMediaFetchFailure", () => {
  it("131053 de Meta (el del 21-oct) sí", () => {
    expect(isMediaFetchFailure("131053", "Media upload error")).toBe(true);
  });

  it("el 400 «Upload attachment failure» de Zernio sí", () => {
    expect(isMediaFetchFailure("400", "Upload attachment failure.")).toBe(true);
  });

  it.each([
    ["131049", "This message was not delivered to maintain healthy ecosystem engagement"],
    ["131026", "Message undeliverable"],
    [null, null],
  ])("%s no: no es un problema de bajar el archivo", (code, message) => {
    expect(isMediaFetchFailure(code, message)).toBe(false);
  });
});

describe("libraryAssetId", () => {
  it("lee el id de la ruta interna de la burbuja", () => {
    expect(libraryAssetId("/api/biblioteca/asset-123")).toBe("asset-123");
  });

  it.each([undefined, "/api/media/m1/0", "https://zernio.com/x.png", "/api/biblioteca/a/original"])("%s no es un archivo de la Biblioteca", (url) => {
    expect(libraryAssetId(url)).toBeNull();
  });
});

describe("rescueMessageId", () => {
  it("es determinista: el mismo aviso no manda dos rescates", () => {
    expect(rescueMessageId("m1")).toBe("m1:rescate");
    expect(rescueMessageId("m1")).toBe(rescueMessageId("m1"));
  });
});
