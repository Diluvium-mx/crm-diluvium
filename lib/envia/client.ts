// Cliente de la API de Envia.com (docs.envia.com, revisado el 26-oct-2026). Solo lo que usa la Fase 1:
// código postal (geocodes), embalajes y origen guardados (queries), cotizar, generar, cancelar y bajar la
// etiqueta. Cada respuesta se lee con Zod y de forma tolerante (Envia agrega campos).
//
// Trampas documentadas:
// - Algunos errores llegan con HTTP 200 y `"meta": "error"` en el cuerpo: se revisa `meta` SIEMPRE.
// - Cotizar acepta UNA paquetería por llamada (`shipment.carrier` obligatorio en la práctica).
// - `totalPrice` llega como texto en rate y como número en generate.
// - El estado va con el código de Envia de 2 letras (Sinaloa = SI), no el ISO ni el de Shopify.
import { safeFetch, type ResolveHost } from "@/lib/net/safe-fetch";
import { z } from "zod";
import type { EnviaConfig } from "./config";

const TIMEOUT_MS = 20_000;
// La etiqueta es un PDF chico (una guía son decenas de KB); el tope evita leer algo raro sin fin.
export const LABEL_MAX_BYTES = 5 * 1024 * 1024;
// Envia sirve la etiqueta desde su propio dominio o desde S3 (ejemplo oficial: s3.us-east-2.amazonaws.com).
export const LABEL_HOSTS = ["envia.com", "amazonaws.com"] as const;

export class EnviaApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

// ── Tipos que entran ───────────────────────────────────────────────────────────

export type EnviaAddress = {
  name: string;
  company?: string;
  email?: string;
  phone: string;
  street: string;
  number?: string;
  district?: string;
  city: string;
  /** Código de Envia de 2–3 letras (geocodes › state.code.2digit). */
  state: string;
  country: "MX";
  postalCode: string;
  reference?: string;
};

export type EnviaPackage = {
  content: string;
  declaredValue: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Valor asegurado en MXN, o null sin seguro. */
  insuranceMxn: number | null;
};

export type ShipmentRequest = {
  origin: EnviaAddress;
  destination: EnviaAddress;
  packages: readonly EnviaPackage[];
  carrier: string;
  service?: string;
};

export type LabelSettings = { printFormat: "PDF"; printSize: "PAPER_LETTER" | "PAPER_4X6" | "STOCK_4X6" | "PAPER_7X4.75" };

// ── Tipos que salen ────────────────────────────────────────────────────────────

export type ZipInfo = { postalCode: string; state: string; stateName: string; city: string; colonias: string[] };
export type SavedPackage = {
  id: string;
  name: string;
  /** Lo que dice «Contenido» del embalaje en Envia (p. ej. «Compuerta Anti-Inundaciones»), o null. */
  content: string | null;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
};
export type RateOption = {
  carrier: string;
  service: string;
  serviceLabel: string;
  price: number;
  currency: string;
  /** «3-5 business days» o lo que mande la paquetería; null si no viene. */
  delivery: string | null;
};
export type GeneratedLabel = {
  shipmentId: string | null;
  trackingNumber: string;
  trackingNumbers: string[];
  trackUrl: string | null;
  labelUrl: string;
  price: number | null;
  currency: string | null;
  balance: number | null;
};
export type CancelResult = { balanceReturned: boolean; balanceReturnDate: string | null };

export type EnviaClient = {
  lookupZip(postalCode: string): Promise<ZipInfo | null>;
  listPackages(): Promise<SavedPackage[]>;
  listOrigins(): Promise<{ address: EnviaAddress; favorite: boolean }[]>;
  rate(request: ShipmentRequest): Promise<RateOption[]>;
  generate(request: ShipmentRequest & { service: string }, settings: LabelSettings): Promise<GeneratedLabel>;
  cancel(carrier: string, trackingNumber: string): Promise<CancelResult>;
  downloadLabel(url: string): Promise<Uint8Array>;
};

// ── Lectura de respuestas ──────────────────────────────────────────────────────

const num = z.union([z.number(), z.string().trim().min(1)]).transform((v) => Number(v)).pipe(z.number().finite());
const optText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()));

/** El mensaje de error que mande Envia, en cualquiera de sus formas conocidas. */
export function enviaErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.description].filter((p): p is string => typeof p === "string" && p.trim() !== "");
    if (parts.length) return [...new Set(parts)].join(" · ");
  }
  if (typeof err === "string" && err.trim()) return err.trim();
  if (typeof b.message === "string" && b.message.trim()) return b.message.trim();
  if (Array.isArray(b.errors) && b.errors.length) {
    return b.errors.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
  }
  return null;
}

const zipSchema = z.array(
  z.object({
    zip_code: z.string(),
    state: z.object({ name: z.string(), code: z.object({ "2digit": z.string().nullish(), "3digit": z.string().nullish() }) }),
    locality: z.string().nullish(),
    regions: z.object({ region_2: z.string().nullish() }).partial().nullish(),
    suburbs: z.array(z.string()).nullish(),
  }),
);

export function parseZip(body: unknown): ZipInfo | null {
  const parsed = zipSchema.safeParse(body);
  if (!parsed.success || parsed.data.length === 0) return null;
  const first = parsed.data[0]!;
  const state = first.state.code["2digit"] ?? first.state.code["3digit"];
  if (!state) return null;
  const colonias = [...new Set(parsed.data.flatMap((row) => row.suburbs ?? []).map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es-MX"),
  );
  return {
    postalCode: first.zip_code,
    state,
    stateName: first.state.name,
    city: first.locality?.trim() || first.regions?.region_2?.trim() || "",
    colonias,
  };
}

// Embalajes guardados. La cuenta real (27-oct-2026) NO contesta como la documentación (`data: [{id, name, …}]`): manda
// `data: { userPackages, companyPackages, shopPackages }` con `package_id`, el nombre en `description`, `content` y
// las unidades (`length_unit`, `weight_unit`). Se leen las dos formas; pulgadas y libras se pasan a cm y kg.
const packageRowSchema = z
  .object({
    id: z.union([z.number(), z.string()]).nullish(),
    package_id: z.union([z.number(), z.string()]).nullish(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    content: z.string().nullish(),
    length: num,
    width: num,
    height: num,
    weight: num,
    length_unit: z.string().nullish(),
    weight_unit: z.string().nullish(),
  })
  .passthrough();
type PackageRow = z.infer<typeof packageRowSchema>;

const packagesSchema = z.object({
  data: z.union([
    z.array(packageRowSchema),
    z
      .object({
        userPackages: z.array(packageRowSchema).nullish(),
        companyPackages: z.array(packageRowSchema).nullish(),
        shopPackages: z.array(packageRowSchema).nullish(),
      })
      .passthrough(),
  ]),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

function savedPackage(p: PackageRow): SavedPackage | null {
  const id = p.package_id ?? p.id;
  const name = (p.description ?? p.name)?.trim();
  if (id === null || id === undefined || !name) return null;
  const toCm = p.length_unit?.trim().toUpperCase() === "IN" ? 2.54 : 1;
  const toKg = p.weight_unit?.trim().toUpperCase() === "LB" ? 0.45359237 : 1;
  return {
    id: String(id),
    name,
    content: p.content?.trim() || null,
    lengthCm: round2(p.length * toCm),
    widthCm: round2(p.width * toCm),
    heightCm: round2(p.height * toCm),
    weightKg: round2(p.weight * toKg),
  };
}

export function parsePackages(body: unknown): SavedPackage[] {
  const parsed = packagesSchema.safeParse(body);
  if (!parsed.success) throw new EnviaApiError("Envia mandó los embalajes en un formato que el CRM no reconoce.", null);
  const data = parsed.data.data;
  const rows = Array.isArray(data) ? data : [...(data.userPackages ?? []), ...(data.companyPackages ?? []), ...(data.shopPackages ?? [])];
  const seen = new Set<string>();
  const out: SavedPackage[] = [];
  for (const row of rows) {
    const p = savedPackage(row);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

// El origen guardado no tiene esquema documentado (solo `data: array`): se lee con los nombres de campo
// que usa Envia en el resto de su API, en camelCase o snake_case.
const originSchema = z.object({ data: z.array(z.record(z.string(), z.unknown())) });

function pick(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if ((typeof v === "string" || typeof v === "number") && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export function parseOrigins(body: unknown): { address: EnviaAddress; favorite: boolean }[] {
  const parsed = originSchema.safeParse(body);
  if (!parsed.success) throw new EnviaApiError("Envia mandó las direcciones de origen en un formato que el CRM no reconoce.", null);
  const out: { address: EnviaAddress; favorite: boolean }[] = [];
  for (const row of parsed.data.data) {
    const name = pick(row, "name", "contact_name", "contactName");
    const phone = pick(row, "phone");
    const street = pick(row, "street", "address1");
    const city = pick(row, "city", "city_name");
    const state = pick(row, "state", "state_code", "stateCode");
    const postalCode = pick(row, "postalCode", "postal_code", "zipcode", "zip_code");
    if (!name || !phone || !street || !city || !state || !postalCode) continue;
    const fav = row.is_favorite ?? row.isFavorite ?? row.favorite ?? row.is_default ?? row.isDefault ?? row.default;
    out.push({
      address: {
        name,
        company: pick(row, "company") ?? undefined,
        email: pick(row, "email") ?? undefined,
        phone,
        street,
        number: pick(row, "number", "street_number", "streetNumber") ?? undefined,
        district: pick(row, "district", "suburb") ?? undefined,
        city,
        state,
        country: "MX",
        postalCode,
        reference: pick(row, "reference") ?? undefined,
      },
      favorite: fav === true || fav === 1 || fav === "1" || fav === "true",
    });
  }
  return out;
}

const rateSchema = z.object({
  data: z.array(
    z
      .object({
        carrier: z.string(),
        service: z.string(),
        serviceDescription: z.string().nullish(),
        deliveryEstimate: z.string().nullish(),
        totalPrice: num,
        currency: z.string().nullish(),
      })
      .passthrough(),
  ),
});

export function parseRates(body: unknown): RateOption[] {
  const parsed = rateSchema.safeParse(body);
  if (!parsed.success) throw new EnviaApiError("Envia mandó la cotización en un formato que el CRM no reconoce.", null);
  return parsed.data.data.map((r) => ({
    carrier: r.carrier,
    service: r.service,
    serviceLabel: r.serviceDescription?.trim() || r.service,
    price: Math.round(r.totalPrice * 100) / 100,
    currency: r.currency?.trim() || "MXN",
    delivery: r.deliveryEstimate?.trim() || null,
  }));
}

const generateSchema = z.object({
  data: z
    .array(
      z
        .object({
          shipmentId: optText,
          trackingNumber: z.union([z.string(), z.number()]).transform(String),
          trackingNumbers: z.array(z.union([z.string(), z.number()]).transform(String)).nullish(),
          trackUrl: optText,
          label: z.string().min(1),
          totalPrice: num.nullish(),
          currentBalance: num.nullish(),
          currency: optText,
        })
        .passthrough(),
    )
    .min(1),
});

export function parseGenerated(body: unknown): GeneratedLabel {
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) throw new EnviaApiError("Envia contestó sin guía (falta el número de rastreo o la etiqueta).", null);
  const first = parsed.data.data[0]!;
  const tracking = [...new Set(parsed.data.data.flatMap((d) => [d.trackingNumber, ...(d.trackingNumbers ?? [])]))];
  return {
    shipmentId: first.shipmentId,
    trackingNumber: first.trackingNumber,
    trackingNumbers: tracking,
    trackUrl: first.trackUrl,
    labelUrl: first.label,
    price: first.totalPrice ?? null,
    currency: first.currency,
    balance: first.currentBalance ?? null,
  };
}

const cancelSchema = z.object({
  data: z.object({ balanceReturned: z.union([z.boolean(), z.string(), z.number()]).nullish(), balanceReturnDate: optText }).passthrough(),
});

export function parseCancel(body: unknown): CancelResult {
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) throw new EnviaApiError("Envia contestó la cancelación en un formato que el CRM no reconoce.", null);
  const r = parsed.data.data.balanceReturned;
  return { balanceReturned: r === true || r === 1 || r === "true" || r === "1", balanceReturnDate: parsed.data.data.balanceReturnDate };
}

// ── Peticiones ─────────────────────────────────────────────────────────────────

function addressBody(a: EnviaAddress) {
  return {
    name: a.name,
    ...(a.company ? { company: a.company } : {}),
    ...(a.email ? { email: a.email } : {}),
    phone: a.phone,
    street: a.street,
    ...(a.number ? { number: a.number } : {}),
    ...(a.district ? { district: a.district } : {}),
    city: a.city,
    state: a.state,
    country: a.country,
    postalCode: a.postalCode,
    ...(a.reference ? { reference: a.reference } : {}),
  };
}

export function shipmentBody(request: ShipmentRequest, settings?: LabelSettings) {
  return {
    origin: addressBody(request.origin),
    destination: addressBody(request.destination),
    packages: request.packages.map((p) => ({
      type: "box",
      content: p.content,
      amount: 1,
      declaredValue: p.declaredValue,
      lengthUnit: "CM",
      weightUnit: "KG",
      weight: p.weightKg,
      dimensions: { length: p.lengthCm, width: p.widthCm, height: p.heightCm },
      ...(p.insuranceMxn !== null ? { additionalServices: [{ service: "envia_insurance", data: { amount: String(p.insuranceMxn) } }] } : {}),
    })),
    shipment: { type: 1, carrier: request.carrier, ...(request.service ? { service: request.service } : {}) },
    settings: { currency: "MXN", ...(settings ?? {}) },
  };
}

export function enviaClient(config: EnviaConfig, deps: { fetchImpl?: typeof fetch; resolve?: ResolveHost } = {}): EnviaClient {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function call(url: string, init: { method: "GET" | "POST"; body?: unknown; auth: boolean }): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: init.method,
        headers: {
          Accept: "application/json",
          ...(init.auth ? { Authorization: `Bearer ${config.token}` } : {}),
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new EnviaApiError(timedOut ? "Envia tardó demasiado en contestar." : "No se pudo conectar con Envia.", null);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const meta = body && typeof body === "object" ? (body as Record<string, unknown>).meta : undefined;
    if (!res.ok || meta === "error") {
      const detail = enviaErrorMessage(body);
      if (res.status === 401 || res.status === 403) throw new EnviaApiError(`Envia rechazó el token (${res.status}). ${detail ?? ""}`.trim(), res.status);
      if (res.status === 402) throw new EnviaApiError("No hay saldo suficiente en Envia.", res.status);
      throw new EnviaApiError(detail ?? `Envia contestó con error ${res.status}.`, res.status);
    }
    return body;
  }

  return {
    async lookupZip(postalCode) {
      const cp = postalCode.trim();
      if (!/^\d{5}$/.test(cp)) return null;
      return parseZip(await call(`${config.geocodesUrl}/zipcode/MX/${cp}`, { method: "GET", auth: false }));
    },
    async listPackages() {
      return parsePackages(await call(`${config.queriesUrl}/packages`, { method: "GET", auth: true }));
    },
    async listOrigins() {
      return parseOrigins(await call(`${config.queriesUrl}/all-addresses/origin`, { method: "GET", auth: true }));
    },
    async rate(request) {
      return parseRates(await call(`${config.shipUrl}/ship/rate/`, { method: "POST", body: shipmentBody(request), auth: true }));
    },
    async generate(request, settings) {
      // Segunda barrera del candado del saldo (la primera está en lib/envios/service.ts): nunca se pide una guía con
      // la cuenta real sin ENVIA_GENERAR=si.
      if (!config.canGenerate) throw new EnviaApiError("Generar guías está apagado en este servidor (no se gasta saldo).", null);
      return parseGenerated(await call(`${config.shipUrl}/ship/generate/`, { method: "POST", body: shipmentBody(request, settings), auth: true }));
    },
    async cancel(carrier, trackingNumber) {
      return parseCancel(await call(`${config.shipUrl}/ship/cancel/`, { method: "POST", body: { carrier, trackingNumber }, auth: true }));
    },
    async downloadLabel(url) {
      let res: Response;
      try {
        res = await safeFetch(url, { fetchImpl, resolve: deps.resolve, allowedHosts: LABEL_HOSTS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (error) {
        throw new EnviaApiError(`No se pudo bajar la etiqueta de Envia: ${error instanceof Error ? error.message : String(error)}`, null);
      }
      if (!res.ok) throw new EnviaApiError(`No se pudo bajar la etiqueta de Envia (error ${res.status}).`, res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new EnviaApiError("Envia mandó la etiqueta vacía.", null);
      if (bytes.byteLength > LABEL_MAX_BYTES) throw new EnviaApiError("La etiqueta de Envia pesa demasiado.", null);
      return bytes;
    },
  };
}
