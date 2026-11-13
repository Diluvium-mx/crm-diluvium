import { describe, expect, it } from "vitest";
import { temporizador } from "./buen-fin-countdown";

const s = (iso: string) => Date.parse(iso) / 1000;

describe("temporizador de la columna Buen Fin (hora de Mazatlán)", () => {
  it("antes del 13 de noviembre cuenta lo que falta para que empiece", () => {
    expect(temporizador(s("2026-11-04T11:00:00-07:00"))).toEqual({ fase: "antes", tiempo: "8d 13:00:00" });
    expect(temporizador(s("2026-11-12T23:59:59-07:00"))).toEqual({ fase: "antes", tiempo: "0d 00:00:01" });
  });

  it("durante los seis días cuenta lo que falta para que termine", () => {
    expect(temporizador(s("2026-11-13T00:00:00-07:00"))).toEqual({ fase: "durante", tiempo: "6d 00:00:00" });
    expect(temporizador(s("2026-11-18T23:59:59-07:00"))).toEqual({ fase: "durante", tiempo: "0d 00:00:01" });
  });

  it("del jueves 19 en adelante ya terminó", () => {
    expect(temporizador(s("2026-11-19T00:00:00-07:00"))).toEqual({ fase: "termino", tiempo: null });
    expect(temporizador(s("2026-12-01T10:00:00-07:00"))).toEqual({ fase: "termino", tiempo: null });
  });
});
