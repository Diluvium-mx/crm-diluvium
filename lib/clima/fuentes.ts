// Descarga del clima medido (solo en el worker). Dos consultas por hora en horario de trabajo, sin
// llave ni cuenta (decisión del dueño, 2-oct-2026: verídico y sin pagar un peso):
// - METAR de aeropuertos: Servicio Meteorológico de EE. UU. (aviationweather.gov; sin llave, límite de
//   100 consultas por minuto, pide un User-Agent propio).
// - SYNOP de los observatorios del SMN-Conagua, vía OGIMET (bloque 76 = México). Los reportes son de
//   cada país y se rigen por la Resolución 40 de la OMM (datos esenciales, intercambio libre).
// Lo que llega de fuera se valida antes de usarse (CLAUDE.md §3: Zod en todo borde de entrada).
import { z } from "zod";
import type { Ciudad } from "./ciudades";
import type { ReporteMetar } from "./armar";
import { reportesPorObservatorio, type ReporteLluvia } from "./synop";

const USER_AGENT = "crm-diluvium/1.0 (contacto@diluvium.com.mx)";
const TIMEOUT_MS = 10_000;

async function bajarTexto(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} respondió HTTP ${res.status}`);
  return res.text();
}

const metarSchema = z.array(
  z.object({
    icaoId: z.string(),
    obsTime: z.number(),
    rawOb: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
);

/** Reportes de las últimas 3 h de los aeropuertos de las ciudades (una sola consulta). */
export async function bajarMetar(ciudades: readonly Ciudad[]): Promise<ReporteMetar[]> {
  const ids = ciudades.map((c) => c.icao).join(",");
  const texto = await bajarTexto(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=3`);
  const datos = metarSchema.safeParse(JSON.parse(texto));
  if (!datos.success) throw new Error("aviationweather.gov cambió el formato de su respuesta");
  return datos.data;
}

function sello(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-T:]/g, ""); // AAAAMMDDhhmm en UTC
}

/** Reportes de las últimas 6 h de los observatorios de México, por observatorio (una sola consulta). */
export async function bajarSynop(ahora: Date): Promise<Map<string, ReporteLluvia[]>> {
  const desde = new Date(ahora.getTime() - 6 * 3600_000);
  const texto = await bajarTexto(
    `https://www.ogimet.com/cgi-bin/getsynop?block=76&begin=${sello(desde)}&end=${sello(ahora)}`,
  );
  return reportesPorObservatorio(texto);
}
