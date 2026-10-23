// Cobro de Zernio (23-oct-2026): lee el consumo del mes (`GET /v1/usage?range=cycle`, el mismo
// detalle que la factura), el del mes anterior (`range=prev-cycle`) y el estado del cobro
// (`GET /v1/billing`: cuenta suspendida, tarjeta rechazada, factura abierta). Solo LEE: no cambia
// nada ni cuesta nada.
//
// Llave: la misma ZERNIO_API_KEY con la que el CRM manda mensajes (ya está en el worker); la base,
// ZERNIO_BASE_URL si existe. Va en el encabezado Authorization. Detalle: docs/zernio-costos.md.
import { z } from "zod";

const DEFAULT_BASE_URL = "https://zernio.com/api";
const TIMEOUT_MS = 20_000;
const BODY_PREVIEW = 200;

export type ZernioBillingConfig = { apiKey: string; baseUrl: string };

export type GetLike = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

// null = falta la llave: el worker no lee nada y la tarjeta no aparece.
export function zernioBillingConfigFromEnv(env: Record<string, string | undefined> = process.env): ZernioBillingConfig | null {
  const apiKey = env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.ZERNIO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  return { apiKey, baseUrl };
}

// Quita la llave de un texto de error (por si Zernio la repitiera).
export function redactZernioKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("[llave oculta]") : text;
}

export type ZernioReading = {
  periodStart: Date | null;
  periodEnd: Date | null;
  totalUsd: number;
  messagesUsd: number;
  accountsUsd: number;
  prevTotalUsd: number | null;
  prevPeriodStart: Date | null;
  suspended: boolean;
  declineReason: string | null;
  openInvoice: boolean;
};

const date = z
  .string()
  .nullish()
  .transform((v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  });

const money = z.number().nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));

const usageSchema = z.object({
  supported: z.boolean().nullish(),
  period: z.object({ start: date, end: date }).nullish(),
  // `totals` = la factura por concepto, ya con el crédito gratis aplicado (Zernio: «match the invoice
  // line for line»). Los demás conceptos (números, llamadas, SMS, anuncios…) solo suman al total.
  totals: z.object({ total: money, messages: money, accounts: money }).nullish(),
});

const billingSchema = z.object({
  status: z
    .object({
      hasAccess: z.boolean().nullish(),
      suspended: z.boolean().nullish(),
      declineReason: z.string().nullish(),
      openInvoiceUrl: z.string().nullish(),
    })
    .nullish(),
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type ZernioUsage = { periodStart: Date | null; periodEnd: Date | null; totalUsd: number; messagesUsd: number; accountsUsd: number };

// PURO: respuesta de `/v1/usage` → consumo. Lanza si Zernio dice que no lo da o no trae totales.
export function parseZernioUsage(json: unknown): ZernioUsage {
  const parsed = usageSchema.parse(json);
  if (parsed.supported === false) throw new Error("Zernio no da el consumo de esta cuenta");
  if (!parsed.totals) throw new Error("Zernio no devolvió los totales del mes");
  return {
    periodStart: parsed.period?.start ?? null,
    periodEnd: parsed.period?.end ?? null,
    totalUsd: round6(parsed.totals.total),
    messagesUsd: round6(parsed.totals.messages),
    accountsUsd: round6(parsed.totals.accounts),
  };
}

// PURO: respuesta de `/v1/billing` → estado del cobro. Sin acceso cuenta como suspendida. El enlace
// de la factura abierta no se guarda: solo si hay una.
export function parseZernioBillingStatus(json: unknown): Pick<ZernioReading, "suspended" | "declineReason" | "openInvoice"> {
  const status = billingSchema.parse(json).status;
  const reason = status?.declineReason?.trim();
  return {
    suspended: status?.suspended === true || status?.hasAccess === false,
    declineReason: reason ? reason.slice(0, BODY_PREVIEW) : null,
    openInvoice: Boolean(status?.openInvoiceUrl?.trim()),
  };
}

async function getJson(config: ZernioBillingConfig, path: string, fetchImpl: GetLike): Promise<unknown> {
  const res = await fetchImpl(`${config.baseUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Zernio respondió ${res.status}: ${redactZernioKey(body.replace(/\s+/g, " "), config.apiKey).slice(0, BODY_PREVIEW)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Zernio respondió algo que no es JSON (${res.status})`);
  }
}

export async function readZernioBilling(config: ZernioBillingConfig, options: { fetchImpl?: GetLike } = {}): Promise<ZernioReading> {
  const fetchImpl: GetLike = options.fetchImpl ?? fetch;
  const [cycle, billing] = await Promise.all([
    getJson(config, "/v1/usage?range=cycle", fetchImpl).then(parseZernioUsage),
    getJson(config, "/v1/billing", fetchImpl).then(parseZernioBillingStatus),
  ]);
  // El mes anterior es un extra: si falla, la tarjeta sale igual sin él.
  const prev = await getJson(config, "/v1/usage?range=prev-cycle", fetchImpl)
    .then(parseZernioUsage)
    .catch(() => null);
  return {
    ...cycle,
    prevTotalUsd: prev ? prev.totalUsd : null,
    prevPeriodStart: prev ? prev.periodStart : null,
    ...billing,
  };
}
