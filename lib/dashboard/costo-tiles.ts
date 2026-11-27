// Tarjetas chicas de costos del Dashboard (20-nov-2026, opción A del dueño): una por servicio, con su cifra del mes y
// una línea; al hacer clic se abre la tarjeta completa. Los avisos (pago pendiente, lectura vieja, saldo bajo) salen
// en la línea en naranja para que se vean aunque la tarjeta esté cerrada. PURO: recibe los resúmenes ya calculados.
import { freshness, spendBar } from "./ai-spend-bar";
import type { AiSpendSummary, ProviderSpend } from "./ai-spend";
import { metaFreshness, type MetaWhatsappSummary } from "./meta-whatsapp";
import { railwayFreshness, type RailwaySummary } from "./railway";
import { ZERNIO_FREE_MESSAGES, zernioFreshness, type ZernioSummary } from "./zernio";
import { formatUsd } from "@/lib/usd-format";

export type TileResumen = { value: string; sub: string; tone: "muted" | "orange" };

const whole = new Intl.NumberFormat("es-MX");
const money = (usd: number | null) => (usd === null ? "—" : formatUsd(usd));

// Proveedores sin gasto este mes y sin nada que avisar: en la tarjeta de IA van juntos en una sola línea.
export function isIdleProvider(p: ProviderSpend): boolean {
  if (Math.round(p.monthUsd * 100) !== 0 || p.lastError) return false;
  if (freshness(p).tone === "orange") return false;
  return spendBar(p, { estimated: p.source === "estimado" })?.tone !== "orange";
}

// Lo que el proveedor puede gastar todavía: el saldo comprado más lo que queda del crédito del plan (27-nov-2026).
function disponible(p: ProviderSpend): number {
  return Math.max(0, p.balanceUsd ?? 0) + (p.plan?.leftUsd ?? 0);
}

export function iaTile(spend: AiSpendSummary): TileResumen {
  const value = formatUsd(spend.providers.reduce((sum, p) => sum + p.monthUsd, 0));
  const stale = spend.providers.find((p) => freshness(p).tone === "orange");
  if (stale) return { value, sub: `${stale.label}: ${freshness(stale).text.toLowerCase()}`, tone: "orange" };
  const withBalance = spend.providers
    .filter((p) => !isIdleProvider(p) && p.balanceUsd !== null && spendBar(p, { estimated: p.source === "estimado" }))
    .sort((a, b) => disponible(a) - disponible(b));
  const low = withBalance[0];
  if (!low) return { value, sub: "Registra una recarga para ver el saldo", tone: "muted" };
  const tone = spendBar(low, { estimated: low.source === "estimado" })?.tone === "orange" ? "orange" : "muted";
  return { value, sub: `Saldo más bajo: ${formatUsd(disponible(low))} (${low.label}${low.plan ? ", con el crédito del plan" : ""})`, tone };
}

export function metaTile(meta: MetaWhatsappSummary): TileResumen {
  const value = money(meta.totalUsd);
  const fresh = metaFreshness(meta);
  if (fresh.tone === "orange") return { value, sub: fresh.text, tone: "orange" };
  return { value, sub: meta.charged === 1 ? "1 mensaje cobrado" : `${whole.format(meta.charged)} mensajes cobrados`, tone: "muted" };
}

export function railwayTile(railway: RailwaySummary): TileResumen {
  const value = railway.estimatedBillUsd === null ? money(railway.usageUsd) : `≈ ${formatUsd(railway.estimatedBillUsd)}`;
  if (railway.billingAlert) return { value, sub: "Pago pendiente: ábrela", tone: "orange" };
  const fresh = railwayFreshness(railway);
  if (fresh.tone === "orange") return { value, sub: fresh.text, tone: "orange" };
  if (railway.estimatedBillUsd === null) return { value, sub: "Uso del periodo", tone: "muted" };
  return { value, sub: railway.periodEndLabel ? `Estimado al ${railway.periodEndLabel}` : "Factura estimada", tone: "muted" };
}

export function zernioTile(zernio: ZernioSummary): TileResumen {
  const value = zernio.estimatedBillUsd === null ? money(zernio.totalUsd) : `≈ ${formatUsd(zernio.estimatedBillUsd)}`;
  if (zernio.billingAlert) return { value, sub: "Pago pendiente: ábrela", tone: "orange" };
  const fresh = zernioFreshness(zernio);
  if (fresh.tone === "orange") return { value, sub: fresh.text, tone: "orange" };
  if (zernio.sentCount === null) return { value, sub: "Factura estimada", tone: "muted" };
  if (zernio.sentCount >= ZERNIO_FREE_MESSAGES) return { value, sub: `Pasó los ${whole.format(ZERNIO_FREE_MESSAGES)} mensajes gratis`, tone: "muted" };
  return { value, sub: `${whole.format(zernio.sentCount)} de ${whole.format(ZERNIO_FREE_MESSAGES)} gratis`, tone: "muted" };
}
