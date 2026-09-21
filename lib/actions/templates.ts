"use server";

// Server Actions de Plantillas (aprobadas por Meta). Resuelven la organización
// activa desde la SESIÓN. Listar y sincronizar leen/escriben la tabla
// `templates`; crear llama a Zernio (queda en revisión de Meta). El ENVÍO de
// una plantilla vive en lib/inbox/actions.ts (sendTemplate), junto al composer.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import {
  activeWhatsappChannel,
  listTemplatesForOrg,
  syncTemplatesForOrg,
  TemplatesChannelError,
} from "@/lib/messaging/templates";
import { ZernioApiError } from "@/lib/messaging/zernio";
import { templateMaxIndex } from "@/lib/messaging/template-format";
import type { TemplateView } from "@/lib/templates/types";

// Gestionar plantillas afecta a la cuenta de WhatsApp y la revisión de Meta:
// solo owner/admin (ACL en lib/auth/permissions.ts). Listar/enviar es de todos.
function requireTemplateManage(role: string, action: "create" | "sync"): void {
  if (!roleAllows(role, "template", action)) {
    throw new Error("No tienes permiso para gestionar plantillas; pídeselo a un administrador.");
  }
}

export async function listTemplates(): Promise<TemplateView[]> {
  const { organizationId } = await requireActiveMembership();
  return listTemplatesForOrg(organizationId);
}

export async function syncTemplates(): Promise<{ synced: number; removed: number }> {
  const { organizationId, role } = await requireActiveMembership();
  requireTemplateManage(role, "sync");
  try {
    const result = await syncTemplatesForOrg(organizationId);
    revalidatePath("/snippets");
    return result;
  } catch (error) {
    throw friendly(error);
  }
}

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(512)
    // Meta exige nombres en minúsculas con guion bajo (sin espacios ni acentos).
    .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guion bajo (p. ej. confirmacion_pedido)."),
  language: z.string().trim().min(2, "Indica el idioma (p. ej. es_MX).").max(15),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
  bodyText: z.string().trim().min(1, "El cuerpo es obligatorio.").max(1024),
  // Un ejemplo por cada {{n}} del cuerpo (Meta lo exige para revisar).
  bodyExample: z.array(z.string().trim().min(1)).default([]),
});

export type CreateTemplateActionInput = z.infer<typeof createTemplateSchema>;

export async function createTemplate(
  input: CreateTemplateActionInput,
): Promise<{ status: string; synced: number }> {
  const { organizationId, role } = await requireActiveMembership();
  requireTemplateManage(role, "create");
  const parsed = createTemplateSchema.parse(input);

  // El ejemplo debe cubrir exactamente los {{1..N}} del cuerpo.
  const expected = templateMaxIndex(parsed.bodyText);
  if (parsed.bodyExample.length !== expected) {
    throw new Error(
      expected === 0
        ? "El cuerpo no tiene variables: no mandes ejemplos."
        : `El cuerpo tiene ${expected} variable(s): da un ejemplo para cada una.`,
    );
  }

  try {
    const channel = await activeWhatsappChannel(organizationId, messagingProvider().name);
    if (!channel) throw new TemplatesChannelError();
    const result = await messagingProvider().createTemplate({
      providerAccountId: channel.providerAccountId,
      name: parsed.name,
      language: parsed.language,
      category: parsed.category,
      bodyText: parsed.bodyText,
      bodyExample: parsed.bodyExample,
    });
    // Re-sincroniza para reflejar la nueva plantilla (queda PENDING). Best-effort:
    // el alta ya se hizo, así que un fallo al sincronizar no la reporta como error
    // (la próxima sincronización la traerá).
    let synced = 0;
    try {
      synced = (await syncTemplatesForOrg(organizationId)).synced;
    } catch {
      // se ignora: el alta fue exitosa; el listado se pondrá al día al sincronizar
    }
    revalidatePath("/snippets");
    return { status: result.status, synced };
  } catch (error) {
    throw friendly(error);
  }
}

// Traduce errores del proveedor a un mensaje que el vendedor entienda.
function friendly(error: unknown): Error {
  if (error instanceof TemplatesChannelError) return new Error(error.message);
  if (error instanceof MessagingNotConfiguredError) {
    return new Error("El canal de WhatsApp no está configurado.");
  }
  if (error instanceof ZernioApiError) {
    return new Error(`WhatsApp rechazó la operación: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
