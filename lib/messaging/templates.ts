// Plantillas de WhatsApp (aprobadas por Meta): sincronización desde el
// proveedor a la tabla `templates` y lectura para la UI. Toda consulta filtra
// por organización (CLAUDE.md §7). Ver docs/investigacion/plantillas-zernio.md.
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, templates } from "@/lib/db/schema";
import { isTemplateSendable, type TemplateView } from "@/lib/templates/types";
import { messagingProvider } from "./index";
import type { ProviderName } from "./provider";
import { TEMPLATE_STATUS_REMOVED, templatesToRemove } from "./template-sync";

/** No hay canal de WhatsApp activo para esta organización (nada que sincronizar/enviar). */
export class TemplatesChannelError extends Error {
  constructor(message = "No hay un canal de WhatsApp activo en esta organización.") {
    super(message);
    this.name = "TemplatesChannelError";
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

/** Lista TODAS las plantillas de la organización (aprobadas o no) para la UI. */
export async function listTemplatesForOrg(organizationId: string): Promise<TemplateView[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.organizationId, organizationId))
    .orderBy(asc(templates.name), asc(templates.language));
  return rows.map(toView);
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
 */
export async function syncTemplatesForOrg(organizationId: string): Promise<{ synced: number; removed: number }> {
  const provider = messagingProvider();
  const channel = await activeWhatsappChannel(organizationId, provider.name);
  if (!channel) throw new TemplatesChannelError();

  const remote = await provider.listTemplates(channel.providerAccountId);

  const removed = await db.transaction(async (tx) => {
    const now = new Date();
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
    return removeIds.length;
  });

  return { synced: remote.length, removed };
}
