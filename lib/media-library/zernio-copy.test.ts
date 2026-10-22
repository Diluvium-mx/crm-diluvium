// Copia de la Biblioteca en Zernio (envío blindado, 22-oct-2026): qué tipos se pueden subir.
import { describe, expect, it } from "vitest";
import { zernioContentType } from "./zernio-copy";

describe("zernioContentType", () => {
  it.each([
    ["image/jpeg", "image/jpeg"],
    ["image/jpg", "image/jpeg"],
    ["IMAGE/PNG; charset=binary", "image/png"],
    ["video/mp4", "video/mp4"],
    ["application/pdf", "application/pdf"],
  ])("%s → %s", (mime, expected) => {
    expect(zernioContentType(mime)).toBe(expected);
  });

  it.each(["application/msword", "application/octet-stream", "text/html"])("%s no lleva copia (Zernio no lo acepta)", (mime) => {
    expect(zernioContentType(mime)).toBeNull();
  });
});
