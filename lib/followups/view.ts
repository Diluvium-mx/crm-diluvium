// Lo que ve el vendedor del seguimiento de un chat (píldora 🤖 del composer y su burbuja).
// Lecturas y cambios a mano (Cambiar hora, Que salga solo, Cancelar), siempre filtrados por
// organización. En modo ensayo nada de esto le manda algo al cliente.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, followUps, templates, user } from "@/lib/db/schema";
import { firstNameOf } from "@/lib/templates/first-name";
import { CASE_RULES, templateForAttempt, TIME_PHRASE_TEMPLATES, type FollowUpCase } from "./cases";
import { presentAtFor, sendTimeProblem, templateFor, windowOpenAt, VENDOR_ZONE, type SendTimeProblem } from "./schedule";
import { approvedTemplateNames, followUpsReal, lastTemplateAt, reopenCancelledFollowUp } from "./store";
import { loadFollowUpTable } from "./tabla-store";
import { localParts, zonedInstant } from "./time";
import { timePhrase } from "./time-phrase";

export type FollowUpView = {
  estado: "activo";
  id: string;
  conversationId: string;
  caso: FollowUpCase;
  casoLabel: string;
  /** Qué busca el caso (Agente IA › Seguimientos); la píldora muestra antes el siguiente paso de este chat. */
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
  const table = await loadFollowUpTable(organizationId);
  return {
    estado: "activo",
    id: f.id,
    conversationId: f.conversationId,
    caso,
    casoLabel: CASE_RULES[caso].label,
    objetivo: caso === "no_seguir" ? CASE_RULES[caso].objetivo : table.casos[caso].busca,
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

/**
 * Cancelar: todo el seguimiento de ese pendiente (decisión del dueño, 2-oct-2026) y, desde el 6-oct-2026,
 * los seguimientos de ESE CHAT quedan apagados hasta que un vendedor o admin los reactive (ni el Agente IA
 * ni el lector los vuelven a armar: puede ser un chat de prueba, de un proveedor o de alguien que ya compró).
 */
export async function cancelFollowUpById(organizationId: string, id: string, userId: string, now: Date): Promise<boolean> {
  const rows = await db.transaction(async (tx) => {
    const done = await tx
      .update(followUps)
      .set({ status: "cancelado", cancelReason: "manual", closedAt: now, updatedAt: now, updatedByUserId: userId })
      .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), inArray(followUps.status, [...OPEN])))
      .returning({ conversationId: followUps.conversationId, contactId: followUps.contactId });
    if (done[0]) {
      await tx
        .update(conversations)
        .set({ seguimientosOffAt: now, seguimientosOffByUserId: userId })
        .where(and(eq(conversations.id, done[0].conversationId), eq(conversations.organizationId, organizationId)));
    }
    return done;
  });
  if (rows[0]) await announce(organizationId, rows[0].conversationId, rows[0].contactId);
  return rows.length > 0;
}

/** El chat con los seguimientos cancelados, o el contacto que se dio de baja de las promociones (131050). */
type FollowUpOffBase = {
  conversationId: string;
  contactId: string;
  /** Cuándo se cancelaron (solo «cancelado»). */
  at: string | null;
  /** Quién (solo «cancelado»). */
  byName: string | null;
};
export type FollowUpOff = (FollowUpOffBase & { estado: "cancelado" }) | (FollowUpOffBase & { estado: "baja" });
export type FollowUpState = FollowUpView | FollowUpOff;

/** Lo que muestra la píldora 🤖: el seguimiento abierto, o el chat cancelado / dado de baja; null = nada. */
export async function loadFollowUpState(organizationId: string, conversationId: string): Promise<FollowUpState | null> {
  const open = await loadFollowUpView(organizationId, conversationId);
  if (open) return open;
  const [row] = await db
    .select({ contactId: conversations.contactId, offAt: conversations.seguimientosOffAt, byName: user.name, baja: contacts.sinSeguimientos })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.organizationId, organizationId)))
    .leftJoin(user, eq(user.id, conversations.seguimientosOffByUserId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  if (row.baja) return { estado: "baja", conversationId, contactId: row.contactId, at: null, byName: null };
  if (row.offAt) return { estado: "cancelado", conversationId, contactId: row.contactId, at: row.offAt.toISOString(), byName: row.byName ?? null };
  return null;
}

/** «Reactivar seguimientos» en este chat: lo apaga la marca y reabre el último cancelado si el chat no cambió. */
export async function reactivateFollowUps(organizationId: string, conversationId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ seguimientosOffAt: null, seguimientosOffByUserId: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId), sql`${conversations.seguimientosOffAt} is not null`))
    .returning({ contactId: conversations.contactId });
  if (rows.length === 0) return false;
  if (!(await reopenCancelledFollowUp(organizationId, conversationId, now))) await announce(organizationId, conversationId, rows[0].contactId);
  return true;
}

const hourText = (t: Date, zone: string) => {
  const p = localParts(t, zone);
  return `${p.hh}:${String(p.mm).padStart(2, "0")}`;
};
const dayText = (t: Date) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: VENDOR_ZONE, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: false })
    .format(t)
    .replace(/\./g, "");

/** El aviso de «Cambiar hora» cuando el CRM no dejaría salir el mensaje a esa hora. */
export function sendTimeMessage(problem: SendTimeProblem, t: Date, zone: string): string {
  if (problem.kind === "siete_dias") {
    return `A este cliente ya le llegó una plantilla hace menos de 7 días. Elige desde el ${dayText(problem.from)} (hora de Mazatlán).`;
  }
  // De 7:00 a la última hora permitida del día del cliente, en hora de Mazatlán.
  const p = localParts(t, zone);
  const day = { y: p.y, m: p.m, d: p.d };
  const from = hourText(zonedInstant(zone, day, "07:00"), VENDOR_ZONE);
  const to = hourText(zonedInstant(zone, day, problem.latest), VENDOR_ZONE);
  const why =
    problem.latest === "21:00"
      ? `Los seguimientos salen de 7:00 a 21:00 de su hora`
      : `A esa hora su ventana de 24 h ya cerró y entonces solo se le puede escribir de 7:00 a 19:00 de su hora`;
  return `Para el cliente serían las ${hourText(t, zone)} (su hora). ${why}: elige entre las ${from} y las ${to} de Mazatlán.`;
}

export type ChangeTimeResult = { ok: true } | { ok: false; message: string };

/**
 * Cambiar hora: la elige el vendedor (hora de Mazatlán); se recalcula por dónde saldría. Si a esa hora el
 * CRM no lo dejaría salir (horario del cliente, plantillas hasta las 19:00, 7 días entre plantillas), no se
 * guarda y se dice por qué: así sale justo a la hora que eligió.
 */
export async function changeFollowUpTime(organizationId: string, id: string, dueAt: Date, userId: string, now: Date): Promise<ChangeTimeResult> {
  const gone: ChangeTimeResult = { ok: false, message: "Ese seguimiento ya no está programado." };
  const [row] = await db
    .select({ f: followUps, windowExpiresAt: conversations.windowExpiresAt })
    .from(followUps)
    .innerJoin(conversations, and(eq(conversations.id, followUps.conversationId), eq(conversations.organizationId, organizationId)))
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado")))
    .limit(1);
  if (!row) return gone;
  const f = row.f;
  const caso = f.caso as Exclude<FollowUpCase, "no_seguir">;
  const door = windowOpenAt(row.windowExpiresAt, dueAt) ? "texto" : "plantilla";
  const lastTemplate = door === "plantilla" ? await lastTemplateAt(organizationId, f.contactId, now, await followUpsReal(organizationId)) : null;
  const problem = sendTimeProblem(dueAt, f.timeZone, door, lastTemplate);
  if (problem) return { ok: false, message: sendTimeMessage(problem, dueAt, f.timeZone) };
  const table = await loadFollowUpTable(organizationId, now);
  const updated = await db
    .update(followUps)
    .set({
      dueAt,
      door,
      templateName:
        door === "plantilla"
          ? templateForAttempt(caso, f.intento, templateFor(CASE_RULES[caso].doors[f.intento - 1] ?? "saludo", dueAt, f.timeZone), await approvedTemplateNames(organizationId))
          : null,
      presentarAt: f.modo === "sugerido" ? presentAtFor(dueAt, now, table.vendedores) : null,
      dueSetBy: "vendedor",
      updatedAt: now,
      updatedByUserId: userId,
    })
    .where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado")))
    .returning({ id: followUps.id });
  if (updated.length) await announce(organizationId, f.conversationId, f.contactId);
  return updated.length > 0 ? { ok: true } : gone;
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

/** ¿El contacto quedó «sin seguimientos» (se dio de baja de las promociones, 131050)? */
export async function sinSeguimientosOf(organizationId: string, contactId: string): Promise<boolean> {
  const [row] = await db
    .select({ sin: contacts.sinSeguimientos })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  return row?.sin === true;
}

/** «Quitar» en el Detalle: el contacto vuelve a tener seguimientos (la siguiente lectura arma uno si toca). */
export async function clearSinSeguimientos(organizationId: string, contactId: string): Promise<boolean> {
  const rows = await db
    .update(contacts)
    .set({ sinSeguimientos: false })
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId), eq(contacts.sinSeguimientos, true)))
    .returning({ id: contacts.id });
  return rows.length > 0;
}
