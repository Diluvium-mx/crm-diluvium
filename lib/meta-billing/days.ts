// Días del cobro de Meta (UTC, como su reporte). PURO.
import { utcDay } from "@/lib/ai/billing/days";
import type { MetaPricingDays } from "@/lib/db/schema/meta-billing";

// 1.º del mes anterior (UTC).
export function previousMonthStart(now: Date): string {
  const d = new Date(`${utcDay(now).slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return utcDay(d);
}

// Los días desde `replaceFrom` los manda la lectura nueva; los anteriores se conservan.
export function mergePricingDays(stored: MetaPricingDays, fresh: MetaPricingDays, replaceFrom: string): MetaPricingDays {
  const out: MetaPricingDays = {};
  for (const [day, v] of Object.entries(stored)) if (day < replaceFrom) out[day] = v;
  for (const [day, v] of Object.entries(fresh)) if (day >= replaceFrom) out[day] = v;
  return out;
}
