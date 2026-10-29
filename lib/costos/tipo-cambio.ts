// Tipo de cambio del correo de costos (decisión del dueño 28-oct-2026: los montos también en pesos). Fuente: el dólar
// FIX que publica el Diario Oficial de la Federación (API pública de SIDOF, indicador 158 «DÓLAR»): oficial, gratis y
// sin llave ni registro (la API de Banxico pide token). Se usa el PROMEDIO de los días publicados en el mes del
// reporte, porque el gasto se reparte en todo el mes. Si no se puede leer, el correo sale solo en dólares con un
// aviso: nunca se detiene por esto.
import type { Mes } from "./mes";

export type TipoCambio = { mxnPorUsd: number; dias: number };

export type GetLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const SIDOF_DOLAR = "https://sidof.segob.gob.mx/dof/sidof/indicadores/158";

// "2026-10-01" → "01-10-2026" (formato de SIDOF), y al revés.
const aSidof = (day: string) => day.split("-").reverse().join("-");

// PURO: promedio de los valores del mes. Descarta fechas fuera del mes y valores absurdos.
export function promedioDolar(json: unknown, mes: Mes): TipoCambio | null {
  const lista = json && typeof json === "object" ? (json as { ListaIndicadores?: unknown }).ListaIndicadores : null;
  if (!Array.isArray(lista)) return null;
  const valores: number[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const { fecha, valor } = item as { fecha?: unknown; valor?: unknown };
    if (typeof fecha !== "string" || !/^\d{2}-\d{2}-\d{4}$/.test(fecha)) continue;
    const day = aSidof(fecha);
    const v = Number(valor);
    if (day >= mes.desde && day <= mes.hasta && Number.isFinite(v) && v > 5 && v < 100) valores.push(v);
  }
  if (!valores.length) return null;
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length;
  return { mxnPorUsd: Math.round(promedio * 10_000) / 10_000, dias: valores.length };
}

export async function leerTipoCambio(mes: Mes, fetchImpl: GetLike = fetch): Promise<TipoCambio | null> {
  try {
    const res = await fetchImpl(`${SIDOF_DOLAR}/${aSidof(mes.desde)}/${aSidof(mes.hasta)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return promedioDolar(await res.json(), mes);
  } catch {
    // Red caída o respuesta rara: el correo lo avisa (armarReporte) y sale en dólares.
    return null;
  }
}
