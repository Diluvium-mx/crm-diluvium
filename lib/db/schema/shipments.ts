// Guías de envío hechas desde el Detalle del contacto con Envia.com (27-oct-2026, migración 0075;
// docs/envios.md). Una fila = un intento de guía. `request_key` la manda la ventana «Hacer guía» al
// abrirse: un doble clic o un reintento con la misma llave choca con el índice único y NO genera (ni cobra)
// otra guía.
// Estados: generando (se pidió a Envia) → creada | fallida (con el error de Envia tal cual) → cancelada.
// Archivos en el bucket bajo org/{org}/envios/{id}/ (`label_key` = el PDF de Envia; `print_key` = la copia
// lista para imprimir de lib/envia/print-profiles.ts). Al borrar el contacto (ARCO) se van la fila
// (cascade) y la carpeta.
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { contacts } from "./contacts";

export const SHIPMENT_STATUSES = ["generando", "creada", "fallida", "cancelada"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Dirección de quien recibe, como se mandó a Envia. */
export type ShipmentDestination = {
  name: string;
  phone: string;
  email: string | null;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  stateName: string;
  postalCode: string;
  reference: string;
};

/** Un paquete, como se mandó a Envia (`packageName` = el embalaje guardado de Envia, o null si fue a mano). */
export type ShipmentPackage = {
  packageName: string | null;
  content: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  declaredValue: number;
};

export const shipments = pgTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    status: text("status").$type<ShipmentStatus>().notNull().default("generando"),
    // production | sandbox (la cuenta de pruebas de staging): una guía de pruebas nunca se confunde con una real.
    environment: text("environment").notNull(),
    carrier: text("carrier").notNull(),
    service: text("service").notNull(),
    serviceLabel: text("service_label"),
    trackingNumber: text("tracking_number"),
    trackUrl: text("track_url"),
    enviaShipmentId: text("envia_shipment_id"),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    labelUrl: text("label_url"),
    labelKey: text("label_key"),
    printKey: text("print_key"),
    destination: jsonb("destination").$type<ShipmentDestination>().notNull(),
    packages: jsonb("packages").$type<ShipmentPackage[]>().notNull(),
    insured: boolean("insured").notNull().default(false),
    errorMessage: text("error_message"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    canceledAt: timestamp("canceled_at"),
    canceledByUserId: text("canceled_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("shipments_org_request_key_uidx").on(t.organizationId, t.requestKey),
    index("shipments_org_contact_created_idx").on(t.organizationId, t.contactId, t.createdAt),
    check("shipments_status_check", sql`${t.status} in ('generando', 'creada', 'fallida', 'cancelada')`),
    check("shipments_environment_check", sql`${t.environment} in ('sandbox', 'production')`),
  ],
);
