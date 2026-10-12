// «Editar contacto» (✎ del Detalle, 12-oct-2026): nombre, apellido y correo. El teléfono NO
// se edita (decisión del dueño): solo se captura al crear el contacto a mano, y el de WhatsApp lo da
// el cliente al escribir. Además, los mensajes salen al chat de Zernio y no a contacts.phone_e164:
// cambiarlo dejaría en pantalla un número distinto del que recibe los mensajes.
// El aviso en vivo (`datos`) sale en la MISMA transacción: el Embudo, la Bandeja y el Detalle
// abiertos ponen el nombre al día al confirmar.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { notifyContactUpdated, type ContactActor } from "./notify-updated";

export const contactBasicsSchema = z.object({
  firstName: z.string().trim().min(1, "El nombre es obligatorio.").max(120, "El nombre es muy largo."),
  lastName: z.string().trim().max(120, "El apellido es muy largo.").optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .max(200, "El correo es muy largo.")
    .refine((value) => value === "" || z.email().safeParse(value).success, "El correo no es válido.")
    .optional(),
});

export type ContactBasicsInput = z.input<typeof contactBasicsSchema>;

export type ContactBasics = { firstName: string; lastName: string | null; email: string | null };

export type ContactBasicsResult = ({ ok: true } & ContactBasics) | { ok: false; message: string };

export async function updateContactBasics(
  organizationId: string,
  contactId: string,
  input: ContactBasicsInput,
  by: ContactActor,
): Promise<ContactBasicsResult> {
  const parsed = contactBasicsSchema.parse(input);
  const next: ContactBasics = { firstName: parsed.firstName, lastName: parsed.lastName || null, email: parsed.email || null };
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .limit(1)
      .for("update");
    if (!before) return { ok: false as const, message: "Este contacto ya no existe." };
    // Sin cambios: ni escritura ni aviso.
    if (before.firstName === next.firstName && before.lastName === next.lastName && before.email === next.email) {
      return { ok: true as const, ...next };
    }
    await tx
      .update(contacts)
      .set(next)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
    await notifyContactUpdated(tx, { organizationId, contactId, changes: ["datos"], by });
    return { ok: true as const, ...next };
  });
}
