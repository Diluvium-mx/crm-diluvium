// Barra "% de créditos usados" por proveedor en la tarjeta "Gasto de IA" del
// Dashboard. PURO: sale de los números que ya calcula ai-spend.ts (lo gastado desde
// la primera recarga ÷ lo cargado), sin cambiar sus cuentas.
import { formatUsd } from "@/lib/usd-format";
import type { ProviderSpend } from "./ai-spend";

// Desde aquí la barra y su texto pasan a naranja (alerta).
export const SPEND_ALERT_PCT = 80;

export type SpendBar = {
  // Ancho de la barra, 0–100.
  widthPct: number;
  tone: "navy" | "orange";
  // "72 % usado · quedan US$14.20" o "Sin saldo estimado".
  text: string;
  exhausted: boolean;
};

// null = sin recarga registrada: no hay barra (la tarjeta pide registrar una).
export function spendBar(p: Pick<ProviderSpend, "loadedUsd" | "spentSinceFirstUsd" | "balanceUsd">): SpendBar | null {
  if (p.loadedUsd === null) return null;
  const spent = p.spentSinceFirstUsd ?? 0;
  const balance = p.balanceUsd ?? p.loadedUsd - spent;
  const pct = p.loadedUsd > 0 ? (spent / p.loadedUsd) * 100 : 100;
  const exhausted = pct >= 100 || balance <= 0;
  if (exhausted) return { widthPct: 100, tone: "orange", text: "Sin saldo estimado", exhausted: true };
  // Hacia abajo: nunca dice "100 %" mientras quede saldo.
  const shown = Math.max(0, Math.floor(pct));
  return {
    widthPct: Math.max(0, pct),
    tone: pct >= SPEND_ALERT_PCT ? "orange" : "navy",
    text: `${shown} % usado · quedan ${formatUsd(balance)}`,
    exhausted: false,
  };
}
