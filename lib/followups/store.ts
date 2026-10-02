// Seguimientos en la base (docs/seguimientos.md). Parte 1 = MODO ENSAYO: se guarda la ficha
// que deja el lector, se calcula la hora de cada intento y el barrido anota cuándo "habría
// salido"; NUNCA se le manda nada al cliente desde aquí.
//   - applyFollowUpReading: lo llama el lector al terminar cada lectura.
//   - followUpSweepOnce: el barrido del worker (cada minuto).
// Multi-tenant (CLAUDE.md §7): toda lectura y escritura filtra por organization_id.
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { changeHistory, channels, contactEntradas, contacts, conversations, followUps, type FollowUpAttemptLog } from "@/lib/db/schema";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import type { FunnelStage } from "@/lib/contacts/stages";
import { CASE_RULES, WAIT_AFTER_LAST_MS, type FollowUpCase } from "./cases";
import { finalCase, type FollowUpFicha, type HardSignals } from "./ficha";
import { effectiveTotal, planAttempt, presentAtFor, templateFor, windowOpenAt, type AttemptPlan } from "./schedule";
import { zoneForPhone } from "./timezone";

export type FollowUpRow = typeof followUps.$inferSelect;
const OPEN = ["programado", "esperando"] as const;
type Exec = Pick<typeof db, "select" | "update" | "insert" | "execute">;

// Parte 1: todo en ensayo. La Parte 2 lo cambia por chat/organización.
export const FOLLOW_UPS_ENSAYO = true;

/** Aviso "followup.updated" por el canal del tiempo real: la píldora 🤖 se vuelve a pedir. */
async function announce(exec: Exec, organizationId: string, conversationId: string, contactId: string): Promise<void> {
  try {
    await exec.execute(sql`select pg_notify('inbox_events', json_build_object(
      'org', ${organizationId}::text, 'type', 'followup.updated',
      'conversationId', ${conversationId}::text, 'contactId', ${contactId}::text
    )::text)`);
  } catch (error) {
    console.error(`[seguimientos] no se pudo avisar el cambio de ${conversationId}`, error);
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
 * "Pausar agente" puesto A MANO (no la pausa automática de cuando un vendedor contesta). La fila del
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
        inArray(changeHistory.action, ["pausar", "pausa_auto", "pausa_tope", "pausa_asesor"]),
        changedAt ? gte(changeHistory.createdAt, new Date(changedAt.getTime() - 60_000)) : undefined,
      ),
    )
    .orderBy(desc(changeHistory.createdAt))
    .limit(1);
  return last?.action === "pausar";
}

/** Última plantilla de seguimiento que salió (o habría salido, en ensayo) a este contacto. */
async function lastTemplateAt(organizationId: string, contactId: string, now: Date): Promise<Date | null> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const rows = await db
    .select({ intentos: followUps.intentos })
    .from(followUps)
    .where(and(eq(followUps.organizationId, organizationId), eq(followUps.contactId, contactId), gte(followUps.createdAt, since)));
  let last: number | null = null;
  for (const r of rows) for (const a of r.intentos) if (a.door === "plantilla") last = Math.max(last ?? 0, Date.parse(a.at));
  return last === null ? null : new Date(last);
}

type Signals = {
  hard: HardSignals;
  zone: string;
  manualPause: boolean;
  channelOn: boolean;
  windowExpiresAt: Date | null;
  lastTemplateAt: Date | null;
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
    // propia regla de 7 días (docs/instagram.md); sus seguimientos quedan para después.
    channelOn: row.mode === "auto" && row.channelType === "whatsapp",
    windowExpiresAt: row.windowExpiresAt,
    lastTemplateAt: await lastTemplateAt(organizationId, contactId, now),
  };
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
  /** Nuestro último mensaje (la parada), si el último del chat es de la empresa. */
  stopAt: Date;
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
    console.error(`[seguimientos] no se pudo guardar la ficha de ${r.conversationId}`, error);
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

  const { caso, ajuste } = finalCase(r.ficha, signals.hard);
  const ficha = r.ficha;
  const base = {
    organizationId,
    conversationId,
    contactId,
    caso,
    ensayo: FOLLOW_UPS_ENSAYO,
    pendiente: ficha?.pendiente ?? null,
    siguientePaso: ficha?.siguientePaso ?? null,
    motivo: ficha?.motivo ?? null,
    borrador: caso === "no_seguir" ? null : (ficha?.borrador ?? null),
    fechaPedida: ficha?.fechaPedida ?? null,
    horaPedida: ficha?.horaPedida ?? null,
    timeZone: signals.zone,
    basedOnMessageAt: r.readUpTo,
    createdAt: now,
    updatedAt: now,
  };

  let summary: string;
  await db.transaction(async (tx) => {
    // Una ficha nueva reemplaza a la anterior (un solo pendiente por chat). Si a la anterior todavía
    // no le salió ningún intento, se actualiza en su lugar (cada lectura no deja una fila nueva); si
    // ya salió alguno, se cierra y queda con su historial.
    const current = await openRow(tx, organizationId, conversationId);
    const inPlace = current !== null && current.intentos.length === 0;
    if (current && !inPlace) await closeRow(tx, current, "cancelado", "reemplazado", now);
    const save = async (values: Omit<typeof followUps.$inferInsert, "id">) => {
      if (inPlace) {
        const { createdAt: _createdAt, ...rest } = values;
        void _createdAt;
        await tx.update(followUps).set(rest).where(and(eq(followUps.id, current.id), eq(followUps.organizationId, organizationId)));
      } else await tx.insert(followUps).values({ ...values, id: crypto.randomUUID() });
    };
    const reset = { cancelReason: null, closedAt: null, presentarAt: null, autoAprobado: false, dueSetBy: "sistema" as const, updatedByUserId: null };
    if (caso === "no_seguir") {
      await save({ ...base, ...reset, status: "no_seguir", intento: 1, totalIntentos: 0, dueAt: null, door: null, templateName: null, modo: "automatico", closedAt: now });
      summary = `seguimiento: no seguir${ficha?.motivo ? ` (${ficha.motivo})` : ""}`;
      return;
    }
    const plan = planAttempt({
      caso,
      intento: 1,
      zone: signals.zone,
      stopAt: r.stopAt,
      windowExpiresAt: signals.windowExpiresAt,
      now,
      fechaPedida: ficha?.fechaPedida,
      horaPedida: ficha?.horaPedida,
      lastTemplateAt: signals.lastTemplateAt,
    });
    const modo = signals.manualPause ? "sugerido" : "automatico";
    await save({
      ...base,
      ...reset,
      status: "programado",
      intento: 1,
      totalIntentos: effectiveTotal(caso, plan.door),
      dueAt: plan.dueAt,
      door: plan.door,
      templateName: plan.templateName,
      modo,
      presentarAt: modo === "sugerido" ? presentAtFor(plan.dueAt, now) : null,
    });
    summary = `seguimiento: ${caso} 1.º ${fmt.format(plan.dueAt)} ${plan.door}${modo === "sugerido" ? " (sugerido)" : ""}`;
  });
  await announce(db, organizationId, conversationId, contactId);
  return `${summary!}${ajuste ? ` [${ajuste}]` : ""}`;
}

// ── Barrido del ensayo ───────────────────────────────────────────────────────

export const SWEEP_BATCH = 50;
/** Si el lector no ha releído un chat con mensajes nuevos en este tiempo, el seguimiento se cancela. */
export const STALE_CANCEL_MS = 30 * 60_000;

/** Programa el intento `intento` de una fila (después de que salió el anterior). */
export function planNext(row: Pick<FollowUpRow, "caso" | "timeZone" | "basedOnMessageAt" | "fechaPedida" | "horaPedida">, intento: number, windowExpiresAt: Date | null, now: Date, prevAt: Date, lastTemplate: Date | null): AttemptPlan {
  return planAttempt({
    caso: row.caso as Exclude<FollowUpCase, "no_seguir">,
    intento,
    zone: row.timeZone,
    stopAt: row.basedOnMessageAt,
    windowExpiresAt,
    now,
    fechaPedida: row.fechaPedida,
    horaPedida: row.horaPedida,
    prevAttemptAt: prevAt,
    lastTemplateAt: lastTemplate,
  });
}

async function advance(row: FollowUpRow, now: Date): Promise<string | null> {
  const { organizationId, conversationId, contactId } = row;
  const [conv] = await db
    .select({ lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conv) return null;
  // Algo nuevo en el chat que el lector todavía no lee: él decide (contestó, reemplaza…).
  if (conv.lastMessageAt.getTime() > row.basedOnMessageAt.getTime()) {
    if (now.getTime() - conv.lastMessageAt.getTime() < STALE_CANCEL_MS) return null;
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
  const caso = row.caso as Exclude<FollowUpCase, "no_seguir">;
  // Por dónde sale AHORA (la ventana pudo cerrarse desde que se programó).
  const door = windowOpenAt(signals.windowExpiresAt, now) ? "texto" : "plantilla";
  const templateName = door === "plantilla" ? templateFor(CASE_RULES[caso].doors[row.intento - 1] ?? "saludo", now, row.timeZone) : null;
  const modo = signals.manualPause && !row.autoAprobado ? "sugerido" : "automatico";
  const log: FollowUpAttemptLog = { n: row.intento, at: now.toISOString(), door, template: templateName, modo, ensayo: row.ensayo };
  const intentos = [...row.intentos, log];
  const firstDoor = intentos[0]?.door ?? door;
  const total = effectiveTotal(caso, firstDoor);
  let set: Partial<typeof followUps.$inferInsert>;
  let summary: string;
  if (row.intento < total) {
    const lastTemplate = door === "plantilla" ? now : signals.lastTemplateAt;
    const next = planNext(row, row.intento + 1, signals.windowExpiresAt, now, now, lastTemplate);
    const nextModo = signals.manualPause ? "sugerido" : "automatico";
    set = {
      intentos,
      intento: row.intento + 1,
      totalIntentos: total,
      dueAt: next.dueAt,
      door: next.door,
      templateName: next.templateName,
      modo: nextModo,
      presentarAt: nextModo === "sugerido" ? presentAtFor(next.dueAt, now) : null,
      autoAprobado: false,
      dueSetBy: "sistema",
    };
    summary = `${row.intento}.º ${row.ensayo ? "habría salido" : "salió"} (${door}); ${row.intento + 1}.º ${fmt.format(next.dueAt)}`;
  } else {
    set = { intentos, totalIntentos: total, status: "esperando", dueAt: new Date(now.getTime() + WAIT_AFTER_LAST_MS), door: null, templateName: null };
    summary = `${row.intento}.º y último ${row.ensayo ? "habría salido" : "salió"} (${door}); espera respuesta`;
  }
  // Condicional: si el lector la reemplazó o alguien la canceló en medio, no se pisa.
  const done = await db
    .update(followUps)
    .set({ ...set, updatedAt: now })
    .where(and(eq(followUps.id, row.id), eq(followUps.organizationId, organizationId), eq(followUps.status, "programado"), eq(followUps.intento, row.intento)))
    .returning({ id: followUps.id });
  if (done.length === 0) return null;
  await announce(db, organizationId, conversationId, contactId);
  return summary;
}

/** Una pasada: intentos vencidos y esperas que ya terminaron (frío). Devuelve cuántas filas cambió. */
export async function followUpSweepOnce(now: Date): Promise<number> {
  let changed = 0;
  const due = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.status, "programado"), lte(followUps.dueAt, now)))
    .orderBy(followUps.dueAt)
    .limit(SWEEP_BATCH);
  for (const row of due) {
    try {
      const summary = await advance(row, now);
      if (summary) {
        changed++;
        console.info(`[seguimientos] ${row.conversationId} ${row.caso}: ${summary}`);
      }
    } catch (error) {
      console.error(`[seguimientos] no se pudo avanzar ${row.id}`, error);
    }
  }
  const ended = await db
    .update(followUps)
    .set({ status: "terminado", closedAt: now, updatedAt: now })
    .where(and(eq(followUps.status, "esperando"), lte(followUps.dueAt, now)))
    .returning({ organizationId: followUps.organizationId, conversationId: followUps.conversationId, contactId: followUps.contactId });
  for (const e of ended) {
    changed++;
    await announce(db, e.organizationId, e.conversationId, e.contactId);
  }
  return changed;
}

export function startFollowUpRuntime(now: () => Date = () => new Date(), everyMs = 60_000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await followUpSweepOnce(now());
    } catch (error) {
      console.error("[seguimientos] barrido falló", error);
    } finally {
      running = false;
    }
  };
  return {
    run: () => {
      timer = setInterval(() => void tick(), everyMs);
      console.info(`[seguimientos] barrido cada ${everyMs / 1000} s (modo ensayo: no se manda nada)`);
    },
    close: async () => {
      if (timer) clearInterval(timer);
      for (let i = 0; running && i < 50; i++) await new Promise((r) => setTimeout(r, 200));
    },
  };
}
