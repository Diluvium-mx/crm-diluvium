"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { db } from "@/lib/db";
import { contacts, contactStageEnum, contactTemperatureEnum } from "@/lib/db/schema/contacts";
import { countryFromPhone, normalizePhone, phoneColumns } from "@/lib/phone";
import { parseGhlContactsCsv } from "@/lib/import/ghl-contacts-csv";
import {
  importParsedContacts,
  type ImportContactsFromCsvResult,
} from "@/lib/import/persist";

export type { ImportContactsFromCsvResult } from "@/lib/import/persist";

async function requireActiveOrganizationId(): Promise<string> {
  return (await requireActiveMembership()).organizationId;
}

// Todos los agentes ven todos los contactos de su organización (CLAUDE.md §5):
// sin filtro por dueño/asignado.
export async function listContacts() {
  const organizationId = await requireActiveOrganizationId();

  return db
    .select()
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .orderBy(desc(contacts.stageChangedAt), desc(contacts.createdAt));
}

/**
 * Contactos por id (tiempo real del kanban: `contact.created` del SSE). Máximo
 * 200 por llamada; siempre acotado a la organización activa.
 */
export async function getContactsByIds(ids: string[]) {
  const organizationId = await requireActiveOrganizationId();
  const wanted = z.array(z.string().min(1)).max(200).parse(ids);
  if (wanted.length === 0) return [];
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.id, wanted)))
    .orderBy(desc(contacts.stageChangedAt), desc(contacts.createdAt));
}

const createContactSchema = z.object({
  firstName: z.string().trim().min(1, "El nombre es obligatorio."),
  lastName: z.string().trim().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.email("Email inválido.").optional().or(z.literal("")),
  stage: z.enum(contactStageEnum.enumValues).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export async function createContact(input: CreateContactInput) {
  const organizationId = await requireActiveOrganizationId();
  const parsed = createContactSchema.parse(input);
  const phoneE164 = parsed.phone ? normalizePhone(parsed.phone) : null;

  const [created] = await db
    .insert(contacts)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      firstName: parsed.firstName,
      lastName: parsed.lastName || null,
      ...phoneColumns(phoneE164),
      country: countryFromPhone(phoneE164),
      email: parsed.email || null,
      stage: parsed.stage ?? "inbox",
    })
    .returning();

  revalidatePath("/embudo");

  return created;
}

const updateContactStageSchema = z.object({
  contactId: z.string().trim().min(1, "contactId es obligatorio."),
  stage: z.enum(contactStageEnum.enumValues),
});

export type UpdateContactStageInput = z.infer<typeof updateContactStageSchema>;

export async function updateContactStage(input: UpdateContactStageInput) {
  const organizationId = await requireActiveOrganizationId();
  const parsed = updateContactStageSchema.parse(input);

  const [updated] = await db
    .update(contacts)
    .set({ stage: parsed.stage, stageChangedAt: new Date() })
    .where(
      and(
        eq(contacts.id, parsed.contactId),
        eq(contacts.organizationId, organizationId),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("Contacto no encontrado en esta organización.");
  }

  revalidatePath("/embudo");

  return updated;
}

const updateContactTemperatureSchema = z.object({
  contactId: z.string().trim().min(1, "contactId es obligatorio."),
  // Nullable: pasar null limpia la temperatura ("Sin asignar").
  temperature: z.enum(contactTemperatureEnum.enumValues).nullable(),
});

export type UpdateContactTemperatureInput = z.infer<typeof updateContactTemperatureSchema>;

export async function updateContactTemperature(input: UpdateContactTemperatureInput) {
  const organizationId = await requireActiveOrganizationId();
  const parsed = updateContactTemperatureSchema.parse(input);

  const [updated] = await db
    .update(contacts)
    .set({ temperature: parsed.temperature })
    .where(
      and(
        eq(contacts.id, parsed.contactId),
        eq(contacts.organizationId, organizationId),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("Contacto no encontrado en esta organización.");
  }

  revalidatePath("/embudo");

  return updated;
}

// Autentica, valida el archivo, parsea y delega la persistencia (upsert
// idempotente por org+ghl_contact_id) en importParsedContacts, que es puro y
// testeable contra Postgres real sin la sesión. Ver las notas de estrategia de
// upsert en lib/import/persist.ts.
export async function importContactsFromCsv(
  formData: FormData,
): Promise<ImportContactsFromCsvResult> {
  const organizationId = await requireActiveOrganizationId();

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Sube un archivo CSV.");
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("El archivo debe tener extensión .csv.");
  }

  // Guarda explícita con mensaje claro (además del bodySizeLimit del Server
  // Action en next.config.ts). 15 MB deja crecer el export de GHL muy por
  // encima de las ~10,900 filas actuales sin volverse una superficie de abuso.
  const MAX_CSV_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_CSV_BYTES) {
    throw new Error(
      `El CSV pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el máximo de 15 MB.`,
    );
  }

  const csvText = await file.text();
  const parsed = parseGhlContactsCsv(csvText);

  if (!parsed.ok) {
    throw new Error(
      `El CSV tiene errores de formato y no se importó nada: ${parsed.errors
        .map((error) => `fila ${error.rowNumber} (${error.code}): ${error.message}`)
        .join("; ")}`,
    );
  }

  const result = await importParsedContacts(db, organizationId, parsed);

  revalidatePath("/embudo");

  return result;
}
