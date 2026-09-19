"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { db } from "@/lib/db";
import { contacts, contactStageEnum, contactTemperatureEnum } from "@/lib/db/schema/contacts";
import { normalizePhone } from "@/lib/phone";
import { parseGhlContactsCsv } from "@/lib/import/ghl-contacts-csv";

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
      phoneE164,
      email: parsed.email || null,
      stage: parsed.stage ?? "inbox",
    })
    .returning();

  revalidatePath("/contactos");

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

  revalidatePath("/contactos");

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

  revalidatePath("/contactos");

  return updated;
}

export interface ImportContactsFromCsvResult {
  imported: number;
  updated: number;
  invalidPhones: number;
  skipped: number;
}

// Upsert atómico por (organization_id, ghl_contact_id) vía
// INSERT ... ON CONFLICT DO UPDATE sobre el índice único parcial
// contacts_org_ghl_contact_id_uidx (lib/db/schema/contacts.ts): un
// select-then-insert deja una ventana entre el SELECT y el INSERT donde dos
// importaciones simultáneas pueden ver el mismo contacto como inexistente y
// una de las dos revienta contra el índice único, tumbando toda su
// transacción (hallazgo Codex). `stage` nunca se toca en el UPDATE —
// re-sincronizar desde GHL no debe resetear el avance en el kanban de un
// contacto que el equipo ya movió de columna. Tampoco se actualiza un campo
// cuya columna no vino en el CSV: un export parcial de GHL (p. ej. solo
// Contact Id + First Name) no debe borrar teléfono/email/apellido/canal ya
// cargados (segundo hallazgo Codex) — por eso `updateSet` solo incluye las
// columnas presentes en el archivo, según `columnsPresent`.
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

  const csvText = await file.text();
  const parsed = parseGhlContactsCsv(csvText);

  if (!parsed.ok) {
    throw new Error(
      `El CSV tiene errores de formato y no se importó nada: ${parsed.errors
        .map((error) => `fila ${error.rowNumber} (${error.code}): ${error.message}`)
        .join("; ")}`,
    );
  }

  const { rows, skipped, columnsPresent } = parsed;

  // firstName es requerido por el parser (fila sin First Name se omite
  // antes de llegar aquí), así que siempre se actualiza.
  const updateSet = {
    firstName: sql`excluded.first_name`,
    source: sql`excluded.source`,
    ...(columnsPresent.lastName ? { lastName: sql`excluded.last_name` } : {}),
    ...(columnsPresent.phone ? { phoneE164: sql`excluded.phone_e164` } : {}),
    ...(columnsPresent.email ? { email: sql`excluded.email` } : {}),
    ...(columnsPresent.tags ? { sourceChannel: sql`excluded.source_channel` } : {}),
  };

  let imported = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const [result] = await tx
        .insert(contacts)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          ghlContactId: row.ghlContactId,
          firstName: row.firstName,
          lastName: row.lastName,
          phoneE164: row.phoneE164,
          email: row.email,
          sourceChannel: row.sourceChannel,
          source: "ghl_import",
        })
        .onConflictDoUpdate({
          target: [contacts.organizationId, contacts.ghlContactId],
          targetWhere: isNotNull(contacts.ghlContactId),
          set: updateSet,
        })
        // Truco estándar de Postgres: xmax = 0 solo es cierto en la fila
        // recién insertada por este statement, nunca en la actualizada por
        // el branch ON CONFLICT.
        .returning({ wasInsert: sql<boolean>`(xmax = 0)` });

      if (result.wasInsert) {
        imported += 1;
      } else {
        updated += 1;
      }
    }
  });

  revalidatePath("/contactos");

  return {
    imported,
    updated,
    invalidPhones: rows.filter((row) => row.phoneInvalid).length,
    skipped: skipped.length,
  };
}
