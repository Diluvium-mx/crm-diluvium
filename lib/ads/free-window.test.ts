import { describe, expect, it } from "vitest";
import { freeEntryWindow } from "./free-window";

const H = 3_600_000;
const entry = new Date("2026-09-24T12:00:00Z");
const at = (hours: number) => new Date(entry.getTime() + hours * H);

describe("ventana gratis de 72 h (entrada por anuncio)", () => {
  it("sin entrada por anuncio no hay ventana", () => {
    expect(freeEntryWindow(null, null, at(1))).toBeNull();
  });

  it("sin respuesta aún y dentro de 24 h: pendiente, hasta cuándo responder", () => {
    expect(freeEntryWindow(entry, null, at(3))).toEqual({ status: "pending", replyBy: at(24) });
  });

  it("la primera respuesta dentro de 24 h abre 72 h desde esa respuesta", () => {
    expect(freeEntryWindow(entry, at(0.1), at(10))).toEqual({ status: "open", openedAt: at(0.1), until: at(72.1) });
    expect(freeEntryWindow(entry, at(0.1), at(73))).toEqual({ status: "expired", openedAt: at(0.1), until: at(72.1) });
  });

  it("sin respuesta en 24 h, o respuesta tardía: no hubo ventana gratis", () => {
    expect(freeEntryWindow(entry, null, at(25))).toEqual({ status: "missed" });
    expect(freeEntryWindow(entry, at(30), at(31))).toEqual({ status: "missed" });
  });
});
