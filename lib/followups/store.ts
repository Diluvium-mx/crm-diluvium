// Seguimientos en la base (docs/seguimientos.md). Parte 1 = MODO ENSAYO: se guarda la ficha
// que deja el lector, se calcula la hora de cada intento y el barrido anota cuándo "habría
// salido"; NUNCA se le manda nada al cliente desde aquí.
//   - applyFollowUpReading: lo llama el lector al terminar cada lectura.
//   - followUpSweepOnce: el barrido del worker (cada minuto).
// Multi-tenant (CLAUDE.md §7): toda lectura y escritura filtra por organization_id.
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, changeHistory, channels, contactEntradas, contacts, conversations, followUps, messages, templates, type FollowUpAttemptLog } from "@/lib/db/schema";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import type { FunnelStage } from "@/lib/contacts/stages";
import { ALLOWED_FROM, ALLOWED_TO, CASE_RULES, isFollowUpCase, TEMPLATE_LATEST, TEMPLATE_SPACING_DAYS, templateForAttempt, timingCase, WAIT_AFTER_LAST_MS, type FollowUpCase, type TemplatePicks } from "./cases";
import { finalCase, type FollowUpFicha, type HardSignals } from "./ficha";
import { effectiveTotal, planAttempt, presentAtFor, templateFor, templateTimeOf, windowOpenAt, type AttemptPlan } from "./schedule";
import { addDays, localMinutes, localParts, minutesOf, zonedInstant } from "./time";
import { sendFollowUpTemplate, sendFollowUpText } from "./dispatch";
import { MARKETING_OPT_OUT, onFollowUpDeliveryFailed } from "./delivery";
import { borradorProblems } from "./borrador-check";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { addNotice } from "@/lib/ai/runtime/notices";
import { notifyContactUpdated } from "@/lib/contacts/notify-updated";
import { zoneForPhone } from "./timezone";
import { caseOn, nextStep, slotOf, type FollowUpTable } from "./tabla";
import { loadFollowUpTable } from "./tabla-store";
import { logError } from "@/lib/log/safe-error";

export type FollowUpRow = typeof followUps.$inferSelect;
const OPEN = ["programado", "esperando"] as const;
type Exec = Pick<typeof db, "select" | "update" | "insert" | "execute">;


/** Aviso "followup.updated" por el canal del tiempo real: la píldora 🤖 se vuelve a pedir. */
async function announce(exec: Exec, organizationId: string, conversationId: string, contactId: string): Promise<void> {
  try {
    await exec.execute(sql`select pg_notify('inbox_events', json_build_object(
      'org', ${organizationId}::text, 'type', 'followup.updated',
      'conversationId', ${conversationId}::text, 'contactId', ${contactId}::text
    )::text)`);
  } catch (error) {
    logError(`[seguimientos] no se pudo avisar el cambio de ${conversationId}`, error);
  }
}

// ── Datos duros del CRM ──────────────────────────────────────────────────────

/** Aviso amarillo de asesor abierto, sin una respuesta humana que haya salido después (misma regla que el Embudo). */
async function asesorPendiente(organizationId: string, conversationId: string): Promise<boolean> {
  const rows = await db.execute<{ open: boolean }>(sql`
    select exists (
      select 1 from ai_agent_notices n
      where n.organization_id = ${organizationId} and n.conversation_id = ${conversationId}
        and n.kind in ('cliente_pide_humano', 'pasar_a_humano') and n.resolved_at is null
        and not exists (
          select 1 from messages h
          where h.organization_id = ${organizationId} and h.conversation_id = ${conversationId}
            and h.direction = 'out' and h.type <> 'system_note' and h.status in ('sent', 'delivered', 'read')
            and (h.source = 'business_app' or (h.source = 'crm' and h.sent_by_user_id is not null))
            and h.imported_at is null and h.created_at > n.created_at
        )
    ) as open
  `);
  return rows[0]?.open === true;
}

/**
 * "Pausar agente" puesto A MANO (no la pausa automática de cuando un vendedor contesta), o la pausa
 * del freno ante contestadores automáticos (7-oct-2026): un seguimiento que saliera solo despertaría
 * otra vez al contestador y, si respondiera, al Agente IA. Ahí el seguimiento queda como sugerencia. La fila del
 * Historial se escribe en la misma transacción que la pausa (agent_state_changed_at): solo se busca
 * desde ahí, así la consulta no recorre todo el Historial de la organización.
 */
export async function manualPauseOf(organizationId: string, conversationId: string, agentState: string, changedAt: Date | null): Promise<boolean> {
  if (agentState !== "pausado_humano") return false;
  const [last] = await db
    .select({ action: changeHistory.action })
    .from(changeHistory)
    .where(
      and(
        eq(changeHistory.organizationId, organizationId),
        eq(changeHistory.kind, "pausas"),
        eq(changeHistory.subjectId, conversationId),
        inArray(changeHistory.action, ["pausar", "pausa_auto", "pausa_tope", "pausa_bucle", "pausa_asesor"]),
        changedAt ? gte(changeHistory.createdAt, new Date(changedAt.getTime() - 60_000)) : undefined,
      ),
    )
    .orderBy(desc(changeHistory.createdAt))
    .limit(1);
  return last?.action === "pausar" || last?.action === "pausa_bucle";
}

/**
 * Última plantilla que le llegó a este contacto: CUALQUIERA que haya salido (las de los vendedores
 * con 📄 o 🕒 también cuentan; decisión del dueño, 3-oct-2026) y las de seguimiento que salieron
 * o, en ensayo, que habrían salido. Nunca dos en menos de 7 días.
 */
export async function lastTemplateAt(organizationId: string, contactId: string, now: Date, real: boolean): Promise<Date | null> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  let last: number | null = null;
  // En ensayo cuentan las que "habrían salido" (para que el ensayo se parezca a lo real). En real
  // NO: una plantilla que nunca le llegó al cliente no lo cansa (6-oct-2026); las reales salen de
  // la tabla de mensajes de abajo.
  if (!real) {
    const rows = await db
      .select({ intentos: followUps.intentos })
      .from(followUps)
      .where(and(eq(followUps.organizationId, organizationId), eq(followUps.contactId, contactId), gte(followUps.createdAt, since)));
    for (const r of rows) for (const a of r.intentos) if (a.door === "plantilla") last = Math.max(last ?? 0, Date.parse(a.at));
  }
  const [sent] = await db
    .select({ at: sql<Date | null>`max(coalesce(${messages.sentAt}, ${messages.createdAt}))`.mapWith(messages.createdAt) })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.organizationId, organizationId)))
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(conversations.contactId, contactId),
        eq(messages.direction, "out"),
        eq(messages.type, "template"),
        inArray(messages.status, ["queued", "sent", "delivered", "read"]),
        gte(messages.createdAt, since),
      ),
    );
  if (sent?.at) last = Math.max(last ?? 0, sent.at.getTime());
  return last === null ? null : new Date(last);
}

/** Plantillas que Meta ya aprobó (las del caso salen solo así; si no, la de respaldo). */
export async function approvedTemplateNames(organizationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: templates.name })
    .from(templates)
    .where(and(eq(templates.organizationId, organizationId), eq(templates.status, "APPROVED")));
  return new Set(rows.map((r) => r.name));
}

type Signals = {
  hard: HardSignals;
  zone: string;
  manualPause: boolean;
  channelOn: boolean;
  windowExpiresAt: Date | null;
  lastTemplateAt: Date | null;
  approved: Set<string>;
  lastClientAt: Date | null;
  /** Se dio de baja de promociones (131050): sin seguimientos. */
  sinSeguimientos: boolean;
  /** Clave de la etapa del contacto ahora. */
  stageKey: string;
  /** Un vendedor canceló los seguimientos de este chat (hasta que alguien los reactive). */
  off: boolean;
  /** Tabla de la organización (Agente IA › Seguimientos). */
  table: FollowUpTable;
};

async function loadSignals(
  organizationId: string,
  conversationId: string,
  contactId: string,
  now: Date,
  known?: { stages: readonly FunnelStage[]; stageKey: string; monto: number | null; pago: number | null },
): Promise<Signals | null> {
  const [row] = await db
    .select({
      phone: contacts.phoneE164,
      stage: contacts.stage,
      monto: contacts.montoCotizacion,
      pago: contacts.pagoTotal,
      agentState: conversations.agentState,
      agentStateChangedAt: conversations.agentStateChangedAt,
      windowExpiresAt: conversations.windowExpiresAt,
      mode: channels.aiAgentMode,
      channelType: channels.type,
      sinSeguimientos: contacts.sinSeguimientos,
      lastInboundAt: conversations.lastInboundAt,
      offAt: conversations.seguimientosOffAt,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.organizationId, organizationId)))
    .innerJoin(channels, and(eq(channels.id, conversations.channelId), eq(channels.organizationId, organizationId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId), eq(conversations.contactId, contactId)))
    .limit(1);
  if (!row) return null;
  const stages = known?.stages ?? (await listFunnelStages(organizationId));
  const stageKey = known?.stageKey ?? row.stage;
  const [medida] = await db
    .select({ id: contactEntradas.id })
    .from(contactEntradas)
    .where(and(eq(contactEntradas.organizationId, organizationId), eq(contactEntradas.contactId, contactId), sql`${contactEntradas.anchoCm} is not null`))
    .limit(1);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    hard: {
      asesorPendiente: await asesorPendiente(organizationId, conversationId),
      stageRole: stages.find((s) => s.key === stageKey)?.role ?? null,
      monto: known ? known.monto : num(row.monto),
      pago: known ? known.pago : num(row.pago),
      tieneMedidas: Boolean(medida),
    },
    zone: zoneForPhone(row.phone),
    manualPause: await manualPauseOf(organizationId, conversationId, row.agentState, row.agentStateChangedAt),
    // Solo WhatsApp con el Agente IA encendido: Instagram no tiene plantillas y lleva su
    // propia regla de 7 días (docs/instagram.md); el dueño descartó sus seguimientos (7-oct-2026).
    channelOn: row.mode === "auto" && row.channelType === "whatsapp",
    windowExpiresAt: row.windowExpiresAt,
    lastTemplateAt: await lastTemplateAt(organizationId, contactId, now, await followUpsReal(organizationId)),
    approved: await approvedTemplateNames(organizationId),
    lastClientAt: row.lastInboundAt ?? (row.windowExpiresAt ? new Date(row.windowExpiresAt.getTime() - 24 * 60 * 60_000) : null),
    sinSeguimientos: row.sinSeguimientos,
    stageKey,
    off: row.offAt !== null,
    table: await loadFollowUpTable(organizationId, now),
  };
}

/** Interruptor de la organización (Agente IA › Opciones): false = ensayo (fábrica). */
export async function followUpsReal(organizationId: string): Promise<boolean> {
  const [row] = await db.select({ real: aiConfig.seguimientosReal }).from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).limit(1);
  return row?.real === true;
}

async function openRow(exec: Exec, organizationId: string, conversationId: string): Promise<FollowUpRow | null> {
  const [row] = await exec
    .select()
    .from(followUps)
    .where(and(eq(followUps.organizationId, organizationId), eq(followUps.conversationId, conversationId), inArray(followUps.status, [...OPEN])))
    .limit(1);
  return row ?? null;
}

async function closeRow(exec: Exec, row: FollowUpRow, status: "contestado" | "cancelado" | "terminado", reason: string | null, now: Date): Promise<void> {
  await exec
    .update(followUps)
    .set({ status, cancelReason: reason, closedAt: now, updatedAt: now })
    .where(and(eq(followUps.id, row.id), eq(followUps.organizationId, row.organizationId), inArray(followUps.status, [...OPEN])));
}

const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// ── Lo que deja el lector ────────────────────────────────────────────────────

export type FollowUpReading = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  /** Hasta dónde leyó el lector (conversations.last_message_at al leer). */
  readUpTo: Date;
  /** La parada: nuestro último mensaje antes de los seguimientos que haya mandado un vendedor. */
  stopAt: Date;
  /** Seguimientos que ya mandó un vendedor después de la parada (cuentan como intento). */
  vendorAttempts?: readonly Date[];
  lastIsCompany: boolean;
  ficha: FollowUpFicha | null;
  stages: readonly FunnelStage[];
  stageKey: string;
  monto: number | null;
  pago: number | null;
  now: Date;
};

/**
 * Guarda, reemplaza o cierra el seguimiento del chat según la lectura. Devuelve una línea
 * para el registro de la lectura (o null si no cambió nada). Nunca lanza hacia afuera.
 */
export async function applyFollowUpReading(r: FollowUpReading): Promise<string | null> {
  try {
    return await applyReading(r);
  } catch (error) {
    logError(`[seguimientos] no se pudo guardar la ficha de ${r.conversationId}`, error);
    return `seguimiento: error al guardar (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function applyReading(r: FollowUpReading): Promise<string | null> {
  const { organizationId, conversationId, contactId, now } = r;
  if (!r.lastIsCompany) {
    // El último mensaje es del cliente: el seguimiento abierto termina (contestó o canceló).
    const existing = await openRow(db, organizationId, conversationId);
    if (!existing) return null;
    const answered = existing.intentos.length > 0;
    await closeRow(db, existing, answered ? "contestado" : "cancelado", answered ? null : "cliente_escribio", now);
    await announce(db, organizationId, conversationId, contactId);
    return answered ? "seguimiento: el cliente contestó" : "seguimiento: cancelado (el cliente escribió)";
  }

  const existing = await openRow(db, organizationId, conversationId);
  if (existing && existing.basedOnMessageAt.getTime() >= r.readUpTo.getTime()) return null;
  const signals = await loadSignals(organizationId, conversationId, contactId, now, { stages: r.stages, stageKey: r.stageKey, monto: r.monto, pago: r.pago });
  if (!signals) return null;
  if (!signals.channelOn) {
    if (existing) {
      await closeRow(db, existing, "cancelado", "agente_apagado", now);
      await announce(db, organizationId, conversationId, contactId);
    }
    return "seguimiento: no (canal sin Agente IA o que no es WhatsApp)";
  }
  if (signals.sinSeguimientos) {
    if (existing) {
      await closeRow(db, existing, "cancelado", "sin_seguimientos", now);
      await announce(db, organizationId, conversationId, contactId);
    }
    return "seguimiento: no (se dio de baja de las promociones)";
  }
  // Cancelados a mano en este chat: nada nuevo hasta que un vendedor o admin los reactive.
  if (signals.off) {
    if (existing) {
      await closeRow(db, existing, "cancelado", "manual", now);
      await announce(db, organizationId, conversationId, contactId);
    }
    return "seguimiento: no (cancelados en este chat; los reactiva un vendedor)";
  }
  const real = await followUpsReal(organizationId);

  const { caso, ajuste } = finalCase(r.ficha, signals.hard);
  // Caso apagado en Agente IA › Seguimientos: el lector lo reconoce, pero no se le escribe.
  if (!caseOn(signals.table, caso) && caso !== "no_seguir") {
    if (existing) {
      await closeRow(db, existing, "cancelado", "caso_apagado", now);
      await announce(db, organizationId, conversationId, contactId);
    }
    return `seguimiento: no (${caso} apagado en Agente IA › Seguimientos)${ajuste ? ` [${ajuste}]` : ""}`;
  }
  const ficha = r.ficha;
  const base = {
    organizationId,
    conversationId,
    contactId,
    caso,
    ensayo: !real,
    pendiente: ficha?.pendiente ?? null,
    siguientePaso: ficha?.siguientePaso ?? null,
    motivo: ficha?.motivo ?? null,
    borrador: caso === "no_seguir" ? null : (ficha?.borrador ?? null),
    fechaPedida: ficha?.fechaPedida ?? null,
    horaPedida: ficha?.horaPedida ?? null,
    casoDeFondo: ficha?.casoDeFondo ?? null,
    plantilla2: ficha?.plantilla2 ?? null,
    plantilla3: ficha?.plantilla3 ?? null,
    timeZone: signals.zone,
    basedOnMessageAt: r.readUpTo,
    createdAt: now,
    updatedAt: now,
  };

  let summary: string;
  await db.transaction(async (tx) => {
    // Una ficha nueva reemplaza a la anterior (un solo pendiente por chat). Si a la anterior todavía
    // no le salió ningún intento NUESTRO, se actualiza en su lugar (cada lectura no deja una fila
    // nueva); si ya salió alguno, se cierra y queda con su historial.
    const current = await openRow(tx, organizationId, conversationId);
    const inPlace = current !== null && current.intentos.every((a) => a.modo === "vendedor");
    if (current && !inPlace) await closeRow(tx, current, "cancelado", "reemplazado", now);
    // "No seguir" sin pendiente abierto: se actualiza la última fila "no seguir" del chat (cada
    // relectura no deja otra igual).
    const [lastNoSeguir] =
      !current && caso === "no_seguir"
        ? await tx
            .select({ id: followUps.id })
            .from(followUps)
            .where(and(eq(followUps.organizationId, organizationId), eq(followUps.conversationId, conversationId), eq(followUps.status, "no_seguir")))
            .orderBy(desc(followUps.createdAt))
            .limit(1)
        : [];
    const targetId = inPlace ? current.id : (lastNoSeguir?.id ?? null);
    const save = async (values: Omit<typeof followUps.$inferInsert, "id">) => {
      if (targetId) {
        const { createdAt: _createdAt, ...rest } = values;
        void _createdAt;
        await tx.update(followUps).set(rest).where(and(eq(followUps.id, targetId), eq(followUps.organizationId, organizationId)));
      } else await tx.insert(followUps).values({ ...values, id: crypto.randomUUID() });
    };
    const reset = { cancelReason: null, closedAt: null, presentarAt: null, autoAprobado: false, dueSetBy: "sistema" as const, updatedByUserId: null };
    if (caso === "no_seguir") {
      await save({ ...base, ...reset, status: "no_seguir", intento: 1, totalIntentos: 0, intentos: [], dueAt: null, door: null, templateName: null, modo: "automatico", closedAt: now });
      summary = `seguimiento: no seguir${ficha?.motivo ? ` (${ficha.motivo})` : ""}`;
      return;
    }
    // Los seguimientos del vendedor ya cuentan (decisión del dueño, 3-oct-2026).
    const vendorLogs: FollowUpAttemptLog[] = (r.vendorAttempts ?? []).map((at, i) => ({ n: i + 1, at: at.toISOString(), door: "texto", template: null, modo: "vendedor", ensayo: false }));
    // El siguiente intento PRENDIDO en la tabla después de los del vendedor.
    const intento = nextStep(signals.table, caso, vendorLogs.length);
    const total = effectiveTotal(caso, vendorLogs.length ? "texto" : null, signals.table);
    const modo = signals.manualPause ? "sugerido" : "automatico";
    if (intento === null || intento > total) {
      if (vendorLogs.length === 0) {
        // Ningún intento prendido (no debería pasar: la tabla lo valida).
        if (current) await closeRow(tx, current, "cancelado", "caso_apagado", now);
        summary = `seguimiento: no (${caso} sin intentos prendidos)`;
        return;
      }
      // El vendedor ya hizo todos los intentos del caso: solo se espera respuesta (después, frío).
      const lastAt = r.vendorAttempts![r.vendorAttempts!.length - 1];
      await save({ ...base, ...reset, status: "esperando", intento: total, totalIntentos: total, intentos: vendorLogs, dueAt: new Date(lastAt.getTime() + WAIT_AFTER_LAST_MS), door: null, templateName: null, modo });
      summary = `seguimiento: ${caso}, el vendedor ya hizo los ${total} intentos; espera respuesta`;
      return;
    }
    const plan =
      intento === 1
        ? planAttempt({
            caso,
            intento: 1,
            zone: signals.zone,
            stopAt: r.stopAt,
            windowExpiresAt: signals.windowExpiresAt,
            now,
            fechaPedida: ficha?.fechaPedida,
            horaPedida: ficha?.horaPedida,
            fondo: ficha?.casoDeFondo,
            lastTemplateAt: signals.lastTemplateAt,
            table: signals.table,
          })
        : planNext({ ...base, caso }, intento, signals.windowExpiresAt, now, r.vendorAttempts?.at(-1) ?? r.stopAt, signals.lastTemplateAt, signals.table);
    const picks: TemplatePicks = { plantilla2: base.plantilla2, plantilla3: base.plantilla3 };
    await save({
      ...base,
      ...reset,
      status: "programado",
      intento,
      totalIntentos: effectiveTotal(caso, vendorLogs.length ? "texto" : intento === 1 ? plan.door : null, signals.table),
      intentos: vendorLogs,
      dueAt: plan.dueAt,
      door: plan.door,
      templateName: templateForAttempt(caso, intento, plan.templateName, signals.approved, picks, null),
      modo,
      presentarAt: modo === "sugerido" ? presentAtFor(plan.dueAt, now, signals.table.vendedores) : null,
    });
    summary = `seguimiento: ${caso} ${intento}.º ${fmt.format(plan.dueAt)} ${plan.door}${vendorLogs.length ? ` (el vendedor ya hizo ${vendorLogs.length})` : ""}${modo === "sugerido" ? " (sugerido)" : ""}`;
  });
  await announce(db, organizationId, conversationId, contactId);
  return `${summary!}${ajuste ? ` [${ajuste}]` : ""}`;
}

// ── Barrido: ensayo o envío real ─────────────────────────────────────────────

export const SWEEP_BATCH = 50;
/** Si el lector no ha releído un chat con mensajes nuevos en este tiempo, el seguimiento se cancela. */
export const STALE_CANCEL_MS = 30 * 60_000;
/** Pago pendiente: aviso al vendedor 24 h después del 2.º intento sin respuesta (decisión del dueño, 3-oct-2026). */
export const PAGO_AVISO_MS = 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type FollowUpRuntimeDeps = { provider?: MessagingProvider };

/** Programa el intento `intento` de una fila (después de que salió el anterior). */
export function planNext(
  row: Pick<FollowUpRow, "caso" | "timeZone" | "basedOnMessageAt" | "fechaPedida" | "horaPedida" | "casoDeFondo">,
  intento: number,
  windowExpiresAt: Date | null,
  now: Date,
  prevAt: Date,
  lastTemplate: Date | null,
  table: FollowUpTable,
): AttemptPlan {
  return planAttempt({
    caso: row.caso as Exclude<FollowUpCase, "no_seguir">,
    intento,
    zone: row.timeZone,
    stopAt: row.basedOnMessageAt,
    windowExpiresAt,
    now,
    fechaPedida: row.fechaPedida,
    horaPedida: row.horaPedida,
    fondo: isFollowUpCase(row.casoDeFondo) ? row.casoDeFondo : null,
    prevAttemptAt: prevAt,
    lastTemplateAt: lastTemplate,
    table,
  });
}

/**
 * Último mensaje del chat que NO es un seguimiento nuestro (los seguimientos no dejan vieja la
 * ficha: la escribió el lector para ellos).
 */
async function lastNonFollowUpAt(organizationId: string, conversationId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${messages.createdAt})`.mapWith(messages.createdAt) })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId), sql`not coalesce(${messages.metadata} ? 'seguimiento', false)`));
  return row?.at ?? null;
}

/**
 * Mismo instante con otra hora: la siguiente que se pueda (7:00–21:00 del cliente; plantilla hasta las 19:00,
 * salvo la hora que eligió el vendedor con «Cambiar hora»: hasta las 21:00, 10-oct-2026).
 */
function nextSendable(now: Date, zone: string, door: "texto" | "plantilla", caso: Exclude<FollowUpCase, "no_seguir">, fondo: FollowUpCase | null, table: FollowUpTable, setByVendor: boolean): Date | null {
  const m = localMinutes(now, zone);
  const latest = door === "plantilla" && !setByVendor ? minutesOf(TEMPLATE_LATEST) : minutesOf(ALLOWED_TO);
  if (m >= minutesOf(ALLOWED_FROM) && m <= latest) return null;
  const today = localParts(now, zone);
  const day = m < minutesOf(ALLOWED_FROM) ? today : addDays(today, 1);
  const time = door === "plantilla" ? templateTimeOf(timingCase(caso, fondo), table) : slotOf(table, timingCase(caso, fondo)).from;
  return zonedInstant(zone, day, time);
}

/** El borrador sigue cumpliendo las reglas contra lo que la empresa escribió en el chat (borrador-check.ts). */
async function borradorFits(organizationId: string, conversationId: string, borrador: string): Promise<boolean> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(80);
  return borradorProblems({ borrador, companyTexts: rows.map((r) => r.body ?? "") }).length === 0;
}

type Advance = { set: Partial<typeof followUps.$inferInsert>; summary: string };

/** Lo que queda en la fila después del intento `row.intento` (que salió o habría salido). */
function afterAttempt(row: FollowUpRow, log: FollowUpAttemptLog, signals: Signals, now: Date): Advance {
  const caso = row.caso as Exclude<FollowUpCase, "no_seguir">;
  const intentos = [...row.intentos, log];
  const firstDoor = intentos[0]?.n === 1 ? intentos[0].door : null;
  const total = effectiveTotal(caso, firstDoor, signals.table);
  const word = row.ensayo ? "habría salido" : log.error ? "no salió" : "salió";
  // El siguiente intento prendido en la tabla (los apagados se saltan).
  const step = nextStep(signals.table, caso, row.intento);
  if (step !== null && step <= total) {
    const lastTemplate = log.door === "plantilla" && !log.error ? now : signals.lastTemplateAt;
    const next = planNext(row, step, signals.windowExpiresAt, now, now, lastTemplate, signals.table);
    const nextModo = signals.manualPause ? "sugerido" : "automatico";
    const picks: TemplatePicks = { plantilla2: row.plantilla2, plantilla3: row.plantilla3 };
    return {
      set: {
        intentos,
        intento: step,
        totalIntentos: total,
        dueAt: next.dueAt,
        door: next.door,
        templateName: templateForAttempt(caso, step, next.templateName, signals.approved, picks, log.template),
        modo: nextModo,
        presentarAt: nextModo === "sugerido" ? presentAtFor(next.dueAt, now, signals.table.vendedores) : null,
        autoAprobado: false,
        dueSetBy: "sistema",
        avisoAt: nextModo === "sugerido" ? null : row.avisoAt,
      },
      summary: `${row.intento}.º ${word} (${log.door}${log.error ? `: ${log.error}` : ""}); ${step}.º ${fmt.format(next.dueAt)}`,
    };
  }
  return {
    set: { intentos, totalIntentos: total, status: "esperando", dueAt: new Date(now.getTime() + WAIT_AFTER_LAST_MS), door: null, templateName: null },
    summary: `${row.intento}.º y último ${word} (${log.door}${log.error ? `: ${log.error}` : ""}); espera respuesta`,
  };
}

async function save(row: FollowUpRow, set: Partial<typeof followUps.$inferInsert>, now: Date): Promise<boolean> {
  // Condicional: si el lector la reemplazó, alguien la canceló o el otro barrido ya la tomó, no se pisa.
  const done = await db
    .update(followUps)
    .set({ ...set, updatedAt: now })
    .where(and(eq(followUps.id, row.id), eq(followUps.organizationId, row.organizationId), eq(followUps.status, "programado"), eq(followUps.intento, row.intento)))
    .returning({ id: followUps.id });
  return done.length > 0;
}

async function advance(row: FollowUpRow, now: Date, deps: FollowUpRuntimeDeps): Promise<string | null> {
  const { organizationId, conversationId, contactId } = row;
  // Algo nuevo en el chat (que no sea un seguimiento nuestro) que el lector todavía no lee: él decide.
  const lastAt = await lastNonFollowUpAt(organizationId, conversationId);
  if (lastAt && lastAt.getTime() > row.basedOnMessageAt.getTime()) {
    if (now.getTime() - lastAt.getTime() < STALE_CANCEL_MS) return null;
    await closeRow(db, row, "cancelado", "nuevo_mensaje", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (mensaje nuevo sin leer)";
  }
  const signals = await loadSignals(organizationId, conversationId, contactId, now);
  if (!signals) return null;
  if (signals.hard.stageRole === "venta_cerrada") {
    await closeRow(db, row, "cancelado", "venta_cerrada", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (ya compró)";
  }
  if (!signals.channelOn) {
    await closeRow(db, row, "cancelado", "agente_apagado", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (Agente IA apagado)";
  }
  if (signals.sinSeguimientos) {
    await closeRow(db, row, "cancelado", "sin_seguimientos", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (se dio de baja de las promociones)";
  }
  if (signals.off) {
    await closeRow(db, row, "cancelado", "manual", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (cancelados en este chat)";
  }
  const caso = row.caso as Exclude<FollowUpCase, "no_seguir">;
  // La tabla cambió desde que se programó (decisión del dueño, 6-oct-2026: lo programado conserva su hora
  // y al llegar se revisa): caso apagado → se cancela; intento apagado → pasa al siguiente prendido.
  if (!caseOn(signals.table, caso)) {
    await closeRow(db, row, "cancelado", "caso_apagado", now);
    await announce(db, organizationId, conversationId, contactId);
    return "cancelado (caso apagado en Agente IA › Seguimientos)";
  }
  if (!signals.table.casos[caso].intentos[row.intento - 1]) return skipStep(row, caso, signals, now);
  const fondo = isFollowUpCase(row.casoDeFondo) ? row.casoDeFondo : null;
  const real = (await followUpsReal(organizationId)) && deps.provider !== undefined;
  const modo = signals.manualPause && !row.autoAprobado ? "sugerido" : "automatico";
  // Real: una sugerencia (pausa puesta a mano) no sale sola; la presenta el aviso al vendedor.
  if (real && modo === "sugerido") return null;
  // Por dónde sale AHORA (la ventana pudo cerrarse desde que se programó). Sin borrador, no hay texto; en
  // real, un borrador que repite una pregunta o el precio del chat (fichas de antes del 3-oct) tampoco.
  const textOk = !real || (row.borrador !== null && (await borradorFits(organizationId, conversationId, row.borrador)));
  const door: "texto" | "plantilla" = windowOpenAt(signals.windowExpiresAt, now) && textOk ? "texto" : "plantilla";
  const picks: TemplatePicks = { plantilla2: row.plantilla2, plantilla3: row.plantilla3 };
  const previous = row.intentos.at(-1)?.template ?? null;
  const templateName =
    door === "plantilla" ? templateForAttempt(caso, row.intento, templateFor(CASE_RULES[caso].doors[row.intento - 1] ?? "saludo", now, row.timeZone), signals.approved, picks, previous) : null;

  if (real) {
    // Último chequeo antes de escribirle al cliente: su hora, el tope de las 19:00 para plantilla (si no la eligió
    // el vendedor) y los 7 días.
    let later = nextSendable(now, row.timeZone, door, caso, fondo, signals.table, row.dueSetBy === "vendedor");
    if (!later && door === "plantilla" && signals.lastTemplateAt && now.getTime() < signals.lastTemplateAt.getTime() + TEMPLATE_SPACING_DAYS * DAY_MS) {
      later = planAttempt({
        caso,
        intento: Math.max(2, row.intento),
        zone: row.timeZone,
        stopAt: row.basedOnMessageAt,
        windowExpiresAt: null,
        now,
        fondo,
        prevAttemptAt: now,
        lastTemplateAt: signals.lastTemplateAt,
        table: signals.table,
      }).dueAt;
    }
    if (later) {
      if (!(await save(row, { dueAt: later }, now))) return null;
      await announce(db, organizationId, conversationId, contactId);
      return `${row.intento}.º se mueve a ${fmt.format(later)} (hora del cliente o 7 días entre plantillas)`;
    }
  }

  const messageId = real ? crypto.randomUUID() : null;
  const log: FollowUpAttemptLog = { n: row.intento, at: now.toISOString(), door, template: templateName, modo, ensayo: !real, messageId };
  const step = afterAttempt({ ...row, ensayo: !real }, log, signals, now);
  // Se aparta la fila ANTES de mandar: dos barridos nunca mandan el mismo intento.
  if (!(await save(row, { ...step.set, ensayo: !real }, now))) return null;
  if (!real) {
    await announce(db, organizationId, conversationId, contactId);
    return step.summary;
  }
  const mark = { followUpId: row.id, intento: row.intento, etapa: signals.stageKey };
  const sent =
    door === "texto"
      ? await sendFollowUpText(deps.provider!, { organizationId, conversationId, messageId: messageId!, borrador: row.borrador!, zone: row.timeZone, now, mark })
      : templateName
        ? await sendFollowUpTemplate(deps.provider!, {
            organizationId,
            conversationId,
            messageId: messageId!,
            templateName,
            lastClientAt: signals.lastClientAt,
            zone: row.timeZone,
            now,
            mark,
          })
        : ({ ok: false, error: "no hay plantilla para este intento", code: null } as const);
  if (!sent.ok) {
    await patchAttempt(row.id, organizationId, row.intento, { error: sent.error });
    // 131050 en el momento: el cliente se dio de baja de las promociones.
    if (sent.code === MARKETING_OPT_OUT) await onFollowUpDeliveryFailed({ organizationId, conversationId, errorCode: sent.code, errorMessage: null });
  }
  await announce(db, organizationId, conversationId, contactId);
  return sent.ok ? step.summary : step.summary.replace(/ salió \(/, ` no salió (${sent.error}; `);
}

/**
 * El intento programado quedó apagado en la tabla: se programa el siguiente prendido (con sus tiempos de
 * siempre desde el último que salió); si ya no queda ninguno, se espera respuesta tras el último que salió
 * (después, frío) o, si no salió ninguno, se cancela.
 */
async function skipStep(row: FollowUpRow, caso: Exclude<FollowUpCase, "no_seguir">, signals: Signals, now: Date): Promise<string | null> {
  const { organizationId, conversationId, contactId } = row;
  const firstDoor = row.intentos[0]?.n === 1 ? row.intentos[0].door : null;
  const total = effectiveTotal(caso, firstDoor, signals.table);
  const step = nextStep(signals.table, caso, row.intento);
  const last = row.intentos.at(-1);
  if (step !== null && step <= total) {
    const plan = planNext(row, step, signals.windowExpiresAt, now, last ? new Date(last.at) : row.basedOnMessageAt, signals.lastTemplateAt, signals.table);
    const modo = signals.manualPause && !row.autoAprobado ? "sugerido" : "automatico";
    const picks: TemplatePicks = { plantilla2: row.plantilla2, plantilla3: row.plantilla3 };
    const done = await save(
      row,
      {
        intento: step,
        totalIntentos: total,
        dueAt: plan.dueAt,
        door: plan.door,
        templateName: templateForAttempt(caso, step, plan.templateName, signals.approved, picks, last?.template ?? null),
        modo,
        presentarAt: modo === "sugerido" ? presentAtFor(plan.dueAt, now, signals.table.vendedores) : null,
        dueSetBy: "sistema",
      },
      now,
    );
    if (!done) return null;
    await announce(db, organizationId, conversationId, contactId);
    return `${row.intento}.º apagado en Agente IA › Seguimientos; pasa al ${step}.º ${fmt.format(plan.dueAt)}`;
  }
  if (last) {
    const done = await save(row, { status: "esperando", totalIntentos: row.intentos.length, dueAt: new Date(Date.parse(last.at) + WAIT_AFTER_LAST_MS), door: null, templateName: null }, now);
    if (!done) return null;
    await announce(db, organizationId, conversationId, contactId);
    return `${row.intento}.º apagado en Agente IA › Seguimientos; ya no quedan intentos, espera respuesta`;
  }
  await closeRow(db, row, "cancelado", "intento_apagado", now);
  await announce(db, organizationId, conversationId, contactId);
  return `cancelado (${row.intento}.º apagado en Agente IA › Seguimientos y no quedan intentos)`;
}

/** Anota en el intento `n` de la fila lo que pasó después (error del envío o de Meta). */
export async function patchAttempt(id: string, organizationId: string, n: number, patch: Partial<FollowUpAttemptLog>): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ intentos: followUps.intentos }).from(followUps).where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId))).for("update");
    if (!row) return;
    const intentos = row.intentos.map((a) => (a.n === n && a.modo !== "vendedor" ? { ...a, ...patch } : a));
    await tx.update(followUps).set({ intentos, updatedAt: new Date() }).where(and(eq(followUps.id, id), eq(followUps.organizationId, organizationId)));
  });
}

/** Intentos que de verdad le llegaron al cliente (modo real, sin error). */
export function realAttempts(row: Pick<FollowUpRow, "intentos">): FollowUpAttemptLog[] {
  return row.intentos.filter((a) => a.modo !== "vendedor" && !a.ensayo && a.messageId && !a.error);
}

/** Avisos al vendedor (tarjeta amarilla): sugerencia presentada y pago pendiente sin respuesta. */
async function vendorNotices(now: Date): Promise<number> {
  let n = 0;
  const rows = await db
    .select()
    .from(followUps)
    .where(and(inArray(followUps.status, [...OPEN]), isNull(followUps.avisoAt), eq(followUps.ensayo, false)))
    .limit(SWEEP_BATCH);
  for (const row of rows) {
    let body: string | null = null;
    let messageId: string | null = null;
    const sent = realAttempts(row);
    if (row.status === "programado" && row.modo === "sugerido" && !row.autoAprobado && row.presentarAt && row.presentarAt <= now) {
      // Caso o intento apagado en la tabla: no se le presenta al vendedor.
      const table = await loadFollowUpTable(row.organizationId, now);
      if (!caseOn(table, row.caso as FollowUpCase) || !table.casos[row.caso as Exclude<FollowUpCase, "no_seguir">].intentos[row.intento - 1]) continue;
      body = `Seguimiento sugerido (${CASE_RULES[row.caso as FollowUpCase].label}): ${row.pendiente ?? "quedó un pendiente"}. Mándalo tú o pulsa «Que salga solo» en la píldora 🤖.`;
    } else if (row.caso === "pago_pendiente" && sent.length >= 2 && Date.parse(sent[sent.length - 1].at) <= now.getTime() - PAGO_AVISO_MS) {
      body = `Pago pendiente: no ha contestado ${sent.length} seguimientos. Escríbele tú.`;
      messageId = sent[sent.length - 1].messageId ?? null;
    }
    if (!body) continue;
    const claimed = await db
      .update(followUps)
      .set({ avisoAt: now, updatedAt: now })
      .where(and(eq(followUps.id, row.id), eq(followUps.organizationId, row.organizationId), isNull(followUps.avisoAt)))
      .returning({ id: followUps.id });
    if (claimed.length === 0) continue;
    await addNotice({ organizationId: row.organizationId, conversationId: row.conversationId, kind: "seguimiento", body, messageId });
    n++;
  }
  return n;
}

/** Terminó la espera tras el último intento: frío (y aviso en asesor sin respuesta). Solo si salió de verdad. */
async function endWaits(now: Date): Promise<number> {
  const ended = await db
    .update(followUps)
    .set({ status: "terminado", closedAt: now, updatedAt: now })
    .where(and(eq(followUps.status, "esperando"), lte(followUps.dueAt, now)))
    .returning();
  for (const e of ended) {
    await announce(db, e.organizationId, e.conversationId, e.contactId);
    if (realAttempts(e).length === 0) continue;
    await db.transaction(async (tx) => {
      const [c] = await tx
        .update(contacts)
        .set({ temperature: "frio" })
        .where(and(eq(contacts.id, e.contactId), eq(contacts.organizationId, e.organizationId), sql`${contacts.temperature} is distinct from 'frio'`))
        .returning({ id: contacts.id });
      if (c) await notifyContactUpdated(tx, { organizationId: e.organizationId, contactId: e.contactId, changes: ["temperatura"], by: { kind: "agente" } });
    });
    if (e.caso === "asesor_sin_respuesta") {
      const last = realAttempts(e).at(-1);
      await addNotice({ organizationId: e.organizationId, conversationId: e.conversationId, kind: "seguimiento", body: "Asesor sin respuesta: el cliente no contestó los seguimientos. Escríbele tú.", messageId: last?.messageId ?? null });
    }
  }
  return ended.length;
}

/** Una pasada: intentos vencidos, avisos al vendedor y esperas que ya terminaron (frío). */
export async function followUpSweepOnce(now: Date, deps: FollowUpRuntimeDeps = {}): Promise<number> {
  let changed = 0;
  // Una sugerencia sin «Que salga solo» en una organización en modo real no se toma: no sale sola.
  const due = await db
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.status, "programado"),
        lte(followUps.dueAt, now),
        sql`(${followUps.modo} <> 'sugerido' or ${followUps.autoAprobado}
          or not coalesce((select a.seguimientos_real from ai_config a where a.organization_id = ${followUps.organizationId}), false))`,
      ),
    )
    .orderBy(followUps.dueAt)
    .limit(SWEEP_BATCH);
  for (const row of due) {
    try {
      const summary = await advance(row, now, deps);
      if (summary) {
        changed++;
        console.info(`[seguimientos] ${row.conversationId} ${row.caso}: ${summary}`);
      }
    } catch (error) {
      logError(`[seguimientos] no se pudo avanzar ${row.id}`, error);
    }
  }
  try {
    changed += await vendorNotices(now);
  } catch (error) {
    logError("[seguimientos] avisos al vendedor fallaron", error);
  }
  changed += await endWaits(now);
  return changed;
}

export function startFollowUpRuntime(deps: FollowUpRuntimeDeps = {}, now: () => Date = () => new Date(), everyMs = 60_000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await followUpSweepOnce(now(), deps);
    } catch (error) {
      logError("[seguimientos] barrido falló", error);
    } finally {
      running = false;
    }
  };
  return {
    run: () => {
      timer = setInterval(() => void tick(), everyMs);
      console.info(`[seguimientos] barrido cada ${everyMs / 1000} s (Ensayo o Real según Agente IA › Opciones)`);
    },
    close: async () => {
      if (timer) clearInterval(timer);
      for (let i = 0; running && i < 50; i++) await new Promise((r) => setTimeout(r, 200));
    },
  };
}

/**
 * «Reactivar» (6-oct-2026): vuelve a programar el último seguimiento que se canceló a mano en este chat,
 * desde su intento pendiente y con la hora que toque desde ahora, si el chat no cambió desde entonces.
 * Si cambió, no hay nada que reabrir: la siguiente lectura del Agente IA arma uno nuevo si el chat se para.
 * Devuelve si reabrió alguno.
 */
export async function reopenCancelledFollowUp(organizationId: string, conversationId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.organizationId, organizationId), eq(followUps.conversationId, conversationId), eq(followUps.status, "cancelado"), eq(followUps.cancelReason, "manual")))
    .orderBy(desc(followUps.closedAt))
    .limit(1);
  if (!row) return false;
  const lastAt = await lastNonFollowUpAt(organizationId, conversationId);
  if (lastAt && lastAt.getTime() > row.basedOnMessageAt.getTime()) return false;
  if (await openRow(db, organizationId, conversationId)) return false;
  const signals = await loadSignals(organizationId, conversationId, row.contactId, now);
  if (!signals || !signals.channelOn || signals.off || signals.sinSeguimientos || signals.hard.stageRole === "venta_cerrada") return false;
  const caso = row.caso as Exclude<FollowUpCase, "no_seguir">;
  if (!caseOn(signals.table, caso)) return false;
  // Si su intento quedó apagado en la tabla, se reabre en el siguiente prendido.
  const step = signals.table.casos[caso].intentos[row.intento - 1] ? row.intento : nextStep(signals.table, caso, row.intento);
  if (step === null) return false;
  const prev = row.intentos.at(-1);
  const plan = planNext(row, step, signals.windowExpiresAt, now, prev ? new Date(prev.at) : row.basedOnMessageAt, signals.lastTemplateAt, signals.table);
  const picks: TemplatePicks = { plantilla2: row.plantilla2, plantilla3: row.plantilla3 };
  const modo = signals.manualPause ? "sugerido" : "automatico";
  const done = await db
    .update(followUps)
    .set({
      status: "programado",
      cancelReason: null,
      closedAt: null,
      intento: step,
      dueAt: plan.dueAt,
      door: plan.door,
      templateName: templateForAttempt(caso, step, plan.templateName, signals.approved, picks, prev?.template ?? null),
      modo,
      presentarAt: modo === "sugerido" ? presentAtFor(plan.dueAt, now, signals.table.vendedores) : null,
      autoAprobado: false,
      avisoAt: null,
      updatedAt: now,
    })
    .where(and(eq(followUps.id, row.id), eq(followUps.organizationId, organizationId), eq(followUps.status, "cancelado")))
    .returning({ id: followUps.id });
  if (done.length > 0) await announce(db, organizationId, conversationId, row.contactId);
  return done.length > 0;
}
