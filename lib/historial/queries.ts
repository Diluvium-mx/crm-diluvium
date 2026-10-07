// Lectura de la subpestaña "Historial" (Agente IA, Bloque A 28-sep-2026). Une tres fuentes,
// siempre de UNA organización: change_history (modelos, etapas, canales, workflows, pausas y,
// desde el Bloque E, nombre del agente, tallas, mensajes rápidos, plantillas y vendedores),
// ai_config_changes (Opciones del Agente IA) y ai_knowledge_versions (Goal y FAQs). Lo más
// nuevo arriba; a lo más HISTORY_LIMIT filas (con fechas se ve más atrás). "Ver cambios"
// (Bloque E) se carga aparte, fila por fila: loadChangeDiff.
import "server-only";
import { and, desc, eq, gte, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfigChanges, aiKnowledgeVersions, changeHistory, user } from "@/lib/db/schema";
import { optionLabel } from "@/lib/agente-ia/opciones";
import { buildChangeDiff, diffFaqs, diffGoal, type ChangeDiff, type FaqDetail } from "./diff";
import {
  AUTOMATIC_ACTIONS,
  AUTOMATIC_WHO,
  describeAction,
  HISTORY_LIMIT,
  isAutomaticAction,
  MANAGER_ONLY_TYPES,
  SYSTEM_WHO,
  type ChangeKind,
  type HistoryRow,
  type HistoryType,
} from "./labels";

/** `canSeeManagerOnly`: owner/admin (ven también Vendedores). */
export type HistoryQuery = { type: HistoryType | null; start: Date | null; end: Date | null; includeAuto: boolean; canSeeManagerOnly: boolean };

function inRange(column: typeof changeHistory.createdAt | typeof aiConfigChanges.createdAt, q: HistoryQuery): SQL[] {
  return [...(q.start ? [gte(column, q.start)] : []), ...(q.end ? [lt(column, q.end)] : [])];
}

const wants = (q: HistoryQuery, type: HistoryType) => q.type === null || q.type === type;

async function fromChangeHistory(organizationId: string, q: HistoryQuery): Promise<HistoryRow[]> {
  if (q.type === "opciones" || q.type === "goal_faqs") return [];
  if (q.type && !q.canSeeManagerOnly && MANAGER_ONLY_TYPES.includes(q.type)) return [];
  const rows = await db
    .select({
      id: changeHistory.id,
      kind: changeHistory.kind,
      action: changeHistory.action,
      subject: changeHistory.subject,
      oldValue: changeHistory.oldValue,
      newValue: changeHistory.newValue,
      hasDetail: sql<boolean>`${changeHistory.detail} is not null`,
      createdAt: changeHistory.createdAt,
      // S3 (0053): el nombre de ESE momento; el actual solo si la fila no lo tiene.
      author: sql<string | null>`coalesce(${changeHistory.authorName}, ${user.name})`,
    })
    .from(changeHistory)
    .leftJoin(user, eq(user.id, changeHistory.userId))
    .where(
      and(
        eq(changeHistory.organizationId, organizationId),
        ...(q.type ? [eq(changeHistory.kind, q.type satisfies ChangeKind)] : []),
        ...(q.includeAuto ? [] : [notInArray(changeHistory.action, [...AUTOMATIC_ACTIONS])]),
        ...(q.canSeeManagerOnly ? [] : [notInArray(changeHistory.kind, [...MANAGER_ONLY_TYPES])]),
        ...inRange(changeHistory.createdAt, q),
      ),
    )
    .orderBy(desc(changeHistory.createdAt), desc(changeHistory.id))
    .limit(HISTORY_LIMIT + 1);
  return rows.map((r) => {
    const automatic = isAutomaticAction(r.action);
    return {
      id: `c:${r.id}`,
      type: r.kind as ChangeKind,
      who: r.author ?? (automatic ? AUTOMATIC_WHO : SYSTEM_WHO),
      what: describeAction(r.kind, r.action, r.subject),
      before: r.oldValue,
      after: r.newValue,
      at: r.createdAt.toISOString(),
      automatic,
      hasDetail: r.hasDetail,
    };
  });
}

async function fromBotOptions(organizationId: string, q: HistoryQuery): Promise<HistoryRow[]> {
  if (!wants(q, "opciones")) return [];
  const rows = await db
    .select({
      id: aiConfigChanges.id,
      field: aiConfigChanges.field,
      oldValue: aiConfigChanges.oldValue,
      newValue: aiConfigChanges.newValue,
      createdAt: aiConfigChanges.createdAt,
      // S3 (0053): el nombre de ESE momento; el actual solo si la fila no lo tiene.
      author: sql<string | null>`coalesce(${aiConfigChanges.authorName}, ${user.name})`,
    })
    .from(aiConfigChanges)
    .leftJoin(user, eq(user.id, aiConfigChanges.userId))
    .where(and(eq(aiConfigChanges.organizationId, organizationId), ...inRange(aiConfigChanges.createdAt, q)))
    .orderBy(desc(aiConfigChanges.createdAt), desc(aiConfigChanges.id))
    .limit(HISTORY_LIMIT + 1);
  return rows.map((r) => ({
    id: `o:${r.id}`,
    type: "opciones",
    who: r.author ?? SYSTEM_WHO,
    what: `Cambió la opción «${optionLabel(r.field)}»`,
    before: r.oldValue,
    after: r.newValue,
    at: r.createdAt.toISOString(),
    automatic: false,
    hasDetail: false,
  }));
}

// Tamaño de cada versión (palabras del Goal o número de FAQs) calculado en la base: no se
// traen las fotos completas. Antes → después = contra la versión anterior del mismo tipo,
// aunque esa quede fuera de las fechas (por eso las fechas se aplican aquí, no en SQL).
async function fromVersions(organizationId: string, q: HistoryQuery): Promise<HistoryRow[]> {
  if (!wants(q, "goal_faqs")) return [];
  const v = aiKnowledgeVersions;
  const rows = await db
    .select({
      id: v.id,
      kind: v.kind,
      name: v.name,
      createdAt: v.createdAt,
      author: sql<string | null>`coalesce(${v.authorName}, ${user.name})`,
      size: sql<number>`case
        when ${v.kind} = 'goal' then coalesce(array_length(regexp_split_to_array(nullif(btrim(coalesce(${v.snapshot}->>'goal', '')), ''), '[[:space:]]+'), 1), 0)
        when jsonb_typeof(${v.snapshot}->'faqs') = 'array' then jsonb_array_length(${v.snapshot}->'faqs')
        else 0 end`.mapWith(Number),
    })
    .from(v)
    .leftJoin(user, eq(user.id, v.createdByUserId))
    .where(eq(v.organizationId, organizationId))
    .orderBy(v.createdAt, v.id)
    .limit(5000);
  const prev = new Map<string, number>();
  const out: HistoryRow[] = [];
  for (const r of rows) {
    const before = prev.get(r.kind);
    prev.set(r.kind, r.size);
    if ((q.start && r.createdAt < q.start) || (q.end && r.createdAt >= q.end)) continue;
    const goal = r.kind === "goal";
    const unit = (n: number) => (goal ? `${n.toLocaleString("es-MX")} palabras` : n === 1 ? "1 pregunta" : `${n} preguntas`);
    const edited = before === r.size ? (goal ? " (editado)" : " (editadas)") : "";
    out.push({
      id: `v:${r.id}`,
      type: "goal_faqs",
      who: r.author ?? SYSTEM_WHO,
      // Sin autor = foto que guardó el sistema (la anterior al primer cambio, o una carga inicial).
      what: `${r.author ? (goal ? "Guardó el Goal" : "Cambió las FAQs") : goal ? "Versión del Goal guardada por el sistema" : "Versión de las FAQs guardada por el sistema"}${r.name ? ` · «${r.name}»` : ""}`,
      before: before === undefined ? null : unit(before),
      after: `${unit(r.size)}${edited}`,
      at: r.createdAt.toISOString(),
      automatic: false,
      // Contra la versión anterior del mismo tipo (la primera no tiene con qué compararse).
      hasDetail: before !== undefined,
    });
  }
  return out.reverse(); // lo más nuevo arriba, como las otras fuentes
}

export async function loadHistory(organizationId: string, q: HistoryQuery): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  const parts = await Promise.all([fromChangeHistory(organizationId, q), fromBotOptions(organizationId, q), fromVersions(organizationId, q)]);
  // Orden estable por hora (ms): dos filas del mismo milisegundo (p. ej. la versión anterior y
  // la nueva del Goal, misma transacción) conservan el orden de su fuente (ya viene de la base).
  const all = parts.flat().sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1));
  return { rows: all.slice(0, HISTORY_LIMIT), truncated: all.length > HISTORY_LIMIT };
}

// ── "Ver cambios" (Bloque E) ─────────────────────────────────────────────────
// Id de la fila: "c:<id>" (change_history) o "v:<id>" (versión del Goal o de las FAQs,
// comparada con la anterior del mismo tipo). Siempre de UNA organización; Vendedores solo
// para owner/admin. null = no existe, no es de esta organización o no tiene detalle.
export async function loadChangeDiff(organizationId: string, rowId: string, canSeeManagerOnly: boolean): Promise<ChangeDiff | null> {
  const [source, id] = [rowId.slice(0, 2), rowId.slice(2)];
  if (!id) return null;
  if (source === "c:") {
    const [row] = await db
      .select({ kind: changeHistory.kind, detail: changeHistory.detail })
      .from(changeHistory)
      .where(and(eq(changeHistory.id, id), eq(changeHistory.organizationId, organizationId)))
      .limit(1);
    if (!row?.detail) return null;
    if (!canSeeManagerOnly && (MANAGER_ONLY_TYPES as readonly string[]).includes(row.kind)) return null;
    return buildChangeDiff(row.detail);
  }
  if (source !== "v:") return null;
  const v = aiKnowledgeVersions;
  const [current] = await db
    .select({ id: v.id, kind: v.kind, snapshot: v.snapshot })
    .from(v)
    .where(and(eq(v.id, id), eq(v.organizationId, organizationId)))
    .limit(1);
  if (!current) return null;
  // La anterior del mismo tipo, con el MISMO orden que la lista (hora y luego id). La hora se
  // compara en la base (microsegundos): la versión anterior y la nueva de una misma
  // transacción pueden caer en el mismo milisegundo.
  const [previous] = await db
    .select({ snapshot: v.snapshot })
    .from(v)
    .where(
      and(
        eq(v.organizationId, organizationId),
        eq(v.kind, current.kind),
        sql`(${v.createdAt}, ${v.id}) < (select c.created_at, c.id from ai_knowledge_versions c where c.id = ${current.id} and c.organization_id = ${organizationId})`,
      ),
    )
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(1);
  if (!previous) return null;
  if (current.kind === "goal") return diffGoal(goalOf(previous.snapshot), goalOf(current.snapshot));
  return diffFaqs(faqsOf(previous.snapshot), faqsOf(current.snapshot));
}

const goalOf = (snapshot: unknown) => String((snapshot as { goal?: unknown } | null)?.goal ?? "");

function faqsOf(snapshot: unknown): FaqDetail[] {
  const list = (snapshot as { faqs?: unknown } | null)?.faqs;
  if (!Array.isArray(list)) return [];
  return list.flatMap((f) => {
    if (!f || typeof f !== "object") return [];
    const x = f as Record<string, unknown>;
    return [
      {
        question: String(x.question ?? ""),
        answer: String(x.answer ?? ""),
        position: typeof x.position === "number" ? x.position : undefined,
        enabled: typeof x.enabled === "boolean" ? x.enabled : undefined,
        ghlId: typeof x.ghlId === "string" ? x.ghlId : null,
      },
    ];
  });
}
