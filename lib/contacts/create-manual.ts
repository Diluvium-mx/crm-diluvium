// "＋ Nuevo contacto" del Embudo (28-sep-2026): alta a mano, como la pestaña
// Contactos de GHL pero con menos datos (nombre, apellido, teléfono, correo y
// etapa; la zona horaria sale de la lada). El teléfono es obligatorio: sin él no
// se le puede escribir. No se duplica: si el número ya existe (en cualquier forma,
// +52 o +521), se avisa cuál contacto lo tiene. Mismo candado que la entrada de
// WhatsApp (ingest.ts resolveContact), para que un mensaje del mismo número que
// llegue a la vez no cree un segundo contacto.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contactsImportLockKey } from "@/lib/db/locks";
import { contacts } from "@/lib/db/schema";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { isStageKey, roleKey } from "@/lib/contacts/stages";
import { countryFromPhone, phoneColumns, phoneLookupVariants } from "@/lib/phone";
import { phoneFromForm } from "./manual-phone";

/** Origen de un contacto dado de alta a mano. El Dashboard no lo cuenta como conversación nueva. */
export const MANUAL_CONTACT_SOURCE = "manual";

export const manualContactSchema = z.object({
  firstName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  lastName: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().min(1, "El teléfono es obligatorio para poder escribirle por WhatsApp.").max(40),
  email: z.email("El correo no es válido.").optional().or(z.literal("")),
  // Clave de una etapa vigente de la organización (se valida contra funnel_stages).
  stage: z.string().trim().min(1).max(40).optional(),
});

export type ManualContactInput = z.input<typeof manualContactSchema>;

export type ManualContactResult =
  | { ok: true; contactId: string }
  | { ok: false; message: string; duplicate?: { id: string; name: string } };

export async function createManualContact(organizationId: string, input: ManualContactInput): Promise<ManualContactResult> {
  const parsed = manualContactSchema.parse(input);
  let phoneE164: string;
  try {
    phoneE164 = phoneFromForm(parsed.phone);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Teléfono no válido." };
  }
  const stages = await listFunnelStages(organizationId);
  if (parsed.stage !== undefined && !isStageKey(stages, parsed.stage)) return { ok: false, message: "Esa etapa ya no existe en el Embudo." };
  const entry = roleKey(stages, "entrada");
  if (!entry) return { ok: false, message: "El Embudo no tiene etapa de entrada; revísalo en Agente IA → Etapas del embudo." };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${contactsImportLockKey(organizationId)}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`contact:${organizationId}:phone:${phoneE164}`}, 0))`);
    const [existing] = await tx
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phoneE164, phoneLookupVariants(phoneE164))))
      .orderBy(asc(contacts.createdAt), asc(contacts.id))
      .limit(1);
    if (existing) {
      const name = [existing.firstName, existing.lastName].filter(Boolean).join(" ") || phoneE164;
      return { ok: false as const, message: `Ese teléfono ya es del contacto «${name}».`, duplicate: { id: existing.id, name } };
    }
    const id = crypto.randomUUID();
    await tx.insert(contacts).values({
      id,
      organizationId,
      firstName: parsed.firstName,
      lastName: parsed.lastName || null,
      ...phoneColumns(phoneE164),
      country: countryFromPhone(phoneE164),
      email: parsed.email || null,
      source: MANUAL_CONTACT_SOURCE,
      stage: parsed.stage ?? entry,
      // Arriba de su columna (el Embudo ordena por stage_changed_at).
      stageChangedAt: new Date(),
    });
    return { ok: true as const, contactId: id };
  });
}
