// Días UTC ("YYYY-MM-DD") de los reportes de cobro. PURO. Los proveedores cortan sus
// reportes por día UTC (igual que la consola de Anthropic), no por día de Mazatlán.
import type { BillingDay, BillingDays } from "@/lib/db/schema/ai-billing";

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
}

export function dayStartIso(day: string): string {
  return `${day}T00:00:00Z`;
}

export function monthStartUtc(now: Date): string {
  return `${utcDay(now).slice(0, 7)}-01`;
}

// 8 decimales: suficiente para centavos acumulados sin ruido de punto flotante.
export const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

// Suma `amount` al día y al grupo (`todo` siempre; `prod`/`pruebas` si se indica).
export function addToDay(days: BillingDays, day: string, amount: number, group?: "prod" | "pruebas"): void {
  const cur: BillingDay = days[day] ?? { todo: 0 };
  cur.todo = round8(cur.todo + amount);
  if (group) cur[group] = round8((cur[group] ?? 0) + amount);
  days[day] = cur;
}

// Junta lo guardado con una lectura nueva: los días desde `replaceFrom` los manda la lectura
// nueva (aunque no traiga un día: ese día ya no tiene gasto); los anteriores se conservan.
export function mergeDays(stored: BillingDays, fresh: BillingDays, replaceFrom: string): BillingDays {
  const out: BillingDays = {};
  for (const [day, v] of Object.entries(stored)) if (day < replaceFrom) out[day] = v;
  for (const [day, v] of Object.entries(fresh)) if (day >= replaceFrom) out[day] = v;
  return out;
}
