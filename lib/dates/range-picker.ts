// Reglas PURAS del calendario de rango (components/ui/date-range-picker.tsx; 23-nov-2026, pedido del dueño: «Desde» y
// «Hasta» en un solo control, como el de Meta Ads). Días como "AAAA-MM-DD" (los mismos del filtro de periodo).
import { addMonths, daysInMonth } from "./picker";

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

function partes(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function addDays(day: string, delta: number): string {
  const { y, m, d } = partes(day);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// "21 nov 2026"
function corto(day: string, conAno: boolean): string {
  const { y, m, d } = partes(day);
  return `${d} ${MESES_CORTOS[m - 1]}${conAno ? ` ${y}` : ""}`;
}

// Lo que dice el botón: "21 nov 2026", "12 nov – 30 nov 2026" o "28 dic 2026 – 3 ene 2027".
export function formatRangeLabel(desde: string, hasta: string): string {
  if (!desde || !hasta) return "Elegir periodo";
  if (desde === hasta) return corto(desde, true);
  const mismoAno = desde.slice(0, 4) === hasta.slice(0, 4);
  return `${corto(desde, !mismoAno)} – ${corto(hasta, true)}`;
}

// "12/11/2026"
export function formatDayDmy(day: string): string {
  const { y, m, d } = partes(day);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

// El renglón de abajo del calendario: "Del 12/11/2026 al 30/11/2026" o "El 21/11/2026".
export function formatRangeSentence(desde: string, hasta: string): string {
  return desde === hasta ? `El ${formatDayDmy(desde)}` : `Del ${formatDayDmy(desde)} al ${formatDayDmy(hasta)}`;
}

export type RangePreset = "hoy" | "ayer" | "7" | "30" | "mes" | "mesPasado";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "ayer", label: "Ayer" },
  { key: "7", label: "Últimos 7 días" },
  { key: "30", label: "Últimos 30 días" },
  { key: "mes", label: "Este mes" },
  { key: "mesPasado", label: "Mes pasado" },
];

// El rango de un atajo según el día de hoy (de la zona del filtro).
export function presetRange(key: RangePreset, today: string): { desde: string; hasta: string } {
  const { y, m } = partes(today);
  switch (key) {
    case "hoy":
      return { desde: today, hasta: today };
    case "ayer": {
      const ayer = addDays(today, -1);
      return { desde: ayer, hasta: ayer };
    }
    case "7":
      return { desde: addDays(today, -6), hasta: today };
    case "30":
      return { desde: addDays(today, -29), hasta: today };
    case "mes":
      return { desde: iso(y, m, 1), hasta: today };
    case "mesPasado": {
      const p = addMonths(y, m, -1);
      return { desde: iso(p.y, p.m, 1), hasta: iso(p.y, p.m, daysInMonth(p.y, p.m)) };
    }
  }
}

// El atajo que corresponde al rango (para marcarlo), si hay.
export function matchingPreset(desde: string, hasta: string, today: string): RangePreset | null {
  for (const { key } of RANGE_PRESETS) {
    const r = presetRange(key, today);
    if (r.desde === desde && r.hasta === hasta) return key;
  }
  return null;
}

// Selección con dos clics: el primero marca el inicio (y el fin, por si solo se quiere un día); el segundo, el fin.
// Si el segundo es antes que el primero, se voltean. Después del segundo, el siguiente clic empieza otro rango.
export type RangeDraft = { desde: string; hasta: string; esperandoFin: boolean };

export function nextRange(draft: RangeDraft, day: string): RangeDraft {
  if (!draft.esperandoFin) return { desde: day, hasta: day, esperandoFin: true };
  return day < draft.desde ? { desde: day, hasta: draft.desde, esperandoFin: false } : { desde: draft.desde, hasta: day, esperandoFin: false };
}

// Cómo se pide a la página: un mes completo (o este mes hasta hoy) va como ?mes=AAAA-MM, igual que antes con el
// calendario «Mes»; cualquier otro rango, como ?desde=&hasta=.
export function rangeQuery(desde: string, hasta: string, today: string): { mes: string } | { desde: string; hasta: string } {
  const a = partes(desde);
  if (a.d === 1 && desde.slice(0, 7) === hasta.slice(0, 7)) {
    const ultimo = iso(a.y, a.m, daysInMonth(a.y, a.m));
    if (hasta === ultimo || (desde.slice(0, 7) === today.slice(0, 7) && hasta === today)) return { mes: desde.slice(0, 7) };
  }
  return { desde, hasta };
}

// Los dos meses que se ven: el del fin del rango a la derecha y el anterior a la izquierda.
export function visibleMonths(hasta: string): { left: { y: number; m: number }; right: { y: number; m: number } } {
  const { y, m } = partes(hasta);
  return { left: addMonths(y, m, -1), right: { y, m } };
}
