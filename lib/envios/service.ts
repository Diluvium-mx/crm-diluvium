// Cotizar, generar y cancelar guías de Envia desde el Detalle del contacto (docs/envios.md).
//
// Generar (cuesta dinero real en producción):
//  1. La fila se apunta ANTES de pedir la guía, con la llave de la ventana (`request_key`, única): un doble
//     clic o un reintento con la misma llave no genera otra guía.
//  2. Envia contesta con error → la fila queda «fallida» con el mensaje de Envia tal cual (se ve en la UI).
//  3. Envia da la guía → la fila queda «creada» EN SEGUIDA (ya se cobró), y después se guardan en el bucket
//     el PDF de Envia y la copia lista para imprimir. Si el bucket falla, la guía sigue creada: la ruta de
//     impresión la arma al primer clic desde la liga de Envia.
import { Readable } from "node:stream";
import { EnviaApiError, type EnviaAddress, type EnviaClient, type RateOption } from "@/lib/envia/client";
import { EnviaNotConfiguredError, type EnviaEnv } from "@/lib/envia/config";
import { buildPrintReadyPdf, printProfileFor } from "@/lib/envia/print-profiles";
import { logError } from "@/lib/log/safe-error";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { ShipmentDestination } from "@/lib/db/schema";
import { createShipmentSchema, packagesWithValue, shipmentInputSchema, type CreateShipmentInput, type ShipmentInput } from "./form";
import {
  contactExists,
  getShipment,
  getShipmentByRequestKey,
  insertPendingShipment,
  markShipmentCanceled,
  markShipmentCreated,
  markShipmentFailed,
  setShipmentFiles,
  shipmentFolder,
  shipmentView,
  type ShipmentRow,
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

/** El origen de las guías: la dirección favorita de origen guardada en Envia (o la única que haya). */
export async function resolveOrigin(client: EnviaClient): Promise<EnviaAddress> {
  const origins = await client.listOrigins();
  const chosen = origins.find((o) => o.favorite) ?? (origins.length === 1 ? origins[0] : undefined);
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

export type QuoteResult = {
  options: RateOption[];
  /** Paqueterías que no cotizaron, con el porqué (la otra puede salir igual). */
  errors: { carrier: string; message: string }[];
};

export async function quoteShipment(deps: EnviosDeps, actor: Actor, raw: ShipmentInput): Promise<QuoteResult> {
  const input = shipmentInputSchema.parse(raw);
  if (!(await contactExists(actor.organizationId, input.contactId))) throw new EnviaApiError("El contacto ya no existe.", null);
  const origin = await resolveOrigin(deps.client);
  const packages = packagesWithValue(input);
  const request = {
    origin,
    destination: toEnviaAddress(input.destination),
    packages: packages.map((p) => ({ ...p, insuranceMxn: input.insured ? p.declaredValue : null })),
  };
  const results = await Promise.allSettled(CARRIERS.map((c) => deps.client.rate({ ...request, carrier: c.id })));
  const options: RateOption[] = [];
  const errors: QuoteResult["errors"] = [];
  results.forEach((r, i) => {
    const carrier = CARRIERS[i]!.id;
    if (r.status === "fulfilled") options.push(...r.value.filter((o) => o.price > 0));
    else errors.push({ carrier, message: errorText(r.reason) });
  });
  options.sort((a, b) => a.price - b.price);
  return { options, errors };
}

export type CreateResult = { ok: true; shipment: ShipmentView } | { ok: false; message: string; shipment?: ShipmentView };

function existingOutcome(row: ShipmentRow): CreateResult {
  if (row.status === "creada" || row.status === "cancelada") return { ok: true, shipment: shipmentView(row) };
  if (row.status === "fallida") return { ok: false, message: row.errorMessage ?? "Envia no generó la guía.", shipment: shipmentView(row) };
  return { ok: false, message: "Esta guía ya se está generando. Espera unos segundos." };
}

export async function createShipment(deps: EnviosDeps, actor: Actor, raw: CreateShipmentInput): Promise<CreateResult> {
  const input = createShipmentSchema.parse(raw);
  const { organizationId } = actor;
  if (!(await contactExists(organizationId, input.contactId))) return { ok: false, message: "El contacto ya no existe." };
  const packages = packagesWithValue(input);
  const id = crypto.randomUUID();
  const inserted = await insertPendingShipment({
    id,
    organizationId,
    contactId: input.contactId,
    requestKey: input.requestKey,
    environment: deps.env,
    carrier: input.carrier,
    service: input.service,
    serviceLabel: input.serviceLabel ?? null,
    destination: input.destination,
    packages,
    insured: input.insured,
    createdByUserId: actor.userId,
  });
  if (!inserted) {
    const existing = await getShipmentByRequestKey(organizationId, input.requestKey);
    return existing ? existingOutcome(existing) : { ok: false, message: "Esta guía ya se pidió." };
  }

  let label;
  try {
    const origin = await resolveOrigin(deps.client);
    label = await deps.client.generate(
      {
        origin,
        destination: toEnviaAddress(input.destination),
        packages: packages.map((p) => ({ ...p, insuranceMxn: input.insured ? p.declaredValue : null })),
        carrier: input.carrier,
        service: input.service,
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
