// Lo que muestra la cinta: horario, foto vieja, orden, iconos de día/noche y milímetros.
import { describe, expect, it } from "vitest";
import type { CiudadClima, FotoClima } from "@/lib/clima/armar";
import { itemsCinta, solArriba, textoMm } from "@/lib/clima/cinta";

// Viernes 2-oct-2026 a las 9:00 de Mazatlán (UTC-7, sin horario de verano).
const VIERNES_9 = new Date("2026-10-02T16:00:00Z");

const ciudad = (c: Partial<CiudadClima> & Pick<CiudadClima, "nombre" | "orden">): CiudadClima => ({
  lat: 25.774,
  lon: -100.104,
  temp: 24,
  categoria: "nublado",
  metarHora: "2026-10-02T15:40:00Z",
  mm: 0,
  mmHora: "2026-10-02T15:00:00Z",
  ...c,
});

const foto = (ciudades: CiudadClima[], generado = "2026-10-02T15:50:00Z"): FotoClima => ({ generado, ciudades, fuera: [] });

describe("textoMm", () => {
  it.each([
    [0, null],
    [0.04, null],
    [0.4, "0.4 mm"],
    [8.9, "8.9 mm"],
    [8.94, "8.9 mm"],
    [10, "10 mm"],
    [17.6, "18 mm"],
    [172.5, "173 mm"],
  ])("%s → %s (sin lluvia no se pone nada)", (mm, texto) => {
    expect(textoMm(mm)).toBe(texto);
  });
});

describe("itemsCinta", () => {
  it("sin foto no hay cinta", () => {
    expect(itemsCinta(null, VIERNES_9)).toEqual([]);
  });

  it("fuera del horario de trabajo no hay cinta (domingo, o un viernes a las 20:00 de Mazatlán)", () => {
    const f = foto([ciudad({ nombre: "Monterrey", orden: 0 })]);
    expect(itemsCinta(f, new Date("2026-10-04T18:00:00Z"))).toEqual([]);
    expect(itemsCinta(f, new Date("2026-10-03T03:00:00Z"))).toEqual([]);
  });

  it("con una foto de más de 2 h no hay cinta (nunca datos viejos)", () => {
    const f = foto([ciudad({ nombre: "Monterrey", orden: 0 })], "2026-10-02T13:59:00Z");
    expect(itemsCinta(f, VIERNES_9)).toEqual([]);
  });

  it("donde cae agua va primero (más mm primero) y el resto en el orden del ranking", () => {
    const f = foto([
      ciudad({ nombre: "Ciudad de México", orden: 0 }),
      ciudad({ nombre: "Toluca", orden: 1, categoria: "llovizna", mm: 18.6 }),
      ciudad({ nombre: "Mérida", orden: 3 }),
      ciudad({ nombre: "Colima", orden: 2 }),
      ciudad({ nombre: "Tampico", orden: 18, categoria: "tormenta", mm: 0 }),
      ciudad({ nombre: "Veracruz", orden: 21, categoria: "lluvia", mm: 89.6 }),
    ]);
    const items = itemsCinta(f, VIERNES_9);
    expect(items.map((i) => i.nombre)).toEqual(["Veracruz", "Toluca", "Tampico", "Ciudad de México", "Colima", "Mérida"]);
    expect(items.map((i) => i.agua)).toEqual([true, true, true, false, false, false]);
    expect(items[0]).toEqual({ nombre: "Veracruz", icono: "lluvia", agua: true, palabra: "Lluvia", grados: "24°", mm: "90 mm" });
    // Tormenta que apenas empieza: todavía sin milímetros en el observatorio, así que no se pone «0 mm».
    expect(items[2]).toMatchObject({ icono: "tormenta", palabra: "Tormenta", mm: null });
    expect(items[3]).toMatchObject({ nombre: "Ciudad de México", grados: "24°", mm: null });
  });

  it("de día: despejado = sol, medio nublado = nube con sol; nublado = nube", () => {
    const f = foto([
      ciudad({ nombre: "Tepic", orden: 0, categoria: "despejado" }),
      ciudad({ nombre: "Chetumal", orden: 1, categoria: "medio_nublado" }),
      ciudad({ nombre: "Colima", orden: 2, categoria: "nublado" }),
    ], "2026-10-02T18:00:00Z");
    const mediodia = new Date("2026-10-02T18:30:00Z"); // 11:30 Mazatlán, sol arriba en Monterrey
    expect(itemsCinta(f, mediodia).map((i) => i.icono)).toEqual(["sol", "nube-sol", "nube"]);
  });

  it("de noche en esa ciudad: despejado = luna, medio nublado = nube con luna", () => {
    // 18:45 de Mazatlán aún es horario de trabajo, pero en Mérida (más al este) ya se metió el sol.
    const tarde = new Date("2026-10-03T01:45:00Z");
    const f = foto(
      [
        ciudad({ nombre: "Mérida", orden: 0, categoria: "despejado", lat: 20.937, lon: -89.658 }),
        ciudad({ nombre: "Campeche", orden: 1, categoria: "medio_nublado", lat: 19.817, lon: -90.5 }),
      ],
      "2026-10-03T01:00:00Z",
    );
    expect(itemsCinta(f, tarde).map((i) => i.icono)).toEqual(["luna", "nube-luna"]);
  });
});

describe("solArriba", () => {
  it("a mediodía el sol está arriba y de madrugada no (Monterrey)", () => {
    expect(solArriba(new Date("2026-10-02T18:00:00Z"), 25.774, -100.104)).toBe(true);
    expect(solArriba(new Date("2026-10-02T09:00:00Z"), 25.774, -100.104)).toBe(false);
  });
});
