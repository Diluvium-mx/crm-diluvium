"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { contacts, contactStageEnum } from "@/lib/db/schema/contacts";
import { normalizePhone } from "@/lib/phone";

// Nunca confiar en un organization_id que venga del cliente (CLAUDE.md §7):
// siempre se resuelve de la organización activa en la sesión del servidor.
async function requireActiveOrganizationId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    throw new Error("No autenticado.");
  }

  const organizationId = session.session.activeOrganizationId;

  if (!organizationId) {
    throw new Error("La sesión no tiene una organización activa.");
  }

  return organizationId;
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
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  phone: z.string().trim().min(1, "El teléfono es obligatorio."),
  email: z.email("Email inválido.").optional().or(z.literal("")),
  stage: z.enum(contactStageEnum.enumValues).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export async function createContact(input: CreateContactInput) {
  const organizationId = await requireActiveOrganizationId();
  const parsed = createContactSchema.parse(input);
  const phoneE164 = normalizePhone(parsed.phone);

  const [created] = await db
    .insert(contacts)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      name: parsed.name,
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
