// Columnas del Embudo (etapas) de UNA organización: lectura y las escrituras del editor
// (crear, renombrar/editar, reordenar, cambiar de papel, borrar reasignando contactos).
// Cada escritura va en una transacción con candado por organización, valida el juego
// completo (lib/contacts/stages.ts), deja su fila en el historial de cambios (Bloque A;
// `userId` = quién) y manda UN solo aviso `stages.updated` por el SSE (NOTIFY al confirmar). Multi-tenant: toda consulta filtra por organization_id.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, funnelStages, workflows } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import { recordStageChanges } from "./stage-history";
import { preview } from "@/lib/historial/diff";
import {
  MAX_STAGES,
  MIN_STAGES,
  normalizeStageName,
  sortStages,
  stageKeyFromName,
  STAGE_COLOR_PATTERN,
  STAGE_COLORS,
  STAGE_ROLE_LABELS,
  validateStageSet,
  type FunnelStage,
  type ModelSlot,
  type StageRole,
} from "./stages";

type Database = Omit<typeof db, "$client">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Pick<Database, "select" | "execute" | "insert" | "update" | "delete">;

export class FunnelStageError extends Error {}

/** Evento `stages.updated` del SSE (una sola señal por cambio, no una por contacto). */
export type StagesUpdatedReason = "created" | "updated" | "reordered" | "role" | "deleted";

export async function listFunnelStages(organizationId: string, exec: Exec = db): Promise<FunnelStage[]> {
  const rows = await exec
    .select({
      id: funnelStages.id,
      key: funnelStages.key,
      name: funnelStages.name,
      position: funnelStages.position,
      color: funnelStages.color,
      role: funnelStages.role,
      botRule: funnelStages.botRule,
      modelSlot: funnelStages.modelSlot,
    })
    .from(funnelStages)
    .where(eq(funnelStages.organizationId, organizationId))
    .orderBy(asc(funnelStages.position), asc(funnelStages.key));
  return sortStages(rows.map((r) => ({ ...r, modelSlot: (r.modelSlot === 1 ? 1 : 2) as ModelSlot })));
}

/**
 * Aviso en vivo (mismo canal `inbox_events` del SSE, filtrado por organización). Se
 * llama DENTRO de la transacción: NOTIFY sale al confirmar y nunca si se revierte.
 */
export async function notifyStagesUpdated(
  exec: Pick<Database, "execute">,
  input: { organizationId: string; reason: StagesUpdatedReason; movedContacts?: number; from?: string; to?: string },
): Promise<void> {
  await exec.execute(sql`
    select pg_notify('inbox_events', json_build_object(
      'org', ${input.organizationId}::text,
      'type', 'stages.updated',
      'reason', ${input.reason}::text,
      'movedContacts', ${input.movedContacts ?? 0}::int,
      'from', ${input.from ?? null}::text,
      'to', ${input.to ?? null}::text
    )::text)
  `);
}

// Candado por organización: dos ediciones a la vez no se pisan las posiciones ni los papeles.
async function lockOrg(tx: Tx, organizationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`funnel_stages:${organizationId}`}))`);
}

async function assertValid(tx: Tx, organizationId: string): Promise<FunnelStage[]> {
  const stages = await listFunnelStages(organizationId, tx);
  const errors = validateStageSet(stages);
  if (errors.length) throw new FunnelStageError(errors[0]);
  return stages;
}

// Renumera 1..n en el orden dado (≤ 10 filas).
async function renumber(tx: Tx, organizationId: string, orderedIds: readonly string[]): Promise<void> {
  for (const [i, id] of orderedIds.entries()) {
    await tx
      .update(funnelStages)
      .set({ position: i + 1, updatedAt: new Date() })
      .where(and(eq(funnelStages.id, id), eq(funnelStages.organizationId, organizationId)));
  }
}

function checkColor(color: string): string {
  if (!STAGE_COLOR_PATTERN.test(color)) throw new FunnelStageError("El color debe ser un valor hexadecimal como #0A559A.");
  return color.toUpperCase();
}

export async function createFunnelStage(
  organizationId: string,
  input: { name: string; color?: string; afterId?: string | null; botRule?: string; modelSlot?: ModelSlot },
  userId: string | null = null,
): Promise<FunnelStage> {
  const named = normalizeStageName(input.name);
  if (!named.ok) throw new FunnelStageError(named.error);
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const current = await listFunnelStages(organizationId, tx);
    if (current.length >= MAX_STAGES) throw new FunnelStageError(`El Embudo no puede tener más de ${MAX_STAGES} etapas.`);
    const key = stageKeyFromName(named.name, current.map((s) => s.key));
    const color = checkColor(input.color ?? STAGE_COLORS[current.length % STAGE_COLORS.length]);
    const id = crypto.randomUUID();
    // Va después de `afterId` (o al final); las posiciones se renumeran.
    const order = current.map((s) => s.id);
    const at = input.afterId ? order.indexOf(input.afterId) : -1;
    if (input.afterId && at < 0) throw new FunnelStageError("La etapa de referencia ya no existe.");
    order.splice(at < 0 ? order.length : at + 1, 0, id);
    await tx.insert(funnelStages).values({
      id,
      organizationId,
      key,
      name: named.name,
      position: current.length + 1,
      color,
      role: null,
      botRule: (input.botRule ?? "").trim(),
      modelSlot: input.modelSlot ?? 2,
    });
    await renumber(tx, organizationId, order);
    const stages = await assertValid(tx, organizationId);
    const rule = (input.botRule ?? "").trim();
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "etapas",
      action: "crear",
      subject: named.name,
      subjectId: id,
      newValue: named.name,
      detail: rule ? { type: "texto", title: "Regla del Agente IA", before: null, after: rule } : null,
    });
    await notifyStagesUpdated(tx, { organizationId, reason: "created" });
    return stages.find((s) => s.id === id)!;
  });
}

export async function updateFunnelStage(
  organizationId: string,
  id: string,
  input: { name?: string; color?: string; botRule?: string; modelSlot?: ModelSlot },
  userId: string | null = null,
): Promise<FunnelStage> {
  const patch: Partial<typeof funnelStages.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const named = normalizeStageName(input.name);
    if (!named.ok) throw new FunnelStageError(named.error);
    patch.name = named.name;
  }
  if (input.color !== undefined) patch.color = checkColor(input.color);
  if (input.botRule !== undefined) patch.botRule = input.botRule.trim();
  if (input.modelSlot !== undefined) patch.modelSlot = input.modelSlot;
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const before = (await listFunnelStages(organizationId, tx)).find((s) => s.id === id);
    const rows = await tx
      .update(funnelStages)
      .set(patch)
      .where(and(eq(funnelStages.id, id), eq(funnelStages.organizationId, organizationId)))
      .returning({ id: funnelStages.id });
    if (rows.length === 0 || !before) throw new FunnelStageError("Esa etapa ya no existe.");
    const stages = await assertValid(tx, organizationId);
    // Historial: nombre, modelo y regla del Agente IA (Bloque E; el color no se registra).
    const name = patch.name ?? before.name;
    const slot = (n: number) => `Modelo ${n}`;
    await logChanges(tx, [
      ...(patch.name !== undefined && patch.name !== before.name
        ? [{ organizationId, userId, kind: "etapas" as const, action: "renombrar" as const, subject: name, subjectId: id, oldValue: before.name, newValue: patch.name }]
        : []),
      ...(patch.modelSlot !== undefined && patch.modelSlot !== before.modelSlot
        ? [{ organizationId, userId, kind: "etapas" as const, action: "modelo" as const, subject: name, subjectId: id, oldValue: slot(before.modelSlot), newValue: slot(patch.modelSlot) }]
        : []),
      ...(patch.botRule !== undefined && patch.botRule !== before.botRule
        ? [
            {
              organizationId,
              userId,
              kind: "etapas" as const,
              action: "regla" as const,
              subject: name,
              subjectId: id,
              oldValue: preview(before.botRule),
              newValue: preview(patch.botRule),
              detail: { type: "texto" as const, title: "Regla del Agente IA", before: before.botRule, after: patch.botRule },
            },
          ]
        : []),
    ]);
    await notifyStagesUpdated(tx, { organizationId, reason: "updated" });
    return stages.find((s) => s.id === id)!;
  });
}

/** Nuevo orden completo (todas las etapas de la organización, sin faltar ni sobrar). */
export async function reorderFunnelStages(organizationId: string, orderedIds: readonly string[], userId: string | null = null): Promise<FunnelStage[]> {
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const current = await listFunnelStages(organizationId, tx);
    const ids = new Set(current.map((s) => s.id));
    if (orderedIds.length !== ids.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !ids.has(id))) {
      throw new FunnelStageError("El orden no coincide con las etapas actuales; recarga e inténtalo de nuevo.");
    }
    await renumber(tx, organizationId, orderedIds);
    const stages = await assertValid(tx, organizationId);
    const oldOrder = current.map((s) => s.name).join(", ");
    const newOrder = stages.map((s) => s.name).join(", ");
    if (oldOrder !== newOrder) {
      await logChanges(tx, { organizationId, userId, kind: "etapas", action: "reordenar", oldValue: oldOrder, newValue: newOrder });
    }
    await notifyStagesUpdated(tx, { organizationId, reason: "reordered" });
    return stages;
  });
}

/** Pasa un papel (entrada, cerca de compra, venta cerrada) a otra etapa. */
export async function setFunnelStageRole(organizationId: string, id: string, role: StageRole, userId: string | null = null): Promise<FunnelStage[]> {
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const current = await listFunnelStages(organizationId, tx);
    const target = current.find((s) => s.id === id);
    if (!target) throw new FunnelStageError("Esa etapa ya no existe.");
    if (target.role === role) return current;
    if (target.role) throw new FunnelStageError(`Esa etapa ya tiene el papel "${STAGE_ROLE_LABELS[target.role]}"; cada etapa puede tener un solo papel.`);
    const previous = current.find((s) => s.role === role);
    if (previous) {
      await tx
        .update(funnelStages)
        .set({ role: null, updatedAt: new Date() })
        .where(and(eq(funnelStages.id, previous.id), eq(funnelStages.organizationId, organizationId)));
    }
    await tx
      .update(funnelStages)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(funnelStages.id, id), eq(funnelStages.organizationId, organizationId)));
    const stages = await assertValid(tx, organizationId);
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "etapas",
      action: "papel",
      subject: STAGE_ROLE_LABELS[role],
      subjectId: id,
      oldValue: previous?.name ?? null,
      newValue: target.name,
    });
    await notifyStagesUpdated(tx, { organizationId, reason: "role" });
    return stages;
  });
}

/**
 * Borra una etapa pasando sus contactos a `moveToId` en la MISMA transacción (un solo
 * UPDATE; ningún contacto se pierde: la llave foránea lo impediría). Los workflows que
 * se disparaban "al entrar" a ella quedan sin etapa. No dispara workflows por etapa ni
 * un aviso por contacto: un solo `stages.updated` con cuántos se movieron.
 */
export async function deleteFunnelStage(
  organizationId: string,
  id: string,
  moveToId: string,
  userId: string | null = null,
): Promise<{ moved: number; stages: FunnelStage[] }> {
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    const current = await listFunnelStages(organizationId, tx);
    const stage = current.find((s) => s.id === id);
    const target = current.find((s) => s.id === moveToId);
    if (!stage) throw new FunnelStageError("Esa etapa ya no existe.");
    if (!target || target.id === stage.id) throw new FunnelStageError("Elige otra etapa a la que pasar sus contactos.");
    if (stage.role) throw new FunnelStageError(`"${stage.name}" tiene el papel "${STAGE_ROLE_LABELS[stage.role]}": pásalo a otra etapa antes de borrarla.`);
    if (current.length <= MIN_STAGES) throw new FunnelStageError(`El Embudo necesita al menos ${MIN_STAGES} etapas.`);
    // Candado de la fila: un mover_etapa, un arrastre o una importación que apunte a esta
    // etapa en este instante ESPERA (su llave foránea pide un candado que choca con este)
    // y, al confirmar el borrado, falla limpio (su job o su pantalla lo reintenta). Sin
    // esto, uno que entrara entre el UPDATE de abajo y el DELETE haría fallar el borrado.
    await tx.execute(sql`select 1 from funnel_stages where id = ${stage.id} and organization_id = ${organizationId} for update`);
    const moved = await tx
      .update(contacts)
      .set({ stage: target.key, stageChangedAt: new Date(), stageChangedBy: "sistema" })
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.stage, stage.key)))
      .returning({ id: contacts.id });
    // Historial de etapas: una fila por contacto movido, con el vendedor que borró la etapa.
    await recordStageChanges(tx, {
      organizationId,
      stages: current,
      by: "sistema",
      userId,
      changes: moved.map((m) => ({ contactId: m.id, from: stage.key, to: target.key })),
    });
    await tx
      .update(workflows)
      .set({ triggerStage: null })
      .where(and(eq(workflows.organizationId, organizationId), eq(workflows.triggerStage, stage.key)));
    await tx.delete(funnelStages).where(and(eq(funnelStages.id, id), eq(funnelStages.organizationId, organizationId)));
    await renumber(
      tx,
      organizationId,
      current.filter((s) => s.id !== id).map((s) => s.id),
    );
    const stages = await assertValid(tx, organizationId);
    const n = moved.length;
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "etapas",
      action: "borrar",
      subject: stage.name,
      subjectId: stage.id,
      oldValue: stage.name,
      newValue: `Borrada · ${n === 1 ? "1 contacto pasó" : `${n} contactos pasaron`} a «${target.name}»`,
    });
    await notifyStagesUpdated(tx, { organizationId, reason: "deleted", movedContacts: moved.length, from: stage.key, to: target.key });
    return { moved: moved.length, stages };
  });
}

/** Cuántos contactos hay en cada etapa (para el pop-up de borrar). */
export async function countContactsByStage(organizationId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ stage: contacts.stage, total: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .groupBy(contacts.stage);
  return Object.fromEntries(rows.map((r) => [r.stage, Number(r.total)]));
}
