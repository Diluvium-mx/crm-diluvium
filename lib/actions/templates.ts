"use server";

// Server Actions de Plantillas (aprobadas por Meta). Resuelven la organización
// activa desde la SESIÓN. Listar y sincronizar leen/escriben la tabla
// `templates`; crear, editar y borrar llaman a Zernio (crear y editar quedan en
// revisión de Meta). El ENVÍO de una plantilla vive en lib/inbox/actions.ts
// (sendTemplate), junto al composer.
//
// Las que cambian algo DEVUELVEN { ok: false, message } en vez de lanzar
// (28-sep-2026): en producción Next.js esconde el mensaje de un error lanzado
// desde una Server Action, y el vendedor veía un aviso genérico en inglés en vez
// de "Solo minúsculas…" o el rechazo de Meta.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import {
  activeWhatsappChannel,
  deleteTemplateForOrg,
  listTemplatesForOrg,
  syncTemplatesForOrg,
  TemplateActionError,
  templateReviewForOrg,
  TemplatesChannelError,
  TemplatesSandboxError,
  updateTemplateForOrg,
} from "@/lib/messaging/templates";
import { ZernioApiError } from "@/lib/messaging/zernio";
import { TEMPLATE_NAME_MAX, TEMPLATE_NAME_RE, templateBodyProblem } from "@/lib/messaging/template-format";
import { isForeignTemplateAccount } from "@/lib/messaging/template-sync";
import { submitNotice, type MetaNotice } from "@/lib/templates/meta-reasons";
import type { TemplateView } from "@/lib/templates/types";
import { db } from "@/lib/db";
import { logChanges } from "@/lib/historial/log";
import { templateStatusLabel } from "@/lib/historial/labels";

// `notice`: el rechazo vino de WhatsApp (Meta): la pantalla lo muestra como aviso grande (pop-up).
export type TemplateActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; notice?: MetaNotice };

// Gestionar plantillas (darlas de alta en Meta, editarlas, borrarlas, sincronizarlas):
// todos los roles (ACL en lib/auth/permissions.ts; un rol desconocido, no).
function requireTemplateManage(role: string, action: "create" | "update" | "delete" | "sync"): void {
  if (!roleAllows(role, "template", action)) {
    throw new TemplateActionError("No tienes permiso para gestionar plantillas; pídeselo a un administrador.");
  }
}

export async function listTemplates(): Promise<TemplateView[]> {
  const { organizationId } = await requireActiveMembership();
  return listTemplatesForOrg(organizationId);
}

export async function syncTemplates(): Promise<TemplateActionResult<{ synced: number; removed: number }>> {
  try {
    const { organizationId, role, userId } = await requireActiveMembership();
    requireTemplateManage(role, "sync");
    const result = await syncTemplatesForOrg(organizationId, { userId });
    revalidatePath("/mensajes-rapidos");
    return { ok: true, ...result };
  } catch (error) {
    return fail(error, "No se pudo sincronizar.", "sincronizar");
  }
}

const bodyExampleSchema = z.array(z.string().max(1024)).max(50).default([]);

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(TEMPLATE_NAME_MAX)
    // Meta exige nombres en minúsculas con guion bajo (sin espacios ni acentos).
    // El formulario ya lo convierte solo (templateNameFromLabel).
    .regex(TEMPLATE_NAME_RE, "El nombre va en minúsculas, sin acentos ni espacios (p. ej. hola_buenas_tardes)."),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Idioma no válido (p. ej. es_MX)."),
  // AUTENTICACIÓN (códigos) tiene una forma propia que este formulario no arma: no se ofrece.
  category: z.enum(["UTILITY", "MARKETING"]),
  bodyText: z.string().trim().min(1, "Escribe el texto de la plantilla."),
  // Un ejemplo por cada {{n}} del cuerpo (Meta lo exige para revisar).
  bodyExample: bodyExampleSchema,
});

export type CreateTemplateActionInput = z.input<typeof createTemplateSchema>;

export async function createTemplate(
  input: CreateTemplateActionInput,
): Promise<TemplateActionResult<{ status: string; synced: number }>> {
  try {
    const { organizationId, role, userId } = await requireActiveMembership();
    requireTemplateManage(role, "create");
    const parsed = createTemplateSchema.parse(input);
    const bodyExample = parsed.bodyExample.map((e) => e.trim());
    const problem = templateBodyProblem(parsed.bodyText, bodyExample);
    if (problem) return { ok: false, message: problem };

    const channel = await activeWhatsappChannel(organizationId, messagingProvider().name);
    if (!channel) throw new TemplatesChannelError();
    // En el sandbox compartido de Zernio NO se da de alta nada: sería una plantilla
    // de Diluvium en una WABA ajena (a la vista de otros, inútil con el número real).
    if (isForeignTemplateAccount(channel.providerAccountId)) throw new TemplatesSandboxError();
    const result = await messagingProvider().createTemplate({
      providerAccountId: channel.providerAccountId,
      name: parsed.name,
      language: parsed.language,
      category: parsed.category,
      bodyText: parsed.bodyText,
      bodyExample,
    });
    // Historial (Bloque E): el alta vive en Meta (no hay transacción nuestra que compartir),
    // así que su fila se escribe en cuanto Meta la acepta. Si esa fila fallara, el alta ya
    // se hizo: se avisa en el log y no se reporta como error.
    await logChanges(db, {
      organizationId,
      userId,
      kind: "plantillas",
      action: "alta",
      subject: parsed.name,
      newValue: `${parsed.category} · ${parsed.language} · ${templateStatusLabel(result.status)}`,
      detail: { type: "texto", title: "Cuerpo", before: null, after: parsed.bodyText },
    }).catch((error) => console.error(`[plantillas] no se pudo registrar el alta de ${parsed.name} en el historial`, error));
    // Re-sincroniza para reflejar la nueva plantilla (queda PENDING). Best-effort:
    // el alta ya se hizo, así que un fallo al sincronizar no la reporta como error
    // (la próxima sincronización la traerá).
    let synced = 0;
    try {
      synced = (await syncTemplatesForOrg(organizationId)).synced;
    } catch {
      // se ignora: el alta fue exitosa; el listado se pondrá al día al sincronizar
    }
    revalidatePath("/mensajes-rapidos");
    return { ok: true, status: result.status, synced };
  } catch (error) {
    return fail(error, "No se pudo crear la plantilla.", "crear");
  }
}

const updateTemplateSchema = z.object({
  id: z.string().trim().min(1),
  bodyText: z.string().trim().min(1, "Escribe el texto de la plantilla."),
  bodyExample: bodyExampleSchema,
});

export async function updateTemplate(
  input: z.input<typeof updateTemplateSchema>,
): Promise<TemplateActionResult<{ status: string }>> {
  try {
    const { organizationId, role, userId } = await requireActiveMembership();
    requireTemplateManage(role, "update");
    const parsed = updateTemplateSchema.parse(input);
    const result = await updateTemplateForOrg(organizationId, parsed.id, parsed, { userId });
    revalidatePath("/mensajes-rapidos");
    return { ok: true, status: result.status };
  } catch (error) {
    return fail(error, "No se pudo editar la plantilla.", "editar");
  }
}

export async function deleteTemplate(input: { id: string }): Promise<TemplateActionResult> {
  try {
    const { organizationId, role, userId } = await requireActiveMembership();
    requireTemplateManage(role, "delete");
    const id = z.string().trim().min(1).parse(input.id);
    await deleteTemplateForOrg(organizationId, id, { userId });
    revalidatePath("/mensajes-rapidos");
    return { ok: true };
  } catch (error) {
    return fail(error, "No se pudo borrar la plantilla.", "borrar");
  }
}

/**
 * Estado y motivo de rechazo en vivo (para el aviso grande de una plantilla
 * rechazada, pausada o desactivada). Solo lectura; si Meta cambió el estado, la
 * fila se pone al día.
 */
export async function reviewTemplate(input: {
  id: string;
}): Promise<TemplateActionResult<{ name: string; status: string; rejectedReason: string | null }>> {
  try {
    const { organizationId } = await requireActiveMembership();
    const id = z.string().trim().min(1).parse(input.id);
    const review = await templateReviewForOrg(organizationId, id);
    return { ok: true, ...review };
  } catch (error) {
    return fail(error, "No se pudo consultar a Meta.", "sincronizar");
  }
}

type NoticeAction = Parameters<typeof submitNotice>[0];

// Falla con mensaje para el vendedor; si la rechazó WhatsApp (Meta), además el aviso grande.
function fail(error: unknown, fallback: string, action: NoticeAction): { ok: false; message: string; notice?: MetaNotice } {
  const message = friendly(error, fallback);
  if (error instanceof ZernioApiError && error.httpStatus >= 400 && error.httpStatus < 500) {
    return { ok: false, message, notice: submitNotice(action, error.message) };
  }
  return { ok: false, message };
}

// Traduce errores a un mensaje que el vendedor entienda. Lo inesperado se deja en
// el log del servidor (con su detalle) y en pantalla sale el aviso genérico.
function friendly(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? fallback;
  if (error instanceof TemplateActionError || error instanceof TemplatesChannelError || error instanceof TemplatesSandboxError) {
    return error.message;
  }
  if (error instanceof MessagingNotConfiguredError) return "El canal de WhatsApp no está configurado.";
  // httpStatus 0 = sin respuesta o respuesta ilegible (no es un rechazo de Meta).
  if (error instanceof ZernioApiError) {
    return error.httpStatus === 0
      ? `No se pudo completar con WhatsApp (Zernio): ${error.message}. Inténtalo de nuevo.`
      : `WhatsApp (Meta) lo rechazó: ${error.message}`;
  }
  if (error instanceof Error && error.message === "No autenticado.") return "Tu sesión se cerró; vuelve a entrar.";
  console.error(`[plantillas] ${fallback}`, error);
  return `${fallback} Inténtalo de nuevo.`;
}
