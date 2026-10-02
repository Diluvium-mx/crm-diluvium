// Lo que muestra la cinta del clima de la barra de arriba (PURO, sirve al servidor y al navegador).
// Reglas del dueño (1 y 2-oct-2026): solo en horario de trabajo (lun–sáb 9–19 Mazatlán), icono (sin
// texto) + ciudad + grados + lluvia de las últimas 24 h (si no llovió, nada); donde cae agua ahora, primero.
import { isBusinessHours } from "@/lib/monitoring/business-hours";
import type { FotoClima } from "./armar";
import { CATEGORIAS_AGUA, type CategoriaClima } from "./metar";

/** Si el worker lleva más de 2 h sin traer el clima, la cinta no muestra datos viejos: se esconde. */
export const MAX_EDAD_FOTO_MS = 2 * 3600_000;

export type IconoClima =
  | "sol"
  | "luna"
  | "nube-sol"
  | "nube-luna"
  | "nube"
  | "niebla"
  | "llovizna"
  | "lluvia"
  | "tormenta";

export type ItemCinta = {
  nombre: string;
  icono: IconoClima;
  /** Cae agua ahora (tormenta, lluvia o llovizna): el icono va en naranja. */
  agua: boolean;
  /** Para lectores de pantalla; a la vista solo va el icono. */
  palabra: string;
  grados: string;
  /** Lluvia de las últimas 24 h; null si no llovió (regla del dueño: ningún dato en 0, solo icono, ciudad y grados). */
  mm: string | null;
};

const PALABRA: Record<CategoriaClima, string> = {
  tormenta: "Tormenta",
  lluvia: "Lluvia",
  llovizna: "Llovizna",
  niebla: "Niebla",
  nublado: "Nublado",
  medio_nublado: "Medio nublado",
  despejado: "Despejado",
};

/** ¿Está el sol arriba del horizonte en ese lugar? (fórmula simple de la NOAA; basta para día/noche). */
export function solArriba(ahora: Date, lat: number, lon: number): boolean {
  const r = Math.PI / 180;
  const d = (ahora.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * r;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 3.6e-7 * d) * r;
  const ascension = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const declinacion = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const horario = (gmst * 15 + lon) * r - ascension;
  const altura =
    Math.asin(Math.sin(lat * r) * Math.sin(declinacion) + Math.cos(lat * r) * Math.cos(declinacion) * Math.cos(horario)) / r;
  return altura > -0.833;
}

function icono(categoria: CategoriaClima, dia: boolean): IconoClima {
  switch (categoria) {
    case "despejado":
      return dia ? "sol" : "luna";
    case "medio_nublado":
      return dia ? "nube-sol" : "nube-luna";
    case "nublado":
      return "nube";
    default:
      return categoria;
  }
}

/**
 * «0.4 mm», «8.9 mm»; desde 10, sin decimales: «173 mm». Sin lluvia (o tan poca que redondeada da 0) no se
 * pone nada: null (regla del dueño, 2-oct-2026).
 */
export function textoMm(mm: number): string | null {
  const valor = mm >= 10 ? Math.round(mm) : Number(mm.toFixed(1));
  return valor > 0 ? `${valor} mm` : null;
}

/** Lo que va en la cinta en este momento; vacío = la cinta no se muestra. */
export function itemsCinta(foto: FotoClima | null, ahora: Date): ItemCinta[] {
  if (!foto || !isBusinessHours(ahora)) return [];
  if (ahora.getTime() - Date.parse(foto.generado) > MAX_EDAD_FOTO_MS) return [];
  const agua = (c: FotoClima["ciudades"][number]) => CATEGORIAS_AGUA.has(c.categoria);
  return [...foto.ciudades]
    .sort((a, b) => Number(agua(b)) - Number(agua(a)) || (agua(a) ? b.mm - a.mm : 0) || a.orden - b.orden)
    .map((c) => ({
      nombre: c.nombre,
      icono: icono(c.categoria, solArriba(ahora, c.lat, c.lon)),
      agua: agua(c),
      palabra: PALABRA[c.categoria],
      grados: `${c.temp}°`,
      mm: textoMm(c.mm),
    }));
}
