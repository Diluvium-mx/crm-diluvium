// Foto del clima: cada ciudad pasa todas las revisiones o no sale esa hora.
import { describe, expect, it } from "vitest";
import { armarFoto, distanciaKm, type ReporteMetar } from "@/lib/clima/armar";
import type { Ciudad } from "@/lib/clima/ciudades";
import type { ReporteLluvia } from "@/lib/clima/synop";

const AHORA = new Date("2026-10-02T15:45:00Z");
const hace = (min: number) => Math.round((AHORA.getTime() - min * 60_000) / 1000); // obsTime en segundos
const enHora = (min: number) => new Date(AHORA.getTime() - min * 60_000);

const MONTERREY: Ciudad = { nombre: "Monterrey", icao: "MMMY", wmo: "76393", lat: 25.867, lon: -100.2 };
const AEROPUERTO_MTY = { icaoId: "MMMY", lat: 25.774, lon: -100.104 };

const metar = (rawOb: string, min: number, sitio = AEROPUERTO_MTY): ReporteMetar => ({ ...sitio, rawOb, obsTime: hace(min) });
const lluvia = (mm: number, min: number, temp: number | null = 23.4): ReporteLluvia => ({ t: enHora(min), mm, temp });

function foto(input: { ciudad?: Ciudad; metar: ReporteMetar[]; synop: ReporteLluvia[] }) {
  const ciudad = input.ciudad ?? MONTERREY;
  return armarFoto({ ciudades: [ciudad], metar: input.metar, synop: new Map([[ciudad.wmo, input.synop]]), ahora: AHORA });
}

describe("armarFoto", () => {
  it("con datos frescos y que cuadran, la ciudad entra con grados, icono y lluvia", () => {
    const f = foto({
      metar: [metar("METAR MMMY 021440Z 30007KT 7SM SCT020 BKN070 24/23 A2997", 65)],
      synop: [lluvia(172.5, 45), lluvia(172.5, 105)],
    });
    expect(f.fuera).toEqual([]);
    expect(f.ciudades).toEqual([
      {
        nombre: "Monterrey",
        orden: 0,
        lat: 25.774,
        lon: -100.104,
        temp: 24,
        categoria: "nublado",
        metarHora: new Date(hace(65) * 1000).toISOString(),
        mm: 172.5,
        mmHora: enHora(45).toISOString(),
      },
    ]);
    expect(f.generado).toBe(AHORA.toISOString());
  });

  it("usa el METAR más reciente del aeropuerto", () => {
    const f = foto({
      metar: [metar("METAR MMMY 021340Z 00000KT 7SM SKC 20/18 A2997", 125), metar("METAR MMMY 021540Z 00000KT 4SM TSRA BKN015CB 22/21 A2997", 5)],
      synop: [lluvia(10, 45, 21)],
    });
    expect(f.ciudades[0]).toMatchObject({ temp: 22, categoria: "tormenta" });
  });

  it.each([
    ["el METAR tiene más de 2 h", [metar("METAR MMMY 021320Z 00000KT 7SM SKC 24/23 A2997", 125)]],
    ["no hay METAR del aeropuerto", []],
    ["el METAR no trae temperatura", [metar("METAR MMMY 021440Z 00000KT 7SM SKC A2997", 30)]],
  ])("queda fuera si %s", (_motivo, metares) => {
    const f = foto({ metar: metares, synop: [lluvia(0, 45)] });
    expect(f.ciudades).toEqual([]);
    expect(f.fuera).toHaveLength(1);
    expect(f.fuera[0].nombre).toBe("Monterrey");
  });

  it("queda fuera si el aeropuerto está a más de 30 km del observatorio (MMTL = Tulum, no Tulancingo)", () => {
    const tulancingo: Ciudad = { nombre: "Tulancingo", icao: "MMTL", wmo: "76634", lat: 20.083, lon: -98.367 };
    const f = foto({
      ciudad: tulancingo,
      metar: [metar("METAR MMTL 021442Z 09012KT 7SM SCT020 BKN250 29/29 A2988", 30, { icaoId: "MMTL", lat: 20.1725, lon: -87.6622 })],
      synop: [lluvia(0, 45, 16.4)],
    });
    expect(f.ciudades).toEqual([]);
    expect(f.fuera[0].motivo).toMatch(/km del observatorio/);
  });

  it("queda fuera si el observatorio no reportó la lluvia en las últimas 3 h", () => {
    const f = foto({ metar: [metar("METAR MMMY 021440Z 00000KT 7SM SKC 24/23 A2997", 30)], synop: [lluvia(5, 200)] });
    expect(f.ciudades).toEqual([]);
    expect(f.fuera[0].motivo).toMatch(/observatorio/);
  });

  it("queda fuera si los grados del aeropuerto y del observatorio difieren más de 5 °C", () => {
    const f = foto({ metar: [metar("METAR MMMY 021440Z 00000KT 7SM SKC 29/29 A2997", 30)], synop: [lluvia(0, 45, 16.4)] });
    expect(f.ciudades).toEqual([]);
    expect(f.fuera[0].motivo).toMatch(/no cuadran los grados/);
  });

  it("un salto de lluvia sin lluvia en el aeropuerto espera confirmación; con tormenta, entra", () => {
    const synop = [lluvia(155.2, 45), lluvia(93.9, 105)];
    const seco = foto({ metar: [metar("METAR MMMY 021440Z 00000KT 7SM SKC 24/23 A2997", 30)], synop });
    expect(seco.ciudades[0].mm).toBe(93.9);
    const conTormenta = foto({
      metar: [
        metar("METAR MMMY 021440Z 00000KT 7SM SKC 24/23 A2997", 30),
        metar("METAR MMMY 021340Z 00000KT 3SM TSRA BKN015CB OVC020 24/23 A2991", 90),
      ],
      synop,
    });
    expect(conTormenta.ciudades[0].mm).toBe(155.2);
  });
});

describe("distanciaKm", () => {
  it("los dos puntos de Monterrey (aeropuerto y observatorio) quedan a unos 14 km", () => {
    const km = distanciaKm(25.774, -100.104, 25.867, -100.2);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(20);
  });
});
