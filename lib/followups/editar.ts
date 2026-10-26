// «Editar mensaje» en la ventana del seguimiento (decisión del dueño, 12-oct-2026; docs/seguimientos.md §23).
// Un vendedor cambia lo que sale en el SIGUIENTE intento: con la ventana abierta, el texto completo (sale tal cual,
// sin saludo del CRM); con la ventana cerrada, la plantilla (de las aprobadas que el seguimiento sabe llenar). Solo
// vale para ese intento: se borra cuando sale o cuando el lector vuelve a leer el chat (lib/followups/store.ts).
// Siempre filtrado por organización; nada de esto le manda algo al cliente.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, followUps, templates } from "@/lib/db/schema";
import { templateSection, templateTitle, type TemplateSectionKey } from "@/lib/templates/labels";
import { fillFollowUpTemplate, followUpCanFill } from "./plantilla-llena";
import { announce, lastClientOf } from "./view";

/** Tope de WhatsApp para un mensaje de texto. */
export const MAX_FOLLOW_UP_TEXT = 4096;

export type FollowUpTemplateOption = {
  name: string;
  title: string;
  section: TemplateSectionKey;
  /** Ya llena, como le llegaría al cliente a la hora programada. */
  text: string;
  /** La que eligió el Agente IA para este intento. */
  delAgente: boolean;
};

export type EditResult = { ok: true } | { ok: false; message: string };

// Primero las de seguimiento (las que más encajan), luego el saludo del vendedor (las `daniel_*`, hoy con Carlos) y las demás.
const SECTION_ORDER: Record<TemplateSectionKey, number> = { seguimiento: 0, daniel: 1, otras: 2 };

const GONE: EditResult = { ok: false, message: "Ese seguimiento ya no está programado." };

async function programado(organizationId: string, id: string) {
  const [row] = await db
    .select({ f: followUps, channelId: conversations.channelId, lastInboundAt: conversations.lastInboundAt, windowExpiresAt: conversations.windowExpiresAt })
    .from(followUps)
    .innerJoin(conversations, and(eq(conversations.id, followUps.conversationId), eq(conversations.organizationId, organizationId)))
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado")))
    .limit(1);
  return row ?? null;
}

type Programado = NonNullable<Awaited<ReturnType<typeof programado>>>;

async function optionsFor(organizationId: string, row: Programado): Promise<FollowUpTemplateOption[]> {
  const rows = await db
    .select({ name: templates.name, body: templates.body, language: templates.language })
    .from(templates)
    .where(and(eq(templates.organizationId, organizationId), eq(templates.channelId, row.channelId), eq(templates.status, "APPROVED"), eq(templates.unsupported, false)));
  // Una por nombre (es_MX primero, como el envío).
  const byName = new Map<string, { body: string; language: string }>();
  for (const r of rows) {
    if (!r.body || !followUpCanFill(r.name, r.body)) continue;
    const seen = byName.get(r.name);
    if (!seen || (seen.language !== "es_MX" && r.language === "es_MX")) byName.set(r.name, { body: r.body, language: r.language });
  }
  const lastClient = lastClientOf(row);
  const sendAt = row.f.dueAt ?? new Date();
  return [...byName.entries()]
    .map(([name, t]) => ({
      name,
      title: templateTitle(name),
      section: templateSection(name),
      text: fillFollowUpTemplate(name, t.body, lastClient, sendAt, row.f.timeZone),
      delAgente: name === row.f.templateName,
    }))
    .sort((a, b) => Number(b.delAgente) - Number(a.delAgente) || SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.name.localeCompare(b.name));
}

/** Las plantillas que se pueden elegir para el intento programado (la del Agente IA primero). */
export async function followUpTemplateOptions(organizationId: string, id: string): Promise<FollowUpTemplateOption[] | null> {
  const row = await programado(organizationId, id);
  return row ? optionsFor(organizationId, row) : null;
}

async function saveEdit(organizationId: string, row: Programado, set: { mensajeVendedor?: string | null; plantillaVendedor?: string | null }, userId: string, now: Date): Promise<EditResult> {
  const done = await db
    .update(followUps)
    .set({ ...set, updatedAt: now, updatedByUserId: userId })
    .where(and(eq(followUps.id, row.f.id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado"), eq(followUps.intento, row.f.intento)))
    .returning({ id: followUps.id });
  if (!done.length) return GONE;
  await announce(organizationId, row.f.conversationId, row.f.contactId);
  return { ok: true };
}

/** Texto exacto del siguiente intento; `null` = vuelve el del Agente IA. */
export async function editFollowUpText(organizationId: string, id: string, texto: string | null, userId: string, now: Date): Promise<EditResult> {
  const value = texto?.trim() ?? null;
  if (value !== null && !value) return { ok: false, message: "Escribe el mensaje." };
  if (value !== null && value.length > MAX_FOLLOW_UP_TEXT) return { ok: false, message: `El mensaje es muy largo (máximo ${MAX_FOLLOW_UP_TEXT.toLocaleString("es-MX")} letras).` };
  const row = await programado(organizationId, id);
  if (!row) return GONE;
  return saveEdit(organizationId, row, { mensajeVendedor: value }, userId, now);
}

/** Plantilla del siguiente intento; `null` = vuelve la del Agente IA. */
export async function chooseFollowUpTemplate(organizationId: string, id: string, name: string | null, userId: string, now: Date): Promise<EditResult> {
  const row = await programado(organizationId, id);
  if (!row) return GONE;
  if (name !== null && !(await optionsFor(organizationId, row)).some((o) => o.name === name)) {
    return { ok: false, message: "Esa plantilla no está aprobada en este canal o pide un dato que el seguimiento no pone." };
  }
  return saveEdit(organizationId, row, { plantillaVendedor: name }, userId, now);
}
