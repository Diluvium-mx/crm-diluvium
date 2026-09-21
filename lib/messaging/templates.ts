// Plantillas de WhatsApp (aprobadas por Meta): sincronización desde el
// proveedor a la tabla `templates` y lectura para la UI. Toda consulta filtra
// por organización (CLAUDE.md §7). Ver docs/investigacion/plantillas-zernio.md.
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, templates } from "@/lib/db/schema";
import { isTemplateSendable, type TemplateView } from "@/lib/templates/types";
import { messagingProvider } from "./index";
import type { ProviderName } from "./provider";

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
    sendable: isTemplateSendable(row.status),
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
 * Sincroniza las plantillas de la WABA (vía el proveedor) a la tabla `templates`:
 * upsert por (channel, name, language). No borra: una plantilla que Meta
 * eliminó puede volver; su `status` (DELETED/DISABLED) la saca de las enviables.
 */
export async function syncTemplatesForOrg(organizationId: string): Promise<{ synced: number }> {
  const provider = messagingProvider();
  const channel = await activeWhatsappChannel(organizationId, provider.name);
  if (!channel) throw new TemplatesChannelError();

  const remote = await provider.listTemplates(channel.providerAccountId);
  for (const t of remote) {
    await db
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
        providerTemplateId: t.providerTemplateId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [templates.channelId, templates.name, templates.language],
        set: {
          category: t.category,
          body: t.bodyText,
          status: t.status,
          variables: t.variables,
          providerTemplateId: t.providerTemplateId,
          updatedAt: new Date(),
        },
      });
  }
  return { synced: remote.length };
}
