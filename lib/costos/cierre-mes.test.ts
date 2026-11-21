import { describe, expect, it } from "vitest";
import { combinar, debeGuardar } from "./cierre-mes";

describe("debeGuardar", () => {
  it("sin fila, siempre (aunque ya pasaron los primeros días)", () => {
    expect(debeGuardar(null, new Date("2026-11-20T18:00:00Z"))).toBe(true);
  });
  it("los primeros 7 días del mes (hora de Mazatlán) vuelve a guardar el mes anterior", () => {
    expect(debeGuardar({ source: "auto" }, new Date("2026-11-03T18:00:00Z"))).toBe(true);
    // 8-nov 03:00 UTC = 7-nov 20:00 en Mazatlán.
    expect(debeGuardar({ source: "auto" }, new Date("2026-11-08T03:00:00Z"))).toBe(true);
    expect(debeGuardar({ source: "auto" }, new Date("2026-11-08T18:00:00Z"))).toBe(false);
  });
  it("lo cargado a mano nunca se toca", () => {
    expect(debeGuardar({ source: "manual" }, new Date("2026-11-02T18:00:00Z"))).toBe(false);
  });
});

describe("combinar", () => {
  it("lo nuevo manda y un dato que ya no se puede leer conserva el anterior", () => {
    // El 6-nov Railway ya cambió de periodo: el de octubre ya no se puede leer y se queda su último estimado.
    expect(
      combinar(
        { iaUsd: 40, metaUsd: null, railwayUsd: 12.9, zernioUsd: 1.05 },
        { iaUsd: 40.5, metaUsd: 44.16, railwayUsd: null, zernioUsd: 1.08 },
      ),
    ).toEqual({ iaUsd: 40.5, metaUsd: 44.16, railwayUsd: 12.9, zernioUsd: 1.08 });
  });
  it("sin fila anterior queda lo nuevo, con sus null", () => {
    expect(combinar(null, { iaUsd: 1, metaUsd: null, railwayUsd: null, zernioUsd: 0 })).toEqual({ iaUsd: 1, metaUsd: null, railwayUsd: null, zernioUsd: 0 });
  });
});
