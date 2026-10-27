"use server";

// Acciones de la sección «Envío» del Detalle del contacto (guías de Envia, docs/envios.md). La organización
// sale de la sesión. Ver las guías = leer el contacto; hacer o cancelar una = editarlo (vendedor incluido).
import { z, ZodError } from "zod";
import { requireActiveMembership, type ActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { phoneParts } from "@/lib/phone";
import { db } from "@/lib/db";
import { getContactQualification } from "@/lib/contacts/qualification";
import { enviaClient, type SavedPackage, type ZipInfo } from "@/lib/envia/client";
import { enviaConfigFrom, type EnviaEnv } from "@/lib/envia/config";
import { logError } from "@/lib/log/safe-error";
import { objectStorage } from "@/lib/storage/s3";
import type { ShipmentDestination } from "@/lib/db/schema";
import { defaultPackages, firstIssue, type CreateShipmentInput, type PackageDraft, type ShipmentInput } from "@/lib/envios/form";
import {
  cancelShipment,
  createShipment,
  errorText,
  quoteShipment,
  type CancelOutcome,
  type CreateResult,
  type EnviosDeps,
  type QuoteResult,
} from "@/lib/envios/service";
import { contactPhoneE164, lastDestination, listContactShipments, shipmentView, type ShipmentView } from "@/lib/envios/store";

const contactIdSchema = z.string().trim().min(1).max(128);

async function conPermiso(accion: "read" | "update"): Promise<ActiveMembership | null> {
  const m = await requireActiveMembership();
  return roleAllows(m.role, "contact", accion) ? m : null;
}

function depsOrNull(): EnviosDeps | null {
  const config = enviaConfigFrom(process.env);
  if (!config) return null;
  return { env: config.env, canGenerate: config.canGenerate, client: enviaClient(config), storage: objectStorage };
}

const NO_CONFIG = "Envia no está configurado en este servidor. Avísale a Code.";

export type EnvioPanel = { ok: true; env: EnviaEnv | null; shipments: ShipmentView[] } | { ok: false; message: string };

/** Lo que pinta la sección «Envío»: las guías del contacto y si Envia está listo (y con qué cuenta). */
export async function getEnvioPanel(contactId: string): Promise<EnvioPanel> {
  try {
    const m = await conPermiso("read");
    if (!m) return { ok: false, message: "No tienes permiso para ver las guías." };
    const rows = await listContactShipments(m.organizationId, contactIdSchema.parse(contactId));
    return { ok: true, env: enviaConfigFrom(process.env)?.env ?? null, shipments: rows.map(shipmentView) };
  } catch (error) {
    logError("[envios] no se pudieron leer las guías", error);
    return { ok: false, message: "No se pudieron leer las guías." };
  }
}

export type EnvioForm =
  | {
      ok: true;
      env: EnviaEnv;
      /** false = solo cotizar (cuenta real con el candado cerrado). */
      canGenerate: boolean;
      savedPackages: SavedPackage[];
      destination: Partial<ShipmentDestination>;
      packages: PackageDraft[];
      declaredValue: number | null;
      /** Las colonias y el estado del CP que ya viene lleno (de su última guía). */
      zip: ZipInfo | null;
    }
  | { ok: false; message: string };

/** La ventana «Hacer guía» ya llena con lo que se sabe del contacto. */
export async function getEnvioForm(contactId: string): Promise<EnvioForm> {
  try {
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para hacer guías." };
    const deps = depsOrNull();
    if (!deps) return { ok: false, message: NO_CONFIG };
    const id = contactIdSchema.parse(contactId);
    const [details, last, contact] = await Promise.all([
      getContactQualification(db, m.organizationId, id),
      lastDestination(m.organizationId, id),
      contactPhone(m.organizationId, id),
    ]);
    let savedPackages: SavedPackage[] = [];
    try {
      savedPackages = await deps.client.listPackages();
    } catch (error) {
      // Sin embalajes guardados igual se puede hacer la guía con medidas a mano.
      logError("[envios] no se pudieron leer los embalajes de Envia", error);
    }
    const name = [details.firstName, details.lastName].filter(Boolean).join(" ").trim();
    const destination: Partial<ShipmentDestination> = last ?? {
      name,
      phone: contact ?? "",
      email: details.email ?? null,
    };
    const zip = destination.postalCode ? await deps.client.lookupZip(destination.postalCode).catch(() => null) : null;
    return {
      ok: true,
      env: deps.env,
      canGenerate: deps.canGenerate,
      savedPackages,
      destination,
      packages: defaultPackages(details.entradas, savedPackages),
      declaredValue: details.pagoTotal ?? details.montoCotizacion ?? null,
      zip,
    };
  } catch (error) {
    logError("[envios] no se pudo preparar la ventana de la guía", error);
    return { ok: false, message: errorText(error) };
  }
}

async function contactPhone(organizationId: string, contactId: string): Promise<string | null> {
  const parts = phoneParts(await contactPhoneE164(organizationId, contactId));
  return parts.phoneCountryIso === "MX" ? parts.phoneNational : null;
}

export type ZipLookup = { ok: true; zip: ZipInfo | null } | { ok: false; message: string };

export async function buscarCodigoPostal(postalCode: string): Promise<ZipLookup> {
  try {
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para hacer guías." };
    const deps = depsOrNull();
    if (!deps) return { ok: false, message: NO_CONFIG };
    return { ok: true, zip: await deps.client.lookupZip(z.string().trim().max(10).parse(postalCode)) };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

export type CotizarResult = ({ ok: true } & QuoteResult) | { ok: false; message: string };

export async function cotizarEnvio(input: ShipmentInput): Promise<CotizarResult> {
  try {
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para hacer guías." };
    const deps = depsOrNull();
    if (!deps) return { ok: false, message: NO_CONFIG };
    return { ok: true, ...(await quoteShipment(deps, m, input)) };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: firstIssue(error) };
    logError("[envios] no se pudo cotizar", error);
    return { ok: false, message: errorText(error) };
  }
}

export async function generarGuia(input: CreateShipmentInput): Promise<CreateResult> {
  try {
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para hacer guías." };
    const deps = depsOrNull();
    if (!deps) return { ok: false, message: NO_CONFIG };
    return await createShipment(deps, m, input);
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: firstIssue(error) };
    logError("[envios] no se pudo generar la guía", error);
    return { ok: false, message: errorText(error) };
  }
}

export async function cancelarGuia(shipmentId: string): Promise<CancelOutcome> {
  try {
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para cancelar guías." };
    const deps = depsOrNull();
    if (!deps) return { ok: false, message: NO_CONFIG };
    return await cancelShipment(deps, m, z.string().trim().min(1).max(64).parse(shipmentId));
  } catch (error) {
    logError("[envios] no se pudo cancelar la guía", error);
    return { ok: false, message: errorText(error) };
  }
}
