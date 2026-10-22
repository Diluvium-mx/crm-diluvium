// P3 (22-oct-2026): la espera entre reintentos de una descarga crece, pero nunca pasa de 10 min.
import { describe, expect, it } from "vitest";
import { MEDIA_BACKOFF_MAX_MS, mediaBackoffMs } from "./inbound";

describe("mediaBackoffMs", () => {
  it("empieza en 10 s y se duplica", () => {
    expect([1, 2, 3, 4].map(mediaBackoffMs)).toEqual([10_000, 20_000, 40_000, 80_000]);
  });

  it("tope de 10 min: el intento 25 ya no espera días (caso del 22-oct)", () => {
    expect(mediaBackoffMs(7)).toBe(MEDIA_BACKOFF_MAX_MS);
    expect(mediaBackoffMs(25)).toBe(MEDIA_BACKOFF_MAX_MS);
    expect(mediaBackoffMs(500)).toBe(MEDIA_BACKOFF_MAX_MS);
  });
});
