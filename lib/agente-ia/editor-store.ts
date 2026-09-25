// Lecturas y escrituras del editor del agente (pestaña "Agente IA", 24-sep-2026):
// nombre del agente y de la empresa, modelo cerebro, Goal y FAQs con VERSIONES
// (cada guardado deja una foto completa y se puede regresar a cualquiera). Sin
// sesión: las Server Actions (lib/actions/agente-ia-editor.ts) resuelven la
// organización y el permiso. Toda consulta filtra por organization_id.
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, aiKnowledge, aiKnowledgeVersions, user } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL, DEFAULT_MODEL_1 } from "@/lib/ai/catalog";
import { DEFAULT_MODEL_1_STAGES, normalizeModel1Stages } from "@/lib/ai/runtime/model-by-stage";
import type { Stage } from "@/lib/contacts/stages";
import { countWords } from "./editor";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type FaqRow = { id: string; question: string; answer: string; position: number; enabled: boolean };
type FaqSnapshot = { question: string; answer: string; position: number; enabled: boolean; ghlId: string | null };
export type VersionKind = "goal" | "faqs";
export type VersionRow = { id: string; createdAt: Date; author: string | null; summary: string };

export class EditorNotFoundError extends Error {}

// La fila de ai_config existe siempre que se edita (se crea con los defaults).
async function ensureConfig(exec: Exec, organizationId: string): Promise<void> {
  await exec
    .insert(aiConfig)
    .values({ organizationId, modeloFiltro: DEFAULT_FILTER_MODEL, modeloCerebro: DEFAULT_BRAIN_MODEL })
    .onConflictDoNothing({ target: aiConfig.organizationId });
}

export async function loadEditor(organizationId: string) {
  const [cfg] = await db.select().from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).limit(1);
  const faqs = await db
    .select({ id: aiKnowledge.id, question: aiKnowledge.question, answer: aiKnowledge.answer, position: aiKnowledge.position, enabled: aiKnowledge.enabled })
    .from(aiKnowledge)
    .where(eq(aiKnowledge.organizationId, organizationId))
    .orderBy(asc(aiKnowledge.position));
  return {
    agentName: cfg?.agentName ?? "Ángela",
    companyName: cfg?.companyName ?? "",
    modeloCerebro: cfg?.modeloCerebro ?? DEFAULT_BRAIN_MODEL,
    modelo1: cfg?.modelo1 ?? DEFAULT_MODEL_1,
    etapasModelo1: cfg ? normalizeModel1Stages(cfg.etapasModelo1) : [...DEFAULT_MODEL_1_STAGES],
    goal: cfg?.goal ?? "",
    faqs,
    goalVersions: await listVersions(organizationId, "goal"),
    faqVersions: await listVersions(organizationId, "faqs"),
  };
}

export async function saveProfile(organizationId: string, input: { agentName?: string; companyName?: string }): Promise<void> {
  await ensureConfig(db, organizationId);
  await db
    .update(aiConfig)
    .set({
      ...(input.agentName !== undefined ? { agentName: input.agentName } : {}),
      ...(input.companyName !== undefined ? { companyName: input.companyName || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(aiConfig.organizationId, organizationId));
}

// Modelo 2 (Fase E) = el cerebro de siempre (modelo_cerebro).
export async function saveBrainModel(organizationId: string, modelId: string): Promise<void> {
  await ensureConfig(db, organizationId);
  await db.update(aiConfig).set({ modeloCerebro: modelId, updatedAt: new Date() }).where(eq(aiConfig.organizationId, organizationId));
}

// Modelo 1 (Fase E) y las etapas que atiende (las demás van al Modelo 2).
export async function saveModel1(organizationId: string, modelId: string): Promise<void> {
  await ensureConfig(db, organizationId);
  await db.update(aiConfig).set({ modelo1: modelId, updatedAt: new Date() }).where(eq(aiConfig.organizationId, organizationId));
}

export async function saveModel1Stages(organizationId: string, stages: readonly Stage[]): Promise<void> {
  await ensureConfig(db, organizationId);
  await db
    .update(aiConfig)
    .set({ etapasModelo1: normalizeModel1Stages(stages), updatedAt: new Date() })
    .where(eq(aiConfig.organizationId, organizationId));
}

// ── Versiones ────────────────────────────────────────────────────────────────
// clock_timestamp(): dos versiones de la MISMA transacción (la anterior y la nueva)
// quedan ordenadas; now() les daría la misma hora.
async function addVersion(exec: Exec, organizationId: string, kind: VersionKind, snapshot: Record<string, unknown>, userId: string | null) {
  await exec
    .insert(aiKnowledgeVersions)
    .values({ id: crypto.randomUUID(), organizationId, kind, snapshot, createdByUserId: userId, createdAt: sql`clock_timestamp()` });
}

async function hasVersion(exec: Exec, organizationId: string, kind: VersionKind): Promise<boolean> {
  const [row] = await exec
    .select({ id: aiKnowledgeVersions.id })
    .from(aiKnowledgeVersions)
    .where(and(eq(aiKnowledgeVersions.organizationId, organizationId), eq(aiKnowledgeVersions.kind, kind)))
    .limit(1);
  return Boolean(row);
}

export async function listVersions(organizationId: string, kind: VersionKind, limit = 20): Promise<VersionRow[]> {
  const rows = await db
    .select({ id: aiKnowledgeVersions.id, createdAt: aiKnowledgeVersions.createdAt, snapshot: aiKnowledgeVersions.snapshot, author: user.name })
    .from(aiKnowledgeVersions)
    .leftJoin(user, eq(user.id, aiKnowledgeVersions.createdByUserId))
    .where(and(eq(aiKnowledgeVersions.organizationId, organizationId), eq(aiKnowledgeVersions.kind, kind)))
    .orderBy(desc(aiKnowledgeVersions.createdAt), desc(aiKnowledgeVersions.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    author: r.author,
    summary:
      kind === "goal"
        ? `${countWords(String((r.snapshot as { goal?: unknown }).goal ?? "")).toLocaleString("es-MX")} palabras`
        : `${((r.snapshot as { faqs?: unknown[] }).faqs ?? []).length} preguntas`,
  }));
}

// ── Goal ─────────────────────────────────────────────────────────────────────
// Guarda el Goal y deja su versión. La PRIMERA vez guarda antes el Goal anterior,
// para poder regresar a él.
export async function saveGoal(organizationId: string, userId: string | null, goal: string): Promise<void> {
  await db.transaction(async (tx) => {
    await ensureConfig(tx, organizationId);
    const [cfg] = await tx.select({ goal: aiConfig.goal }).from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).for("update");
    if (cfg?.goal === goal) return;
    if (cfg?.goal && !(await hasVersion(tx, organizationId, "goal"))) {
      await addVersion(tx, organizationId, "goal", { goal: cfg.goal }, null);
    }
    await tx.update(aiConfig).set({ goal, updatedAt: new Date() }).where(eq(aiConfig.organizationId, organizationId));
    await addVersion(tx, organizationId, "goal", { goal }, userId);
  });
}

async function versionSnapshot(organizationId: string, kind: VersionKind, versionId: string) {
  const [v] = await db
    .select({ snapshot: aiKnowledgeVersions.snapshot })
    .from(aiKnowledgeVersions)
    .where(and(eq(aiKnowledgeVersions.id, versionId), eq(aiKnowledgeVersions.organizationId, organizationId), eq(aiKnowledgeVersions.kind, kind)))
    .limit(1);
  if (!v) throw new EditorNotFoundError("Esa versión no existe.");
  return v.snapshot;
}

export async function restoreGoal(organizationId: string, userId: string | null, versionId: string): Promise<void> {
  const snap = await versionSnapshot(organizationId, "goal", versionId);
  const goal = typeof snap.goal === "string" ? snap.goal : "";
  if (!goal.trim()) throw new EditorNotFoundError("Esa versión no tiene Goal.");
  await saveGoal(organizationId, userId, goal);
}

// ── FAQs ─────────────────────────────────────────────────────────────────────
async function faqSnapshot(exec: Exec, organizationId: string): Promise<FaqSnapshot[]> {
  return exec
    .select({ question: aiKnowledge.question, answer: aiKnowledge.answer, position: aiKnowledge.position, enabled: aiKnowledge.enabled, ghlId: aiKnowledge.ghlId })
    .from(aiKnowledge)
    .where(eq(aiKnowledge.organizationId, organizationId))
    .orderBy(asc(aiKnowledge.position));
}

// Aplica un cambio a las FAQs dejando versión (la primera vez, también la anterior).
// Candado por organización: dos cambios a la vez no se pisan las versiones.
async function changeFaqs(organizationId: string, userId: string | null, change: (tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai_knowledge:${organizationId}`}))`);
    if (!(await hasVersion(tx, organizationId, "faqs"))) {
      const before = await faqSnapshot(tx, organizationId);
      if (before.length > 0) await addVersion(tx, organizationId, "faqs", { faqs: before }, null);
    }
    await change(tx);
    await addVersion(tx, organizationId, "faqs", { faqs: await faqSnapshot(tx, organizationId) }, userId);
  });
}

export async function createFaq(organizationId: string, userId: string | null, input: { question: string; answer: string; enabled: boolean }): Promise<void> {
  await changeFaqs(organizationId, userId, async (tx) => {
    const [{ value }] = await tx.select({ value: max(aiKnowledge.position) }).from(aiKnowledge).where(eq(aiKnowledge.organizationId, organizationId));
    await tx.insert(aiKnowledge).values({
      id: crypto.randomUUID(),
      organizationId,
      question: input.question,
      answer: input.answer,
      enabled: input.enabled,
      position: (value ?? 0) + 1,
    });
  });
}

export async function updateFaq(
  organizationId: string,
  userId: string | null,
  faqId: string,
  input: { question: string; answer: string; enabled: boolean },
): Promise<void> {
  await changeFaqs(organizationId, userId, async (tx) => {
    const rows = await tx
      .update(aiKnowledge)
      .set({ question: input.question, answer: input.answer, enabled: input.enabled, updatedAt: new Date() })
      .where(and(eq(aiKnowledge.id, faqId), eq(aiKnowledge.organizationId, organizationId)))
      .returning({ id: aiKnowledge.id });
    if (rows.length === 0) throw new EditorNotFoundError("Esa pregunta ya no existe.");
  });
}

export async function deleteFaq(organizationId: string, userId: string | null, faqId: string): Promise<void> {
  await changeFaqs(organizationId, userId, async (tx) => {
    const rows = await tx
      .delete(aiKnowledge)
      .where(and(eq(aiKnowledge.id, faqId), eq(aiKnowledge.organizationId, organizationId)))
      .returning({ id: aiKnowledge.id });
    if (rows.length === 0) throw new EditorNotFoundError("Esa pregunta ya no existe.");
  });
}

// Regresa las FAQs a una versión: reemplaza todas (conservando el ancla de GHL).
export async function restoreFaqs(organizationId: string, userId: string | null, versionId: string): Promise<void> {
  const snap = await versionSnapshot(organizationId, "faqs", versionId);
  const faqs = Array.isArray(snap.faqs) ? (snap.faqs as FaqSnapshot[]) : [];
  await changeFaqs(organizationId, userId, async (tx) => {
    await tx.delete(aiKnowledge).where(eq(aiKnowledge.organizationId, organizationId));
    if (faqs.length === 0) return;
    await tx.insert(aiKnowledge).values(
      faqs.map((f, i) => ({
        id: crypto.randomUUID(),
        organizationId,
        ghlId: f.ghlId ?? null,
        question: String(f.question),
        answer: String(f.answer),
        position: Number.isFinite(f.position) ? f.position : i + 1,
        enabled: f.enabled !== false,
      })),
    );
  });
}
