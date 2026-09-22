import { isNotNull, sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const contactStageEnum = pgEnum("contact_stage", [
  "inbox",
  "prospecto",
  "interesado",
  "cerca_compra",
  "compra",
]);

// Temperatura del contacto (interés/urgencia), independiente de la etapa.
// Valores semánticos; el emoji vive en la UI (ver _data/types.ts):
// caliente 🔥 · frio 🧊 · en_espera ⏳ · destacado ⭐
export const contactTemperatureEnum = pgEnum("contact_temperature", [
  "caliente",
  "frio",
  "en_espera",
  "destacado",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    phoneE164: text("phone_e164"),
    // Partes del teléfono derivadas de phone_e164 con libphonenumber-js
    // (lib/phone.ts → phoneColumns). phone_e164 sigue siendo la llave; estas
    // sirven para mostrar/filtrar por país y buscar por los 10 dígitos.
    phoneCountryCode: text("phone_country_code"), // "52"
    phoneNational: text("phone_national"), // "6682426364"
    phoneCountryIso: text("phone_country_iso"), // "MX"
    // Business-scoped user ID de WhatsApp (Meta, 2026+): identidad del cliente
    // cuando usa nombre de usuario y el webhook NO trae su teléfono. Se busca
    // por teléfono y, si no hay, por este id; así nunca se descarta un entrante.
    waBsuid: text("wa_bsuid"),
    email: text("email"),
    customFields: jsonb("custom_fields").notNull().default({}),
    // Etiquetas de negocio (GHL y, a futuro, el agente IA/workflows). Se
    // conservan tal cual venían (respetando mayúsculas y acentos); el
    // importador filtra las de sistema antes de guardar. text[] en vez de un
    // modelo normalizado tags/contact_tags: consultable y ampliable después.
    tags: text("tags").array().notNull().default([]),
    // País del contacto (columna Country del export de GHL). Nullable; se
    // guarda para el mapa/segmentación futura, sin uso en la UI de v1.
    country: text("country"),
    ghlContactId: text("ghl_contact_id"),
    source: text("source"),
    sourceChannel: text("source_channel"),
    stage: contactStageEnum("stage").default("inbox").notNull(),
    // Nullable a propósito: sin temperatura asignada hasta que el vendedor la fije.
    temperature: contactTemperatureEnum("temperature"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Marca cuándo se colocó la tarjeta en su etapa actual (al crear y en
    // cada cambio de etapa). El board ordena por esto DESC: el recién movido
    // sube al tope de su columna y ese orden persiste tras revalidar.
    stageChangedAt: timestamp("stage_changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_org_idx").on(table.organizationId),
    // No único a propósito: el import de GHL trae duplicados (fusión aparte).
    // Lo usa la ingesta en cada entrante (CLAUDE.md §5, índice obligatorio).
    index("contacts_org_phone_idx").on(table.organizationId, table.phoneE164),
    // Búsqueda por dígitos (LIKE '6682%'): text_pattern_ops permite prefijo.
    index("contacts_org_phone_national_idx").on(table.organizationId, sql`${table.phoneNational} text_pattern_ops`),
    uniqueIndex("contacts_org_wa_bsuid_uidx")
      .on(table.organizationId, table.waBsuid)
      .where(isNotNull(table.waBsuid)),
    // Parcial: ghl_contact_id es nullable (contactos nativos no vienen de
    // GHL) — un índice único normal rechazaría más de un NULL solo en
    // MySQL; en Postgres los NULL ya se consideran distintos entre sí, pero
    // el .where() deja explícito que la unicidad solo aplica al
    // re-emparejado con GHL, no a todas las filas.
    uniqueIndex("contacts_org_ghl_contact_id_uidx")
      .on(table.organizationId, table.ghlContactId)
      .where(isNotNull(table.ghlContactId)),
  ],
);
