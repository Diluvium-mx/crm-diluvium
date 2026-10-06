// Lo que ve el vendedor del seguimiento de un chat (píldora 🤖 del composer y su burbuja).
// Lecturas y cambios a mano (Cambiar hora, Que salga solo, Cancelar), siempre filtrados por
// organización. En modo ensayo nada de esto le manda algo al cliente.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, followUps, templates } from "@/lib/db/schema";
import { firstNameOf } from "@/lib/templates/first-name";
import { CASE_RULES, templateForAttempt, TIME_PHRASE_TEMPLATES, type FollowUpCase } from "./cases";
import { presentAtFor, templateFor, windowOpenAt } from "./schedule";
import { approvedTemplateNames, followUpsReal } from "./store";
import { timePhrase } from "./time-phrase";

export type FollowUpView = {
  id: string;
  conversationId: string;
  caso: FollowUpCase;
  casoLabel: string;
  objetivo: string;
  status: "programado" | "esperando";
  ensayo: boolean;
  intento: number;
  total: number;
  /** ISO. En "esperando": hasta cuándo se espera respuesta. */
  dueAt: string | null;
  /** Zona del cliente (IANA). */
  timeZone: string;
  door: "texto" | "plantilla" | null;
  templateName: string | null;
  /** Texto de la plantilla ({{1}} = primer nombre). */
  templateText: string | null;
  modo: "automatico" | "sugerido";
  presentarAt: string | null;
  autoAprobado: boolean;
  dueSetBy: "sistema" | "vendedor";
  pendiente: string | null;
  siguientePaso: string | null;
  borrador: string | null;
  firstName: string;
  phoneE164: string | null;
  intentos: { n: number; at: string; door: "texto" | "plantilla"; template: string | null; modo: "automatico" | "sugerido" | "vendedor"; ensayo: boolean; error: string | null }[];
};

const OPEN = ["programado", "esperando"] as const;

export async function loadFollowUpView(organizationId: string, conversationId: string): Promise<FollowUpView | null> {
  const [row] = await db
    .select({
      f: followUps,
      name: contacts.firstName,
      lastName: contacts.lastName,
      phone: contacts.phoneE164,
      channelId: conversations.channelId,
      lastInboundAt: conversations.lastInboundAt,
      windowExpiresAt: conversations.windowExpiresAt,
    })
    .from(followUps)
    .innerJoin(conversations, and(eq(conversations.id, followUps.conversationId), eq(conversations.organizationId, organizationId)))
    .innerJoin(contacts, and(eq(contacts.id, followUps.contactId), eq(contacts.organizationId, organizationId)))
    .where(and(eq(followUps.organizationId, organizationId), eq(followUps.conversationId, conversationId), inArray(followUps.status, [...OPEN])))
    .limit(1);
  if (!row) return null;
  const f = row.f;
  const firstName = firstNameOf(row.name);
  let templateText: string | null = null;
  if (f.templateName) {
    const [t] = await db
      .select({ body: templates.body })
      .from(templates)
      .where(and(eq(templates.organizationId, organizationId), eq(templates.channelId, row.channelId), eq(templates.name, f.templateName)))
      .limit(1);
    // {{1}} = cuándo nos escribió el cliente en las plantillas con tiempo; en las demás, su primer nombre.
    const lastClient = row.lastInboundAt ?? (row.windowExpiresAt ? new Date(row.windowExpiresAt.getTime() - 24 * 60 * 60_000) : null);
    // Solo CUÁNDO escribió; el nombre del perfil nunca va en un seguimiento (6-oct-2026).
    const value = TIME_PHRASE_TEMPLATES.has(f.templateName) && lastClient ? timePhrase(lastClient, f.dueAt ?? new Date(), f.timeZone) : "";
    templateText = t?.body ? t.body.replace(/\{\{\s*1\s*\}\}/g, value || "") : null;
  }
  const caso = f.caso as FollowUpCase;
  return {
    id: f.id,
    conversationId: f.conversationId,
    caso,
    casoLabel: CASE_RULES[caso].label,
    objetivo: CASE_RULES[caso].objetivo,
    status: f.status as FollowUpView["status"],
    // El interruptor de la organización manda (Agente IA › Opciones): al pasar a Real, lo programado ya sale.
    ensayo: !(await followUpsReal(organizationId)),
    intento: f.intento,
    total: f.totalIntentos,
    dueAt: f.dueAt?.toISOString() ?? null,
    timeZone: f.timeZone,
    door: (f.door as FollowUpView["door"]) ?? null,
    templateName: f.templateName,
    templateText,
    modo: f.modo as FollowUpView["modo"],
    presentarAt: f.presentarAt?.toISOString() ?? null,
    autoAprobado: f.autoAprobado,
    dueSetBy: f.dueSetBy as FollowUpView["dueSetBy"],
    pendiente: f.pendiente,
    siguientePaso: f.siguientePaso,
    borrador: f.borrador,
    firstName,
    phoneE164: row.phone,
    intentos: f.intentos.map(({ n, at, door, template, modo, ensayo, error }) => ({ n, at, door, template, modo, ensayo, error: error ?? null })),
  };
}

async function announce(organizationId: string, conversationId: string, contactId: string): Promise<void> {
  await db
    .execute(sql`select pg_notify('inbox_events', json_build_object(
      'org', ${organizationId}::text, 'type', 'followup.updated',
      'conversationId', ${conversationId}::text, 'contactId', ${contactId}::text
    )::text)`)
    .catch(() => undefined);
}

/** Cancelar: todo el seguimiento de ese pendiente (decisión del dueño, 2-oct-2026). */
export async function cancelFollowUpById(organizationId: string, id: string, userId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(followUps)
    .set({ status: "cancelado", cancelReason: "manual", closedAt: now, updatedAt: now, updatedByUserId: userId })
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), inArray(followUps.status, [...OPEN])))
    .returning({ conversationId: followUps.conversationId, contactId: followUps.contactId });
  if (rows[0]) await announce(organizationId, rows[0].conversationId, rows[0].contactId);
  return rows.length > 0;
}

/** Cambiar hora: la elige el vendedor (hora de Mazatlán); se recalcula por dónde saldría. */
export async function changeFollowUpTime(organizationId: string, id: string, dueAt: Date, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ f: followUps, windowExpiresAt: conversations.windowExpiresAt })
    .from(followUps)
    .innerJoin(conversations, and(eq(conversations.id, followUps.conversationId), eq(conversations.organizationId, organizationId)))
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado")))
    .limit(1);
  if (!row) return false;
  const f = row.f;
  const caso = f.caso as Exclude<FollowUpCase, "no_seguir">;
  const door = windowOpenAt(row.windowExpiresAt, dueAt) ? "texto" : "plantilla";
  const updated = await db
    .update(followUps)
    .set({
      dueAt,
      door,
      templateName:
        door === "plantilla"
          ? templateForAttempt(caso, f.intento, templateFor(CASE_RULES[caso].doors[f.intento - 1] ?? "saludo", dueAt, f.timeZone), await approvedTemplateNames(organizationId))
          : null,
      presentarAt: f.modo === "sugerido" ? presentAtFor(dueAt, now) : null,
      dueSetBy: "vendedor",
      updatedAt: now,
      updatedByUserId: userId,
    })
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado")))
    .returning({ id: followUps.id });
  if (updated.length) await announce(organizationId, f.conversationId, f.contactId);
  return updated.length > 0;
}

/** "Que salga solo": el vendedor deja salir el intento sugerido (chat con pausa a mano). */
export async function approveFollowUp(organizationId: string, id: string, userId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(followUps)
    .set({ autoAprobado: true, updatedAt: now, updatedByUserId: userId })
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado"), eq(followUps.modo, "sugerido")))
    .returning({ conversationId: followUps.conversationId, contactId: followUps.contactId });
  if (rows[0]) await announce(organizationId, rows[0].conversationId, rows[0].contactId);
  return rows.length > 0;
}
