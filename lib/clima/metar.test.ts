// Lectura de METAR de aeropuertos mexicanos con reportes reales (1 y 2-oct-2026).
import { describe, expect, it } from "vitest";
import { categoriaMetar, temperaturaMetar } from "@/lib/clima/metar";

const TORMENTA_CDMX =
  "SPECI MMMX 012302Z 14017G27KT 1 1/2SM +TSRA BKN015CB OVC080 17/13 A3016 TEMPO 1/2SM +TSRA RMK 8/96/";

describe("temperaturaMetar", () => {
  it("lee los grados aunque falte el punto de rocío («34///»)", () => {
    expect(temperaturaMetar("METAR MMLM 012248Z E26005KT 10SM SCT080 BKN220 34/// A2973 RMK 8/038")).toBe(34);
  });

  it("lee grados bajo cero (M02/M05)", () => {
    expect(temperaturaMetar("METAR MMXX 012248Z 00000KT 10SM SKC M02/M05 A3000")).toBe(-2);
  });

  it("no confunde la visibilidad 1 1/2SM con la temperatura", () => {
    expect(temperaturaMetar(TORMENTA_CDMX)).toBe(17);
  });

  it("sin grupo de temperatura devuelve null", () => {
    expect(temperaturaMetar("METAR MMXX 012248Z 00000KT 10SM SKC A3000")).toBeNull();
  });
});

describe("categoriaMetar", () => {
  it.each([
    [TORMENTA_CDMX, "tormenta"],
    ["METAR MMMY 020440Z 19004KT 3SM TSRA BKN015CB OVC020 24/23 A2991 RMK 60465", "tormenta"],
    ["METAR MMAN 020514Z 20004KT 4SM RA SCT012CB OVC018 24/23 A2992", "lluvia"],
    ["METAR MMAN 020115Z 03006KT 8SM -DZ BKN035CB OVC200 27/23 A2979", "llovizna"],
    ["METAR MMVR 300442Z 00000KT 3SM BR HZ FEW015TCU BKN070 28/27 A2981", "niebla"],
    ["METAR MMEP 021440Z 21002KT 10SM SKC 23/21 A2994", "despejado"],
    ["METAR MMGL 021527Z 10006KT 8SM FEW020 22/18 A3012", "despejado"],
  ])("%s → %s", (raw, esperado) => {
    expect(categoriaMetar(raw)).toBe(esperado);
  });

  it("lo que pasa en las cercanías (VCSH) no es lluvia en el aeropuerto", () => {
    expect(categoriaMetar("METAR MMDO 012246Z 27006KT 8SM VCSH OVC025CB 21/14 A3006")).toBe("nublado");
  });

  it("una nube de desarrollo (TCU) no es tormenta", () => {
    expect(categoriaMetar("METAR MMCM 021440Z 12012KT 7SM SCT020TCU SCT200 31/25 A2982")).toBe("medio_nublado");
  });

  it("la lluvia que solo aparece en observaciones (RMK RAE30) no cuenta", () => {
    expect(categoriaMetar("METAR MMMY 021140Z 25005KT 6SM SCT015 BKN070 22/22 A2993 RMK RAE30")).toBe("nublado");
  });

  it("la tormenta que solo viene en la tendencia (TEMPO) no cuenta", () => {
    expect(categoriaMetar("METAR MMMX 021520Z 00000KT 5SM FEW020 SCT080 19/13 A3026 TEMPO 3SM TSRA")).toBe("medio_nublado");
  });
});
