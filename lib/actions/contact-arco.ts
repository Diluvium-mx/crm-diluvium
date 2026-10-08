"use server";

// «Datos personales» del Detalle del contacto (derechos ARCO, 7-oct-2026): cuentas para la ventana
// de borrar y el aviso de exportar, «Borrar contacto» y el reintento de archivos que quedaron.
// Todos los roles (regla del dueño: el vendedor puede todo menos Configuración; ACL
// `contact: delete/export` en lib/auth/permissions.ts). La exportación NO va aquí: es una descarga
// (ruta GET /api/contactos/[contactId]/exportar).
//
// Devuelven el resultado en vez de lanzar: en producción Next.js esconde el mensaje de un error
// lanzado desde una Server Action (lección de Plantillas, 28-sep-2026).
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { bullAgentQueuePort, cancelAgentRun, withQueueTimeout } from "@/lib/ai/runtime/queue";
import { deleteContactAndData } from "@/lib/contacts/arco/delete";
import { deleteStoredFiles } from "@/lib/contacts/arco/delete-files";
import { isOwnMessageKey } from "@/lib/contacts/arco/keys";
import { PendingFilesTokenError, signPendingFiles, verifyPendingFiles } from "@/lib/contacts/arco/pending-files-token";
import { contactArcoSummary, type ContactArcoSummary } from "@/lib/contacts/arco/summary";
import { logError } from "@/lib/log/safe-error";
import { objectStorage } from "@/lib/storage/s3";

const contactIdSchema = z.string().trim().min(1).max(128);

const deleteSchema = z.object({
  contactId: contactIdSchema,
  // Lo que escribió en la ventana: tiene que ser BORRAR (sin importar mayúsculas: el celular
  // pone la primera en mayúscula).
  confirmacion: z
    .string()
    .trim()
    .refine((v) => v.toUpperCase() === "BORRAR", "Escribe BORRAR para confirmar."),
});

export type ContactArcoSummaryResult = { ok: true; summary: ContactArcoSummary } | { ok: false; message: string };

export async function getContactArcoSummary(contactId: string): Promise<ContactArcoSummaryResult> {
  try {
    const { organizationId, role } = await requireActiveMembership();
    if (!roleAllows(role, "contact", "read")) return { ok: false, message: "No tienes permiso para ver este contacto." };
    const parsed = contactIdSchema.safeParse(contactId);
    if (!parsed.success) return { ok: false, message: "Ese contacto ya no existe." };
    const summary = await contactArcoSummary(organizationId, parsed.data);
    return summary ? { ok: true, summary } : { ok: false, message: "Ese contacto ya no existe." };
  } catch (error) {
    logError("[datos personales] no se pudieron contar los datos del contacto", error);
    return { ok: false, message: "No se pudo revisar el contacto. Inténtalo de nuevo." };
  }
}

/**
 * `pendingFiles` > 0: se borró, pero quedaron archivos en el almacenamiento; `retryToken` los vuelve
 * a intentar (null cuando no quedó nada).
 */
export type DeleteContactResult = { ok: true; pendingFiles: number; retryToken: string | null } | { ok: false; message: string };

async function cancelAgentJob(conversationId: string): Promise<void> {
  await withQueueTimeout(cancelAgentRun(bullAgentQueuePort(), conversationId), "cancelar");
}

export async function deleteContact(input: z.input<typeof deleteSchema>): Promise<DeleteContactResult> {
  try {
    const { organizationId, userId, role } = await requireActiveMembership();
    if (!roleAllows(role, "contact", "delete")) return { ok: false, message: "No tienes permiso para borrar contactos." };
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };

    const outcome = await deleteContactAndData(
      { organizationId, userId, contactId: parsed.data.contactId },
      { storage: objectStorage, cancelAgentJob },
    );
    if (outcome.status === "not_found") return { ok: false, message: "Ese contacto ya no existe (quizá alguien más lo borró)." };
    // Sin revalidatePath a propósito: en el Embudo re-renderizaría la página con la respuesta y
    // quitaría el pop-up (y con él la ventana con «quedaron N archivos · Reintentar») antes de que
    // el vendedor la lea. La Bandeja y el Embudo lo quitan con el aviso en vivo `contact.deleted` y
    // al cerrar la ventana; el Embudo es dinámico (cada carga lee la base).
    if (outcome.pendingFiles.length === 0) return { ok: true, pendingFiles: 0, retryToken: null };
    return {
      ok: true,
      pendingFiles: outcome.pendingFiles.length,
      retryToken: signPendingFiles({ organizationId, userId, keys: outcome.pendingFiles, issuedAt: Date.now() }),
    };
  } catch (error) {
    logError("[borrar contacto] falló", error);
    return { ok: false, message: "No se pudo borrar el contacto; no se borró nada. Inténtalo de nuevo." };
  }
}

export type RetryContactFilesResult = DeleteContactResult;

/** Vuelve a borrar del bucket los archivos que quedaron de un contacto ya borrado. */
export async function retryContactFilesDeletion(token: string): Promise<RetryContactFilesResult> {
  try {
    const { organizationId, userId, role } = await requireActiveMembership();
    if (!roleAllows(role, "contact", "delete")) return { ok: false, message: "No tienes permiso para borrar contactos." };
    const parsed = z.string().min(1).max(2_000_000).safeParse(token);
    if (!parsed.success) return { ok: false, message: "Ese reintento ya no es válido." };
    const pending = verifyPendingFiles(parsed.data, { organizationId, userId });
    // Defensa: solo archivos propios de mensajes de ESTA organización (nunca la Biblioteca).
    const keys = pending.keys.filter((k) => isOwnMessageKey(organizationId, k));
    if (keys.length === 0) return { ok: true, pendingFiles: 0, retryToken: null };
    const { failed } = await deleteStoredFiles(objectStorage(), keys);
    if (failed.length === 0) return { ok: true, pendingFiles: 0, retryToken: null };
    return { ok: true, pendingFiles: failed.length, retryToken: signPendingFiles({ organizationId, userId, keys: failed, issuedAt: Date.now() }) };
  } catch (error) {
    if (error instanceof PendingFilesTokenError) return { ok: false, message: error.message };
    logError("[borrar contacto] el reintento de archivos falló", error);
    return { ok: false, message: "Siguen sin poderse borrar los archivos. Inténtalo en unos minutos." };
  }
}
