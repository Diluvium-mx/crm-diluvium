// Arma la «foto» del clima de una hora a partir de los reportes de aeropuertos (METAR) y de los
// observatorios del SMN-Conagua (SYNOP). PURO. Cada ciudad tiene que pasar TODAS las revisiones;
// si falla una, esa hora no sale en la cinta (decisión del dueño: sin dato verídico, no va).
import type { Ciudad } from "./ciudades";
import { categoriaMetar, CATEGORIAS_AGUA, temperaturaMetar, type CategoriaClima } from "./metar";
import { lluviaConfiable, type ReporteLluvia } from "./synop";

export const MAX_EDAD_METAR_MS = 2 * 3600_000;
export const MAX_EDAD_SYNOP_MS = 3 * 3600_000;
/** El aeropuerto tiene que estar en la misma ciudad que el observatorio. */
export const MAX_DISTANCIA_KM = 30;
/** Dos mediciones de la misma ciudad: si los grados no cuadran, uno de los dos está mal. */
export const MAX_DIFERENCIA_GRADOS = 5;

export type ReporteMetar = { icaoId: string; obsTime: number; rawOb: string; lat: number; lon: number };

export type CiudadClima = {
  nombre: string;
  /** Lugar en el ranking de lluvia (lib/clima/ciudades.ts). */
  orden: number;
  /** Del aeropuerto, para el icono de día o de noche. */
  lat: number;
  lon: number;
  temp: number;
  categoria: CategoriaClima;
  /** Hora de la medición del aeropuerto (ISO). */
  metarHora: string;
  /** Lluvia de las últimas 24 h (mm) y hora del reporte del observatorio (ISO). */
  mm: number;
  mmHora: string;
};

export type FotoClima = {
  generado: string;
  ciudades: CiudadClima[];
  fuera: { nombre: string; motivo: string }[];
};

export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function armarFoto(input: {
  ciudades: readonly Ciudad[];
  metar: readonly ReporteMetar[];
  synop: ReadonlyMap<string, readonly ReporteLluvia[]>;
  ahora: Date;
}): FotoClima {
  const ahora = input.ahora.getTime();
  const ciudades: CiudadClima[] = [];
  const fuera: FotoClima["fuera"] = [];

  input.ciudades.forEach((c, orden) => {
    const delAeropuerto = input.metar.filter((m) => m.icaoId === c.icao).sort((a, b) => b.obsTime - a.obsTime);
    const ultimo = delAeropuerto[0];
    const temp = ultimo ? temperaturaMetar(ultimo.rawOb) : null;
    if (!ultimo || ahora - ultimo.obsTime * 1000 > MAX_EDAD_METAR_MS || temp === null) {
      fuera.push({ nombre: c.nombre, motivo: ultimo ? "el aeropuerto no trae un dato reciente" : "el aeropuerto no ha reportado" });
      return;
    }
    const km = distanciaKm(ultimo.lat, ultimo.lon, c.lat, c.lon);
    if (km > MAX_DISTANCIA_KM) {
      fuera.push({ nombre: c.nombre, motivo: `el aeropuerto ${c.icao} está a ${Math.round(km)} km del observatorio` });
      return;
    }
    const reportes = input.synop.get(c.wmo) ?? [];
    const recientes = reportes
      .filter((r) => ahora - r.t.getTime() <= MAX_EDAD_SYNOP_MS)
      .sort((a, b) => b.t.getTime() - a.t.getTime());
    const llovio = delAeropuerto.some((m) => CATEGORIAS_AGUA.has(categoriaMetar(m.rawOb)));
    const lluvia = lluviaConfiable(recientes, llovio);
    if (!lluvia) {
      fuera.push({ nombre: c.nombre, motivo: "el observatorio de Conagua no ha reportado la lluvia" });
      return;
    }
    const tempObservatorio = recientes[0]?.temp ?? null;
    if (tempObservatorio !== null && Math.abs(tempObservatorio - temp) > MAX_DIFERENCIA_GRADOS) {
      fuera.push({ nombre: c.nombre, motivo: `no cuadran los grados: aeropuerto ${temp}°, observatorio ${tempObservatorio}°` });
      return;
    }
    ciudades.push({
      nombre: c.nombre,
      orden,
      lat: ultimo.lat,
      lon: ultimo.lon,
      temp,
      categoria: categoriaMetar(ultimo.rawOb),
      metarHora: new Date(ultimo.obsTime * 1000).toISOString(),
      mm: lluvia.mm,
      mmHora: lluvia.t.toISOString(),
    });
  });

  return { generado: input.ahora.toISOString(), ciudades, fuera };
}
