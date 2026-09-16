"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member } from "@/lib/db/schema/auth";
import { contacts, contactStageEnum } from "@/lib/db/schema/contacts";
import { normalizePhone } from "@/lib/phone";
import { parseGhlContactsCsv } from "@/lib/import/ghl-contacts-csv";

// Nunca confiar en un organization_id que venga del cliente (CLAUDE.md §7),
// ni tampoco en session.activeOrganizationId a secas: better-auth no lo
// rellena solo al crear la sesión (auth.api.setActiveOrganization es un
// endpoint aparte que nadie llama todavía tras el sign-in — confirmado en
// node_modules/better-auth/dist/plugins/organization/organization.mjs, sin
// databaseHooks de session.create que lo pueble por default) y removeMember
// no invalida las sesiones del miembro expulsado (organization/adapter.mjs),
// así que confiar en el campo de sesión dejaría con acceso a un miembro ya
// removido. Por eso cada llamada resuelve la organización contra la
// membresía vigente en `member`, no contra el campo cacheado en la sesión.
async function requireActiveOrganizationId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    throw new Error("No autenticado.");
  }

  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, session.user.id));

  if (memberships.length === 0) {
    throw new Error("El usuario no tiene membresía activa en ninguna organización.");
  }

  const sessionOrganizationId = session.session.activeOrganizationId;

  if (
    sessionOrganizationId &&
    memberships.some((m) => m.organizationId === sessionOrganizationId)
  ) {
    return sessionOrganizationId;
  }

  // Sesión sin organización activa (recién creada por email-signin, que no
  // la fija) o apuntando a una de la que el usuario ya no es miembro: con
  // el modelo de una sola organización (Diluvium) basta con resolverla por
  // membresía. Con más de una, no hay forma segura de adivinar cuál.
  if (memberships.length === 1) {
    return memberships[0].organizationId;
  }

  throw new Error(
    "El usuario pertenece a varias organizaciones y la sesión no tiene una organización activa válida.",
  );
}

// Todos los agentes ven todos los contactos de su organización (CLAUDE.md §5):
// sin filtro por dueño/asignado.
export async function listContacts() {
  const organizationId = await requireActiveOrganizationId();

  return db
    .select()
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .orderBy(asc(contacts.createdAt));
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
    .set({ stage: parsed.stage })
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

// Upsert por (organization_id, ghl_contact_id): re-importar el mismo CSV no
// duplica (índice único parcial contacts_org_ghl_contact_id_uidx,
// lib/db/schema/contacts.ts). `stage` nunca se toca en el branch de
// actualización — re-sincronizar desde GHL no debe resetear el avance en el
// kanban de un contacto que el equipo ya movió de columna.
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
  const { rows, skipped } = parseGhlContactsCsv(csvText);

  let imported = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const [existing] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, organizationId),
            eq(contacts.ghlContactId, row.ghlContactId),
          ),
        );

      const mappedFields = {
        firstName: row.firstName,
        lastName: row.lastName,
        phoneE164: row.phoneE164,
        email: row.email,
        sourceChannel: row.sourceChannel,
        source: "ghl_import",
      };

      if (existing) {
        await tx.update(contacts).set(mappedFields).where(eq(contacts.id, existing.id));
        updated += 1;
      } else {
        await tx.insert(contacts).values({
          id: crypto.randomUUID(),
          organizationId,
          ghlContactId: row.ghlContactId,
          ...mappedFields,
        });
        imported += 1;
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
