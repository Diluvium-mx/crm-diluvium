// Barra "% de créditos usados" y texto de "actualizado hace…" por proveedor en la tarjeta
// "Gasto de IA" del Dashboard. PURO: sale de los números que ya calcula ai-spend.ts (lo gastado
// desde la primera recarga ÷ lo cargado), sin cambiar sus cuentas.
import { formatUsd } from "@/lib/usd-format";
import type { ProviderSpend } from "./ai-spend";

// Desde aquí la barra y su texto pasan a naranja (alerta).
export const SPEND_ALERT_PCT = 80;

export type SpendBar = {
  // Ancho de la barra, 0–100.
  widthPct: number;
  tone: "navy" | "orange";
  // "72 % usado · quedan US$14.20", "Sin saldo" o "Sin saldo estimado".
  text: string;
  exhausted: boolean;
};

// null = sin recarga registrada: no hay barra (la tarjeta pide registrar una).
export function spendBar(
  p: Pick<ProviderSpend, "loadedUsd" | "spentSinceFirstUsd" | "balanceUsd">,
  options: { estimated?: boolean } = {},
): SpendBar | null {
  if (p.loadedUsd === null) return null;
  const spent = p.spentSinceFirstUsd ?? 0;
  const balance = p.balanceUsd ?? p.loadedUsd - spent;
  const pct = p.loadedUsd > 0 ? (spent / p.loadedUsd) * 100 : 100;
  const exhausted = pct >= 100 || balance <= 0;
  if (exhausted) return { widthPct: 100, tone: "orange", text: options.estimated === false ? "Sin saldo" : "Sin saldo estimado", exhausted: true };
  // Hacia abajo: nunca dice "100 %" mientras quede saldo.
  const shown = Math.max(0, Math.floor(pct));
  return {
    widthPct: Math.max(0, pct),
    tone: pct >= SPEND_ALERT_PCT ? "orange" : "navy",
    text: `${shown} % usado · quedan ${formatUsd(balance)}`,
    exhausted: false,
  };
}

// Desde aquí la lectura del proveedor se considera vieja (el worker lee cada 5 min).
export const STALE_MINUTES = 20;

// "Actualizado hace 3 min" / "Sin actualizar desde hace 2 h" / "Estimado con el registro del CRM".
export function freshness(p: Pick<ProviderSpend, "source" | "updatedMinutesAgo" | "lastError">): { text: string; tone: "muted" | "orange" } {
  if (p.source === "estimado" || p.updatedMinutesAgo === null) return { text: "Estimado con el registro del CRM", tone: "muted" };
  const m = p.updatedMinutesAgo;
  const ago = m < 1 ? "menos de 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
  if (m >= STALE_MINUTES || p.lastError) return { text: `Sin actualizar desde hace ${ago}`, tone: "orange" };
  return { text: `Actualizado hace ${ago}`, tone: "muted" };
}
