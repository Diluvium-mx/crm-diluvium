// Crédito mensual de un plan de suscripción para la API de un proveedor de IA (27-nov-2026, pedido del dueño: el plan
// Max de Claude trae US$100 al mes para la API de Anthropic). No es recarga ni gasto propio: llega cada ciclo, se gasta
// ANTES que el saldo comprado y lo que sobra vence al renovarse. PURO: reparte el gasto diario (días UTC) entre el
// crédito de cada ciclo; lo que el crédito no alcanza a cubrir sale del saldo comprado (lib/dashboard/ai-spend.ts).
// Aproximado por día: el proveedor renueva a media tarde del día de renovación y aquí ese día ya es del ciclo nuevo.
import { addDays } from "@/lib/ai/billing/days";

export type PlanCredit = { provider: string; label: string; monthlyUsd: number; renewsDay: number; startsOn: string };

export type PlanCreditStatus = {
  label: string;
  monthlyUsd: number;
  // Ciclo en curso: lo usado del crédito, lo que queda y el día en que vence (el día de renovación).
  usedUsd: number;
  leftUsd: number;
  expiresOn: string;
  // Lo que el crédito cubrió por día desde que empezó (para no descontarlo del saldo comprado).
  coveredByDay: ReadonlyMap<string, number>;
};

const cents = (n: number) => Math.round(n * 100) / 100;

// El primer día estrictamente después de `day` cuyo día del mes es `renewsDay` (1–28).
export function nextRenewal(day: string, renewsDay: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dd = String(renewsDay).padStart(2, "0");
  if (d < renewsDay) return `${y}-${String(m).padStart(2, "0")}-${dd}`;
  return m === 12 ? `${y + 1}-01-${dd}` : `${y}-${String(m + 1).padStart(2, "0")}-${dd}`;
}

// null = el plan todavía no empieza (o `today` es anterior al primer crédito).
export function planCreditStatus(plan: PlanCredit, spendByDay: ReadonlyMap<string, number>, today: string): PlanCreditStatus | null {
  if (today < plan.startsOn) return null;
  const days = [...spendByDay.keys()].filter((d) => d >= plan.startsOn && d <= today).sort();
  const coveredByDay = new Map<string, number>();
  let start = plan.startsOn;
  for (;;) {
    const end = nextRenewal(start, plan.renewsDay);
    let left = plan.monthlyUsd;
    for (const day of days) {
      if (day < start || day >= end) continue;
      const usd = spendByDay.get(day) ?? 0;
      const covered = Math.min(left, usd);
      if (covered > 0) coveredByDay.set(day, covered);
      left -= covered;
    }
    if (today < end) {
      return { label: plan.label, monthlyUsd: plan.monthlyUsd, usedUsd: cents(plan.monthlyUsd - left), leftUsd: cents(left), expiresOn: end, coveredByDay };
    }
    start = end;
    // Por si acaso (fechas corruptas): nunca más de 10 años de ciclos.
    if (start > addDays(today, 3650)) return null;
  }
}

// Suma de lo cubierto por el crédito en los días [desde, hasta).
export function coveredBetween(status: PlanCreditStatus | null, desde: string, hasta: string): number {
  if (!status) return 0;
  let sum = 0;
  for (const [day, usd] of status.coveredByDay) if (day >= desde && day < hasta) sum += usd;
  return sum;
}
