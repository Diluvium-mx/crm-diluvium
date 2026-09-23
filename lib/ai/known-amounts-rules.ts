// Parte PURA de "montos ya vistos" (sin BD): ver known-amounts.ts.
import { extractAmounts, parseAmount } from "@/lib/ai/runtime/output-guard";

export type OutboundLike = { direction: "in" | "out"; source: string; type: string; status: string; body: string | null };

// Puro: montos (en centavos, sin duplicar) de los salientes válidos de un hilo.
export function amountsFromMessages(rows: readonly OutboundLike[]): Set<number> {
  const out = new Set<number>();
  for (const m of rows) {
    if (m.direction !== "out" || !m.body) continue;
    if (m.type === "system_note") continue;
    if (!["crm", "business_app", "ai_agent"].includes(m.source)) continue;
    if (!["sent", "delivered", "read"].includes(m.status)) continue;
    for (const hit of extractAmounts(m.body)) out.add(Math.round(hit.value * 100));
  }
  return out;
}

// Puro: monto reportado en un comprobante ("$5,500", "5500", "5,500.00 MXN").
export function amountFromPayload(payload: Record<string, unknown> | null): number | null {
  const raw = payload?.monto;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100);
  if (typeof raw !== "string") return null;
  const m = raw.replace(/[^\d.,]/g, "");
  if (!m) return null;
  const v = parseAmount(m);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

