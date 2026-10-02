// Lectura de un reporte SYNOP de observatorio del SMN-Conagua (PURO): lluvia de las últimas 24 h y grados.
// Formato FM-12 de la OMM: «AAXX ddhhi IIiii iRixhVV Nddff [00fff] 1snTTT … 333 … 7RRRR … [555 …]».

/**
 * Lluvia de las 24 h ANTERIORES al reporte (mm), del grupo 7RRRR de la sección 333 (décimas de mm;
 * 9999 = inapreciable). null si el reporte no lo trae. Los grupos nacionales (555) no cuentan.
 */
export function lluvia24hSynop(synop: string): number | null {
  const s333 = synop.split(/\s333\s/)[1];
  if (!s333) return null;
  const seccion = s333.split(/\s555\s|=/)[0];
  const grupo = seccion.split(/\s+/).find((g) => /^7(\d{4}|\/{4})$/.test(g));
  if (!grupo || grupo.includes("/")) return null;
  const v = Number(grupo.slice(1));
  return v === 9999 ? 0 : v / 10;
}

/** Grados del observatorio (grupo 1snTTT de la sección 1, décimas de °C). null si no viene. */
export function temperaturaSynop(synop: string): number | null {
  const g = synop.split(/\s333\s|=/)[0].trim().split(/\s+/);
  // g[0] AAXX, g[1] ddhhi, g[2] estación, g[3] iRixhVV, g[4] Nddff; con viento ≥ 99 nudos va 00fff.
  let i = 5;
  if (g[4]?.slice(3) === "99" && /^00\d{3}$/.test(g[i] ?? "")) i++;
  const t = g[i];
  if (!t || !/^1[01]\d{3}$/.test(t)) return null;
  const v = Number(t.slice(2)) / 10;
  return t[1] === "1" ? -v : v;
}

export type ReporteLluvia = { t: Date; mm: number; temp: number | null };

/** Un salto mayor a este, sin lluvia en el aeropuerto, espera al siguiente reporte para confirmarse. */
export const SALTO_SOSPECHOSO_MM = 50;

/**
 * Qué reporte de lluvia se muestra: el ÚLTIMO, porque la ventana de 24 h baja sola cuando la lluvia vieja
 * sale (Chetumal 29.2 → 5.2 → 0 el 2-oct; una mediana se quedaba atrasada). Excepción: un salto de más de
 * 50 mm sin lluvia en el aeropuerto en las últimas 3 h se toma como dato suelto raro (Río Verde marcó
 * 155.2 entre 93.9 y 92.7) y se muestra el anterior hasta que el siguiente lo confirme. Con lluvia en el
 * aeropuerto entra al momento (Monterrey 1 → 77 mm con tormenta, la noche del 1 al 2-oct).
 */
export function lluviaConfiable(reportes: readonly ReporteLluvia[] /* del más nuevo al más viejo */, llovioEnAeropuerto: boolean): ReporteLluvia | null {
  const [ultimo, anterior] = reportes;
  if (!ultimo) return null;
  if (anterior && ultimo.mm - anterior.mm > SALTO_SOSPECHOSO_MM && !llovioEnAeropuerto) return anterior;
  return ultimo;
}

/**
 * Renglones de la descarga de OGIMET («76393,2026,10,02,15,00,AAXX …») agrupados por observatorio,
 * del más nuevo al más viejo. Solo los que traen la lluvia de 24 h.
 */
export function reportesPorObservatorio(texto: string): Map<string, ReporteLluvia[]> {
  const porEstacion = new Map<string, ReporteLluvia[]>();
  for (const linea of texto.split("\n")) {
    const p = linea.split(",");
    if (p.length < 7) continue;
    const [wmo, y, mo, d, h, mi] = p;
    const synop = p.slice(6).join(",");
    const mm = lluvia24hSynop(synop);
    if (mm === null) continue;
    const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    if (Number.isNaN(t.getTime())) continue;
    const lista = porEstacion.get(wmo) ?? [];
    lista.push({ t, mm, temp: temperaturaSynop(synop) });
    porEstacion.set(wmo, lista);
  }
  for (const lista of porEstacion.values()) lista.sort((a, b) => b.t.getTime() - a.t.getTime());
  return porEstacion;
}
