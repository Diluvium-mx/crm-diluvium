// Cotizar, generar y cancelar guías de Envia desde el Detalle del contacto (docs/envios.md).
//
// Generar (cuesta dinero real en producción; reglas fijas del dueño en ./form.ts: una guía por compuerta, valor
// declarado $4,000, nota «Compuerta Anti-Inundaciones», sin seguro):
//  1. La fila se apunta ANTES de pedir la guía, con la llave de la ventana (`request_key`, única): un doble
//     clic o un reintento con la misma llave no genera otra guía.
//  2. Envia contesta con error → la fila queda «fallida» con el mensaje de Envia tal cual (se ve en la UI); el
//     reintento con la misma llave vuelve a pedir esa guía en la misma fila.
//  3. Envia da la guía → la fila queda «creada» EN SEGUIDA (ya se cobró), y después se guardan en el bucket
//     el PDF de Envia y la copia lista para imprimir. Si el bucket falla, la guía sigue creada: la ruta de
//     impresión la arma al primer clic desde la liga de Envia.
import { Readable } from "node:stream";
import { EnviaApiError, type EnviaAddress, type EnviaClient, type RateOption } from "@/lib/envia/client";
import { EnviaNotConfiguredError, type EnviaEnv } from "@/lib/envia/config";
import { buildPrintReadyPdf, printProfileFor } from "@/lib/envia/print-profiles";
import { logError } from "@/lib/log/safe-error";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { ShipmentDestination, ShipmentPackage } from "@/lib/db/schema";
import { createShipmentSchema, FIXED_NOTE, packagesWithValue, shipmentInputSchema, type CreateShipmentInput, type ShipmentInput } from "./form";
import {
  contactExists,
  getShipment,
  getShipmentByRequestKey,
  insertPendingShipment,
  markShipmentCanceled,
  markShipmentCreated,
  markShipmentFailed,
  reopenFailedShipment,
  setShipmentFiles,
  shipmentFolder,
  shipmentView,
  type ShipmentView,
} from "./store";

/** Paquetes que cotiza el CRM (los que usa Diluvium; FAQ 55). */
export const CARRIERS = [
  { id: "paquetexpress", name: "Paquetexpress" },
  { id: "estafeta", name: "Estafeta" },
] as const;

export function carrierName(id: string): string {
  return CARRIERS.find((c) => c.id === id)?.name ?? id;
}

export type EnviosDeps = {
  env: EnviaEnv;
  /** Candado del saldo (lib/envia/config.ts › ENVIA_GENERAR): sin él, generar se niega antes de apuntar nada. */
  canGenerate: boolean;
  /** Origen si en Envia no hay favorita (ENVIA_ORIGEN_CP). */
  originPostalCode?: string | null;
  client: EnviaClient;
  storage: () => ObjectStorage;
};

export type Actor = { organizationId: string; userId: string };

/** Mensaje para el vendedor de un error de Envia o del CRM (nunca un error crudo de código). */
export function errorText(error: unknown): string {
  if (error instanceof EnviaApiError || error instanceof EnviaNotConfiguredError) return error.message;
  return "Algo falló al hablar con Envia. Intenta de nuevo.";
}

export function toEnviaAddress(d: ShipmentDestination): EnviaAddress {
  return {
    name: d.name,
    ...(d.email ? { email: d.email } : {}),
    phone: d.phone,
    street: d.street,
    number: d.number,
    district: d.district,
    city: d.city,
    state: d.state,
    country: "MX",
    postalCode: d.postalCode,
    ...(d.reference ? { reference: d.reference } : {}),
  };
}

/**
 * El origen de las guías: la dirección de origen favorita guardada en Envia; si no hay, la del código postal de
 * ENVIA_ORIGEN_CP; si no, la única que haya.
 */
export async function resolveOrigin(client: EnviaClient, originPostalCode: string | null = null): Promise<EnviaAddress> {
  const origins = await client.listOrigins();
  const byPostalCode = originPostalCode ? origins.filter((o) => o.address.postalCode === originPostalCode) : [];
  const chosen =
    origins.find((o) => o.favorite) ?? (byPostalCode.length === 1 ? byPostalCode[0] : undefined) ?? (origins.length === 1 ? origins[0] : undefined);
  if (!chosen) {
    throw new EnviaApiError(
      origins.length === 0
        ? "En Envia no hay dirección de origen guardada. Agrégala en Envia › Direcciones."
        : "En Envia hay varias direcciones de origen y ninguna es la favorita. Marca la de la oficina como favorita.",
      null,
    );
  }
  return chosen.address;
}

/**
 * Una opción de la cotización para TODAS las compuertas: el mismo servicio en cada caja (una guía por compuerta).
 * `price` y `extendedFare` son la suma de las guías; `perGuide`, el precio de cada una en el orden de las cajas.
 */
export type QuoteOption = RateOption & { perGuide: number[] };

export type QuoteResult = {
  options: QuoteOption[];
  /** Paqueterías que no cotizaron, con el porqué (la otra puede salir igual). */
  errors: { carrier: string; message: string }[];
  /** Cuántas guías serían (una por compuerta). */
  guides: number;
};

/** Junta las cotizaciones de cada caja: solo quedan los servicios que la paquetería dio para TODAS las cajas. */
export function combineRates(perBox: readonly (readonly RateOption[])[]): QuoteOption[] {
  if (perBox.length === 0) return [];
  const out: QuoteOption[] = [];
  for (const first of perBox[0]!) {
    const same = perBox.map((rates) => rates.find((r) => r.carrier === first.carrier && r.service === first.service));
    if (same.some((r) => !r || r.price <= 0)) continue;
    const found = same as RateOption[];
    out.push({
      ...first,
      price: Math.round(found.reduce((s, r) => s + r.price, 0) * 100) / 100,
      extendedFare: Math.round(found.reduce((s, r) => s + r.extendedFare, 0) * 100) / 100,
      perGuide: found.map((r) => r.price),
    });
  }
  return out;
}

export async function quoteShipment(deps: EnviosDeps, actor: Actor, raw: ShipmentInput): Promise<QuoteResult> {
  const input = shipmentInputSchema.parse(raw);
  if (!(await contactExists(actor.organizationId, input.contactId))) throw new EnviaApiError("El contacto ya no existe.", null);
  const origin = await resolveOrigin(deps.client, deps.originPostalCode ?? null);
  const packages = packagesWithValue(input);
  const destination = toEnviaAddress(input.destination);
  const results = await Promise.allSettled(
    CARRIERS.map((c) =>
      Promise.all(packages.map((p) => deps.client.rate({ origin, destination, packages: [{ ...p, insuranceMxn: null }], carrier: c.id }))),
    ),
  );
  const options: QuoteOption[] = [];
  const errors: QuoteResult["errors"] = [];
  results.forEach((r, i) => {
    const carrier = CARRIERS[i]!.id;
    if (r.status === "fulfilled") options.push(...combineRates(r.value));
    else errors.push({ carrier, message: errorText(r.reason) });
  });
  options.sort((a, b) => a.price - b.price);
  return { options, errors, guides: packages.length };
}

/** `shipments` = las guías de esta ventana que ya existen (creadas o la que falló), en el orden de las cajas. */
export type CreateResult = { ok: true; shipments: ShipmentView[] } | { ok: false; message: string; shipments: ShipmentView[] };

export const GENERATE_LOCKED =
  "En este servidor no se generan guías con la cuenta real de Envia (no se gasta saldo): solo se puede cotizar.";

type OneGuide = { ok: true; shipment: ShipmentView } | { ok: false; message: string; shipment?: ShipmentView };

/**
 * Genera UNA guía (una caja) con su llave. Si la llave ya existe: creada o cancelada → se devuelve sin generar;
 * generando → se espera; fallida → se reintenta en la MISMA fila (un reintento nunca duplica una guía creada).
 */
async function createOneGuide(
  deps: EnviosDeps,
  actor: Actor,
  input: ReturnType<typeof createShipmentSchema.parse>,
  pkg: ShipmentPackage,
  requestKey: string,
  origin: EnviaAddress,
): Promise<OneGuide> {
  const { organizationId } = actor;
  let id: string = crypto.randomUUID();
  const inserted = await insertPendingShipment({
    id,
    organizationId,
    contactId: input.contactId,
    requestKey,
    environment: deps.env,
    carrier: input.carrier,
    service: input.service,
    serviceLabel: input.serviceLabel ?? null,
    destination: input.destination,
    packages: [pkg],
    insured: false,
    createdByUserId: actor.userId,
  });
  if (!inserted) {
    const existing = await getShipmentByRequestKey(organizationId, requestKey);
    if (!existing) return { ok: false, message: "Esta guía ya se pidió." };
    if (existing.status === "creada" || existing.status === "cancelada") return { ok: true, shipment: shipmentView(existing) };
    if (existing.status === "generando") return { ok: false, message: "Esta guía ya se está generando. Espera unos segundos.", shipment: shipmentView(existing) };
    const reopened = await reopenFailedShipment(organizationId, requestKey, {
      carrier: input.carrier,
      service: input.service,
      serviceLabel: input.serviceLabel ?? null,
      destination: input.destination,
      packages: [pkg],
    });
    if (!reopened) return { ok: false, message: "Esta guía ya se está generando. Espera unos segundos." };
    id = reopened;
  }

  let label;
  try {
    label = await deps.client.generate(
      {
        origin,
        destination: toEnviaAddress(input.destination),
        packages: [{ ...pkg, insuranceMxn: null }],
        carrier: input.carrier,
        service: input.service,
        comments: FIXED_NOTE,
      },
      printProfileFor(input.carrier).settings,
    );
  } catch (error) {
    const message = errorText(error);
    if (!(error instanceof EnviaApiError)) logError("[envios] falló generar la guía", error);
    await markShipmentFailed(organizationId, id, message);
    const row = await getShipment(organizationId, id);
    return { ok: false, message, ...(row ? { shipment: shipmentView(row) } : {}) };
  }

  await markShipmentCreated(organizationId, id, {
    trackingNumber: label.trackingNumbers.join(", "),
    trackUrl: label.trackUrl,
    enviaShipmentId: label.shipmentId,
    price: label.price,
    currency: label.currency,
    labelUrl: label.labelUrl,
  });
  await storeLabelFiles(deps, organizationId, id, input.carrier, label.labelUrl).catch((error) => {
    logError("[envios] la guía se creó pero no se pudo guardar su PDF (se arma al imprimir)", error);
  });
  const row = await getShipment(organizationId, id);
  if (!row) return { ok: false, message: "La guía se generó pero no se encontró en el CRM. Revisa Envia." };
  return { ok: true, shipment: shipmentView(row) };
}

/**
 * Una guía por compuerta (regla del dueño, 27-oct-2026), en orden. Cada caja tiene su llave (`<llave>:<n>`,
 * también con una sola): el mismo clic repetido no genera ni cobra otra guía. Si una falla, ya no se piden las
 * siguientes; el reintento salta las creadas y vuelve a intentar la que falló.
 */
export async function createShipment(deps: EnviosDeps, actor: Actor, raw: CreateShipmentInput): Promise<CreateResult> {
  if (!deps.canGenerate) return { ok: false, message: GENERATE_LOCKED, shipments: [] };
  const input = createShipmentSchema.parse(raw);
  if (!(await contactExists(actor.organizationId, input.contactId))) return { ok: false, message: "El contacto ya no existe.", shipments: [] };
  const packages = packagesWithValue(input);
  let origin: EnviaAddress;
  try {
    origin = await resolveOrigin(deps.client, deps.originPostalCode ?? null);
  } catch (error) {
    return { ok: false, message: errorText(error), shipments: [] };
  }
  const shipments: ShipmentView[] = [];
  for (const [i, pkg] of packages.entries()) {
    const key = `${input.requestKey}:${i + 1}`;
    const one = await createOneGuide(deps, actor, input, pkg, key, origin);
    if (one.shipment) shipments.push(one.shipment);
    if (!one.ok) {
      const prefix = packages.length > 1 ? `Guía ${i + 1} de ${packages.length}: ` : "";
      return { ok: false, message: `${prefix}${one.message}`, shipments };
    }
  }
  return { ok: true, shipments };
}

async function putPdf(storage: ObjectStorage, key: string, bytes: Uint8Array): Promise<void> {
  await storage.putStream(key, Readable.from(Buffer.from(bytes)), "application/pdf");
}

/** Baja el PDF de Envia y guarda el original y la copia lista para imprimir. Devuelve la copia. */
export async function storeLabelFiles(deps: EnviosDeps, organizationId: string, id: string, carrier: string, labelUrl: string): Promise<Uint8Array> {
  const original = await deps.client.downloadLabel(labelUrl);
  const printReady = await buildPrintReadyPdf(original, carrier);
  const storage = deps.storage();
  const folder = shipmentFolder(organizationId, id);
  const labelKey = `${folder}guia-envia.pdf`;
  const printKey = `${folder}guia-imprimir.pdf`;
  await putPdf(storage, labelKey, original);
  await putPdf(storage, printKey, printReady);
  await setShipmentFiles(organizationId, id, { labelKey, printKey });
  return printReady;
}

export type CancelOutcome = { ok: true; shipment: ShipmentView; refundNote: string } | { ok: false; message: string };

export async function cancelShipment(deps: EnviosDeps, actor: Actor, id: string): Promise<CancelOutcome> {
  const row = await getShipment(actor.organizationId, id);
  if (!row) return { ok: false, message: "Esa guía ya no existe." };
  if (row.status !== "creada" || !row.trackingNumber) return { ok: false, message: "Solo se puede cancelar una guía creada." };
  // Una guía de pruebas no se cancela con el token de producción (ni al revés).
  if (row.environment !== deps.env) return { ok: false, message: "Esta guía es de otra cuenta de Envia (pruebas o real)." };
  let refund;
  try {
    // Con varias cajas se guardan los rastreos separados por coma; Envia cancela por el primero.
    refund = await deps.client.cancel(row.carrier, row.trackingNumber.split(",")[0]!.trim());
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
  await markShipmentCanceled(actor.organizationId, id, actor.userId);
  const updated = await getShipment(actor.organizationId, id);
  return {
    ok: true,
    shipment: shipmentView(updated ?? row),
    refundNote: refund.balanceReturned
      ? "Envia regresa el dinero al saldo (puede tardar unos días)."
      : "Envia canceló la guía, pero no confirmó el reembolso: revísalo en Envia.",
  };
}
