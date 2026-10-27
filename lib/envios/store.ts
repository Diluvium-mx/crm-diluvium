// Filas de `shipments` (guías de Envia, docs/envios.md). Todo por organización; un id de otra
// organización se comporta como si no existiera.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, shipments, type ShipmentDestination, type ShipmentPackage, type ShipmentStatus } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import type { EnviaEnv } from "@/lib/envia/config";

export type ShipmentRow = typeof shipments.$inferSelect;

/** Lo que ve la sección «Envío» (sin llaves del bucket ni la liga de Envia). */
export type ShipmentView = {
  id: string;
  status: ShipmentStatus;
  environment: EnviaEnv;
  carrier: string;
  serviceLabel: string | null;
  trackingNumber: string | null;
  trackUrl: string | null;
  price: number | null;
  currency: string | null;
  destination: ShipmentDestination;
  errorMessage: string | null;
  createdAt: Date;
  canceledAt: Date | null;
};

export function shipmentView(r: ShipmentRow): ShipmentView {
  return {
    id: r.id,
    status: r.status,
    environment: r.environment === "production" ? "production" : "sandbox",
    carrier: r.carrier,
    serviceLabel: r.serviceLabel,
    trackingNumber: r.trackingNumber,
    trackUrl: r.trackUrl,
    price: r.price === null ? null : Number(r.price),
    currency: r.currency,
    destination: r.destination,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
    canceledAt: r.canceledAt,
  };
}

export async function contactExists(organizationId: string, contactId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
    .limit(1);
  return Boolean(row);
}

/** El teléfono del contacto (para llenar «Teléfono» de la guía). */
export async function contactPhoneE164(organizationId: string, contactId: string): Promise<string | null> {
  const [row] = await db
    .select({ phone: contacts.phoneE164 })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
    .limit(1);
  return row?.phone ?? null;
}

/** Las guías del contacto, la más nueva primero (las fallidas también: su error se ve). */
export async function listContactShipments(organizationId: string, contactId: string, limit = 10): Promise<ShipmentRow[]> {
  return db
    .select()
    .from(shipments)
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.contactId, contactId)))
    .orderBy(desc(shipments.createdAt))
    .limit(limit);
}

/** La dirección de su última guía hecha (para no volver a escribirla). */
export async function lastDestination(organizationId: string, contactId: string): Promise<ShipmentDestination | null> {
  const [row] = await db
    .select({ destination: shipments.destination })
    .from(shipments)
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.contactId, contactId), eq(shipments.status, "creada")))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  return row?.destination ?? null;
}

export async function getShipment(organizationId: string, id: string): Promise<ShipmentRow | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getShipmentByRequestKey(organizationId: string, requestKey: string): Promise<ShipmentRow | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.requestKey, requestKey)))
    .limit(1);
  return row ?? null;
}

export type NewShipment = {
  id: string;
  organizationId: string;
  contactId: string;
  requestKey: string;
  environment: EnviaEnv;
  carrier: string;
  service: string;
  serviceLabel: string | null;
  destination: ShipmentDestination;
  packages: ShipmentPackage[];
  insured: boolean;
  createdByUserId: string;
};

/** Apunta la guía ANTES de pedirla a Envia. `false` = esa llave ya se usó (doble clic o reintento). */
export async function insertPendingShipment(row: NewShipment): Promise<boolean> {
  try {
    await db.insert(shipments).values({ ...row, status: "generando" });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function markShipmentCreated(
  organizationId: string,
  id: string,
  data: {
    trackingNumber: string;
    trackUrl: string | null;
    enviaShipmentId: string | null;
    price: number | null;
    currency: string | null;
    labelUrl: string;
  },
): Promise<void> {
  await db
    .update(shipments)
    .set({
      status: "creada",
      trackingNumber: data.trackingNumber,
      trackUrl: data.trackUrl,
      enviaShipmentId: data.enviaShipmentId,
      price: data.price === null ? null : String(data.price),
      currency: data.currency,
      labelUrl: data.labelUrl,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, id)));
}

export async function markShipmentFailed(organizationId: string, id: string, message: string): Promise<void> {
  await db
    .update(shipments)
    .set({ status: "fallida", errorMessage: message.slice(0, 1000), updatedAt: new Date() })
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, id)));
}

export async function setShipmentFiles(organizationId: string, id: string, files: { labelKey?: string; printKey?: string }): Promise<void> {
  await db
    .update(shipments)
    .set({ ...files, updatedAt: new Date() })
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, id)));
}

export async function markShipmentCanceled(organizationId: string, id: string, userId: string): Promise<boolean> {
  const done = await db
    .update(shipments)
    .set({ status: "cancelada", canceledAt: new Date(), canceledByUserId: userId, updatedAt: new Date() })
    .where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, id), eq(shipments.status, "creada")))
    .returning({ id: shipments.id });
  return done.length > 0;
}

/** Carpeta del bucket de una guía (la borra el ARCO con todo lo que tenga). */
export function shipmentFolder(organizationId: string, id: string): string {
  return `org/${organizationId}/envios/${id}/`;
}
