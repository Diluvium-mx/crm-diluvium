// Plantillas de WhatsApp (aprobadas por Meta): sincronización desde el
// proveedor a la tabla `templates` y lectura para la UI. Toda consulta filtra
// por organización (CLAUDE.md §7). Ver docs/investigacion/plantillas-zernio.md.
import { and, asc, count, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, scheduledMessages, templates } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import { isTemplateSendable, type TemplateView } from "@/lib/templates/types";
import { messagingProvider } from "./index";
import type { ProviderName } from "./provider";
import { isTemplateEditable, templateBodyProblem, templateVariablesFromBody } from "./template-format";
import { ZernioApiError } from "./zernio";
import {
  FOREIGN_TEMPLATE_ACCOUNT_IDS,
  isForeignTemplateAccount,
  TEMPLATE_STATUS_REMOVED,
  templateSyncLines,
  templatesToRemove,
} from "./template-sync";

/** No hay canal de WhatsApp activo para esta organización (nada que sincronizar/enviar). */
export class TemplatesChannelError extends Error {
  constructor(message = "No hay un canal de WhatsApp activo en esta organización.") {
    super(message);
    this.name = "TemplatesChannelError";
  }
}

/**
 * El canal activo es el sandbox compartido de Zernio: sus plantillas son de otros
 * clientes de Zernio. No se importan ni se crean ahí (una plantilla de Diluvium
 * creada en esa WABA quedaría a la vista de todos y no serviría con el número real).
 */
export class TemplatesSandboxError extends Error {
  constructor(
    message = "El canal conectado es el sandbox de Zernio: sus plantillas no son de Diluvium y no se usan en el CRM. Las plantillas se crean y sincronizan cuando se conecte el número de Diluvium.",
  ) {
    super(message);
    this.name = "TemplatesSandboxError";
  }
}

/** Canal de WhatsApp activo de la organización para el proveedor dado (v1: uno). */
export async function activeWhatsappChannel(
  organizationId: string,
  providerName: ProviderName,
): Promise<{ id: string; providerAccountId: string } | null> {
  const [channel] = await db
    .select({ id: channels.id, providerAccountId: channels.providerAccountId })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.type, "whatsapp"),
        eq(channels.provider, providerName),
        eq(channels.isActive, true),
      ),
    )
    .orderBy(desc(channels.createdAt))
    .limit(1);
  return channel ?? null;
}

/**
 * ¿El canal de WhatsApp activo es el sandbox de Zernio? La pestaña Plantillas lo
 * avisa y deshabilita Sincronizar/Crear (el servidor también lo rechaza). Sin
 * proveedor configurado o sin canal → false (no hay nada que avisar).
 */
export async function activeChannelIsForeign(organizationId: string): Promise<boolean> {
  try {
    const channel = await activeWhatsappChannel(organizationId, messagingProvider().name);
    return channel !== null && isForeignTemplateAccount(channel.providerAccountId);
  } catch {
    return false;
  }
}

function toView(row: typeof templates.$inferSelect): TemplateView {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    bodyText: row.body,
    variables: row.variables,
    // Enviable = aprobada por Meta Y soportada por el CRM (sin params de
    // encabezado/botón que no sabemos construir).
    sendable: isTemplateSendable(row.status) && !row.unsupported,
    unsupported: row.unsupported,
  };
}

/**
 * Lista las plantillas de la organización (aprobadas o no) para la UI, SIN las de
 * cuentas ajenas (el sandbox de Zernio): esas quedan guardadas pero ocultas.
 */
export async function listTemplatesForOrg(organizationId: string): Promise<TemplateView[]> {
  const rows = await db
    .select({ template: templates })
    .from(templates)
    .innerJoin(channels, eq(channels.id, templates.channelId))
    .where(
      and(
        eq(templates.organizationId, organizationId),
        eq(channels.organizationId, organizationId),
        notInArray(channels.providerAccountId, [...FOREIGN_TEMPLATE_ACCOUNT_IDS]),
      ),
    )
    .orderBy(asc(templates.name), asc(templates.language));
  return rows.map((r) => toView(r.template));
}

/**
 * Sincroniza las plantillas de la WABA (vía el proveedor) a la tabla `templates`.
 * En UNA transacción, tras una lectura COMPLETA y validada (listTemplates recorre
 * la paginación y lanza ante error, nunca devuelve una página parcial):
 *  - upsert por (channel, name, language) de todo lo que devolvió el proveedor;
 *  - las plantillas locales del canal AUSENTES del set remoto pasan a REMOVED,
 *    para que dejen de ser enviables (Meta pudo eliminarlas: desaparecen del
 *    listado sin un estado terminal, y sin esto quedarían "APPROVED" para siempre
 *    y todo envío se rechazaría). Un buen sync posterior las vuelve a aprobar.
 * Con el canal del sandbox de Zernio NO se importa nada (TemplatesSandboxError),
 * ni se toca lo ya guardado: sus plantillas no son de Diluvium.
 */
export async function syncTemplatesForOrg(
  organizationId: string,
  // Bloque E: «Sincronizar» de una persona queda en el Historial en la misma transacción,
  // con qué plantillas llegaron, cambiaron de estado o de texto, o se quitaron.
  log?: { userId: string | null },
): Promise<{ synced: number; removed: number }> {
  const provider = messagingProvider();
  const channel = await activeWhatsappChannel(organizationId, provider.name);
  if (!channel) throw new TemplatesChannelError();
  if (isForeignTemplateAccount(channel.providerAccountId)) throw new TemplatesSandboxError();

  const remote = await provider.listTemplates(channel.providerAccountId);

  const removed = await db.transaction(async (tx) => {
    const now = new Date();
    const previous = log
      ? await tx
          .select({ name: templates.name, language: templates.language, status: templates.status, body: templates.body })
          .from(templates)
          .where(and(eq(templates.channelId, channel.id), eq(templates.organizationId, organizationId)))
      : [];
    for (const t of remote) {
      await tx
        .insert(templates)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          channelId: channel.id,
          name: t.name,
          language: t.language,
          category: t.category,
          body: t.bodyText,
          status: t.status,
          variables: t.variables,
          unsupported: t.requiresUnsupportedParams,
          providerTemplateId: t.providerTemplateId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [templates.channelId, templates.name, templates.language],
          set: {
            category: t.category,
            body: t.bodyText,
            status: t.status,
            variables: t.variables,
            unsupported: t.requiresUnsupportedParams,
            providerTemplateId: t.providerTemplateId,
            updatedAt: now,
          },
        });
    }

    const existing = await tx
      .select({ id: templates.id, name: templates.name, language: templates.language, status: templates.status })
      .from(templates)
      .where(eq(templates.channelId, channel.id));
    const removeIds = templatesToRemove(existing, remote);
    for (const id of removeIds) {
      await tx.update(templates).set({ status: TEMPLATE_STATUS_REMOVED, updatedAt: now }).where(eq(templates.id, id));
    }
    if (log) {
      const lines = templateSyncLines(
        previous,
        remote.map((t) => ({ name: t.name, language: t.language, status: t.status, body: t.bodyText })),
        existing.filter((e) => removeIds.includes(e.id)),
      );
      await logChanges(tx, {
        organizationId,
        userId: log.userId,
        kind: "plantillas",
        action: "sincronizar",
        newValue: `${remote.length} en Meta · ${lines.length === 0 ? "sin cambios" : `${lines.length} ${lines.length === 1 ? "cambio" : "cambios"}`}`,
        detail: lines.length ? { type: "lineas", lines } : null,
      });
    }
    return removeIds.length;
  });

  return { synced: remote.length, removed };
}

// ─── Editar y borrar (28-sep-2026) ──────────────────────────────────────────

/** Algo del pedido impide editar/borrar (mensaje listo para el vendedor). */
export class TemplateActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateActionError";
  }
}

/** Plantilla de la organización con el canal al que pertenece (debe ser de Diluvium). */
async function loadOwnTemplate(organizationId: string, templateId: string) {
  const [row] = await db
    .select({ template: templates, providerAccountId: channels.providerAccountId })
    .from(templates)
    .innerJoin(channels, eq(channels.id, templates.channelId))
    .where(and(eq(templates.id, templateId), eq(templates.organizationId, organizationId), eq(channels.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new TemplateActionError("Esa plantilla ya no existe; pulsa Sincronizar.");
  if (isForeignTemplateAccount(row.providerAccountId)) throw new TemplatesSandboxError();
  return row;
}

/**
 * Cambia el TEXTO de una plantilla en Meta (nombre, idioma y categoría quedan
 * fijos) y lo refleja en la tabla: vuelve a revisión (normalmente PENDING), así
 * que mientras Meta la revisa no se puede mandar. Meta solo deja editar
 * aprobadas, rechazadas o pausadas; una aprobada, 1 vez cada 24 h y 10 cada 30 días
 * (si se pasa, el rechazo de Meta llega tal cual).
 */
export async function updateTemplateForOrg(
  organizationId: string,
  templateId: string,
  input: { bodyText: string; bodyExample: string[] },
  log: { userId: string | null },
): Promise<{ status: string }> {
  const { template, providerAccountId } = await loadOwnTemplate(organizationId, templateId);
  if (!isTemplateEditable(template.status)) {
    throw new TemplateActionError("Meta solo deja editar plantillas aprobadas, rechazadas o pausadas. Espera a que termine la revisión.");
  }
  const bodyText = input.bodyText.trim();
  const bodyExample = input.bodyExample.map((e) => e.trim());
  const problem = templateBodyProblem(bodyText, bodyExample);
  if (problem) throw new TemplateActionError(problem);
  if (bodyText === (template.body ?? "").trim()) throw new TemplateActionError("El texto es el mismo: no hay nada que mandar a Meta.");

  const provider = messagingProvider();
  if (!provider.updateTemplate) throw new TemplateActionError("Editar plantillas no está disponible con este proveedor.");
  const { status } = await provider.updateTemplate({
    providerAccountId,
    name: template.name,
    language: template.language,
    bodyText,
    bodyExample,
  });

  // Meta ya aceptó el cambio: la tabla se pone al día en la misma transacción que su Historial.
  await db.transaction(async (tx) => {
    await tx
      .update(templates)
      .set({ body: bodyText, variables: templateVariablesFromBody(bodyText, bodyExample), status, updatedAt: new Date() })
      .where(eq(templates.id, template.id));
    await logChanges(tx, {
      organizationId,
      userId: log.userId,
      kind: "plantillas",
      action: "editar",
      subject: template.name,
      subjectId: template.id,
      newValue: `Vuelve a revisión de Meta · ${template.language}`,
      detail: { type: "texto", title: "Texto", before: template.body, after: bodyText },
    });
  });
  return { status };
}

/**
 * Borra UNA plantilla (nombre + idioma) en Meta y la quita del CRM. No se borra
 * si hay mensajes programados que la usan (saldrían fallidos): primero se
 * cancelan. Si Meta ya no la tenía (404), igual se quita de aquí. El nombre no se
 * puede volver a usar en Meta durante 30 días.
 */
export async function deleteTemplateForOrg(
  organizationId: string,
  templateId: string,
  log: { userId: string | null },
): Promise<void> {
  const { template, providerAccountId } = await loadOwnTemplate(organizationId, templateId);
  const [pending] = await db
    .select({ n: count() })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.organizationId, organizationId),
        eq(scheduledMessages.templateId, template.id),
        inArray(scheduledMessages.status, ["scheduled", "sending"]),
      ),
    );
  if (pending && pending.n > 0) {
    throw new TemplateActionError(
      pending.n === 1
        ? "Hay 1 mensaje programado con esta plantilla: cancélalo en su chat antes de borrarla."
        : `Hay ${pending.n} mensajes programados con esta plantilla: cancélalos en sus chats antes de borrarla.`,
    );
  }

  const provider = messagingProvider();
  if (!provider.deleteTemplate) throw new TemplateActionError("Borrar plantillas no está disponible con este proveedor.");
  try {
    await provider.deleteTemplate({ providerAccountId, name: template.name, language: template.language });
  } catch (error) {
    // Meta ya no la tiene (la borraron en WhatsApp Manager, p. ej.): se quita de aquí igual.
    if (!(error instanceof ZernioApiError && error.httpStatus === 404)) throw error;
  }

  await db.transaction(async (tx) => {
    await tx.delete(templates).where(and(eq(templates.id, template.id), eq(templates.organizationId, organizationId)));
    await logChanges(tx, {
      organizationId,
      userId: log.userId,
      kind: "plantillas",
      action: "borrar",
      subject: template.name,
      subjectId: template.id,
      oldValue: `${template.category ?? "—"} · ${template.language}`,
      detail: template.body ? { type: "texto", title: "Texto", before: template.body, after: null } : null,
    });
  });
}
