"use server";

// Server Actions de Automatización (Fase D). La organización sale de la SESIÓN.
// ACL `workflow`: todos los roles (vendedor incluido) crean/editan/borran, leen y EJECUTAN
// (comandos del composer). Los pasos se validan con Zod (lib/workflows/steps).
import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { isStageKey } from "@/lib/contacts/stages";
import { conversations, mediaAssets, workflowRuns, workflowSteps, workflows } from "@/lib/db/schema";
import { listRecentRuns, startWorkflowRun, type StartRunResult } from "@/lib/workflows/executor";
import { seedDefaultWorkflows } from "@/lib/workflows/seed";
import { commandSchema, keywordsSchema, maxSendsSchema, missingMedia, stepsSchema, unknownVariables, type StepPayload } from "@/lib/workflows/steps";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { findWorkflowByCommand } from "@/lib/workflows/triggers";
import { isUniqueViolation } from "@/lib/db/errors";
import { logChanges } from "@/lib/historial/log";
import { describeWorkflowEdit, workflowAssetIds, workflowDetail, workflowSummary, type WorkflowSnapshot } from "@/lib/historial/labels";
import { DEFAULT_WORKFLOWS } from "@/lib/workflows/defaults";
import { logError } from "@/lib/log/safe-error";

const idSchema = z.string().trim().min(1).max(200);

export type WorkflowView = {
  id: string;
  slug: string;
  name: string;
  agentDescription: string;
  enabled: boolean;
  isSystem: boolean;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  /** Clave de la etapa (funnel_stages.key) que lo dispara al entrar, o null. */
  triggerStage: string | null;
  /** «Solo al inicio» (lib/workflows/start-only.ts). */
  triggerStartOnly: boolean;
  /** Con «Solo al inicio»: false = solo la palabra clave (el Agente IA cuando haga falta). */
  triggerStartOnlyAgent: boolean;
  /** «Máximo de envíos por chat» (null = sin límite; lib/workflows/max-per-chat.ts). */
  maxSendsPerChat: number | null;
  /** «El workflow es la respuesta». */
  isAnswer: boolean;
  position: number;
  steps: StepPayload[];
  /** Títulos de los archivos que faltan (el workflow no se puede habilitar). */
  missingMedia: string[];
  runs7d: number;
};

export type WorkflowRunView = {
  id: string;
  workflowId: string;
  workflowName: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  trigger: "agent" | "keyword" | "command" | "stage";
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "skipped";
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

function requireWorkflow(role: string, action: "read" | "run" | "create" | "update" | "delete"): void {
  if (!roleAllows(role, "workflow", action)) throw new Error("No tienes permiso para gestionar la automatización.");
}

const workflowInputSchema = z.object({
  id: idSchema.nullable(),
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(80),
  agentDescription: z.string().trim().max(1_000),
  enabled: z.boolean(),
  triggerAgent: z.boolean(),
  triggerKeywords: keywordsSchema,
  triggerCommand: commandSchema,
  // Clave de una etapa vigente de la organización (se comprueba contra funnel_stages).
  triggerStage: z.string().trim().min(1).max(40).nullable(),
  // «Solo al inicio»: por palabra clave o por el Agente IA, solo antes de que le contesten y una vez por contacto.
  triggerStartOnly: z.boolean(),
  // Con «Solo al inicio»: ¿también el Agente IA? false = solo la palabra clave (la Tabla).
  triggerStartOnlyAgent: z.boolean(),
  // «Máximo de envíos por chat» (1–20; null = sin límite).
  maxSendsPerChat: maxSendsSchema,
  // «El workflow es la respuesta»: por palabra clave, el Agente IA no agrega nada y espera al cliente.
  isAnswer: z.boolean(),
  steps: stepsSchema,
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

async function loadViews(organizationId: string): Promise<WorkflowView[]> {
  const rows = await db.select().from(workflows).where(eq(workflows.organizationId, organizationId)).orderBy(asc(workflows.position), asc(workflows.createdAt));
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.organizationId, organizationId))
    .orderBy(asc(workflowSteps.position));
  // Archivos borrados (lógicamente) también cuentan como faltantes.
  const assetIds = steps.flatMap((s) => (s.payload.kind === "send_media" && s.payload.assetId ? [s.payload.assetId] : []));
  const alive = new Set(
    assetIds.length
      ? (
          await db
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(and(eq(mediaAssets.organizationId, organizationId), inArray(mediaAssets.id, assetIds), sql`${mediaAssets.deletedAt} is null`))
        ).map((r) => r.id)
      : [],
  );
  const since = new Date(Date.now() - 7 * 86_400_000);
  const counts = await db
    .select({ workflowId: workflowRuns.workflowId, n: sql<number>`count(*)::int` })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.organizationId, organizationId), gte(workflowRuns.createdAt, since)))
    .groupBy(workflowRuns.workflowId);
  const runsBy = new Map(counts.map((c) => [c.workflowId, c.n]));
  return rows.map((w) => {
    const own = steps
      .filter((s) => s.workflowId === w.id)
      .map((s) => {
        const p = s.payload;
        // Un archivo borrado de la biblioteca se muestra como faltante.
        return p.kind === "send_media" && p.assetId && !alive.has(p.assetId) ? { ...p, assetId: null } : p;
      });
    return {
      id: w.id,
      slug: w.slug,
      name: w.name,
      agentDescription: w.agentDescription,
      enabled: w.enabled,
      isSystem: w.isSystem,
      triggerAgent: w.triggerAgent,
      triggerKeywords: w.triggerKeywords,
      triggerCommand: w.triggerCommand,
      triggerStage: w.triggerStage,
      triggerStartOnly: w.triggerStartOnly,
      triggerStartOnlyAgent: w.triggerStartOnlyAgent,
      maxSendsPerChat: w.maxSendsPerChat,
      isAnswer: w.isAnswer,
      position: w.position,
      steps: own,
      missingMedia: missingMedia(own),
      runs7d: runsBy.get(w.id) ?? 0,
    };
  });
}

export async function listWorkflows(): Promise<WorkflowView[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "read");
  return loadViews(organizationId);
}

function slugFrom(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "workflow";
}


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Nombre de cada archivo (aunque ya esté borrado de la biblioteca), solo de esta organización. */
async function assetNames(tx: Tx, organizationId: string, ids: string[]): Promise<(assetId: string) => string | null> {
  if (ids.length === 0) return () => null;
  const rows = await tx
    .select({ id: mediaAssets.id, title: mediaAssets.title, fileName: mediaAssets.fileName })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.organizationId, organizationId), inArray(mediaAssets.id, ids)));
  const map = new Map(rows.map((r) => [r.id, r.title || r.fileName]));
  return (id) => map.get(id) ?? null;
}

/** Crea o actualiza un workflow con sus pasos (todo o nada). */
export async function saveWorkflow(raw: WorkflowInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, raw.id ? "update" : "create");
  const parsed = workflowInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  // Sin «Solo al inicio», la segunda opción no aplica: se guarda en su valor de fábrica.
  const input = { ...parsed.data, triggerStartOnlyAgent: parsed.data.triggerStartOnly ? parsed.data.triggerStartOnlyAgent : true };
  const stages = await listFunnelStages(organizationId);
  if (input.triggerStage !== null && !isStageKey(stages, input.triggerStage)) {
    return { ok: false, error: "Esa etapa ya no existe en el Embudo; elige otra." };
  }
  // Un archivo referenciado debe existir (vivo) en ESTA organización.
  const assetIds = input.steps.flatMap((s) => (s.kind === "send_media" && s.assetId ? [s.assetId] : []));
  if (assetIds.length) {
    const alive = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.organizationId, organizationId), inArray(mediaAssets.id, assetIds), sql`${mediaAssets.deletedAt} is null`));
    if (alive.length !== new Set(assetIds).size) return { ok: false, error: "Uno de los archivos ya no está en la biblioteca." };
  }
  // No se puede habilitar con archivos faltantes: mandaría un paso roto.
  if (input.enabled && missingMedia(input.steps).length > 0) {
    return { ok: false, error: "Faltan archivos en los pasos: elige el archivo de la biblioteca antes de habilitarlo." };
  }
  if (input.enabled && input.steps.length === 0) return { ok: false, error: "Un workflow habilitado necesita al menos un paso." };
  // Una variable que el ejecutor no sabe rellenar llegaría literal al cliente.
  for (const st of input.steps) {
    const text = st.kind === "send_text" ? st.text : st.kind === "send_media" ? (st.caption ?? "") : "";
    const unknown = unknownVariables(text);
    if (unknown.length) return { ok: false, error: `Variable desconocida: {{${unknown[0]}}}. Disponibles: {{nombre}}, {{vendedor}}, {{monto}}, {{banco}}, {{referencia}}, {{fecha}}, {{motivo}}.` };
  }
  const now = new Date();
  try {
    const id = await db.transaction(async (tx) => {
      let id = input.id;
      const fields = {
        name: input.name,
        agentDescription: input.agentDescription,
        enabled: input.enabled,
        triggerAgent: input.triggerAgent,
        triggerKeywords: input.triggerKeywords,
        triggerCommand: input.triggerCommand,
        triggerStage: input.triggerStage,
        triggerStartOnly: input.triggerStartOnly,
        triggerStartOnlyAgent: input.triggerStartOnlyAgent,
        maxSendsPerChat: input.maxSendsPerChat,
        isAnswer: input.isAnswer,
        updatedByUserId: userId,
        updatedAt: now,
      };
      // Historial de cambios (Bloque A): cómo estaba antes de editar, en la misma transacción.
      const stageName = (key: string | null) => (key ? (stages.find((st) => st.key === key)?.name ?? key) : null);
      const after: WorkflowSnapshot = { ...input, triggerStage: stageName(input.triggerStage), steps: input.steps };
      let before: WorkflowSnapshot | null = null;
      if (id) {
        const [old] = await tx
          .select()
          .from(workflows)
          .where(and(eq(workflows.id, id), eq(workflows.organizationId, organizationId)))
          .for("update");
        if (old) {
          const oldSteps = await tx
            .select({ payload: workflowSteps.payload })
            .from(workflowSteps)
            .where(and(eq(workflowSteps.workflowId, id), eq(workflowSteps.organizationId, organizationId)))
            .orderBy(asc(workflowSteps.position));
          before = { ...old, triggerStage: stageName(old.triggerStage), steps: oldSteps.map((r) => r.payload) };
        }
        const rows = await tx
          .update(workflows)
          .set(fields)
          .where(and(eq(workflows.id, id), eq(workflows.organizationId, organizationId)))
          .returning({ id: workflows.id });
        if (rows.length === 0) throw new Error("Workflow no encontrado en esta organización.");
        await tx.delete(workflowSteps).where(and(eq(workflowSteps.workflowId, id), eq(workflowSteps.organizationId, organizationId)));
      } else {
        id = crypto.randomUUID();
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workflows).where(eq(workflows.organizationId, organizationId));
        await tx.insert(workflows).values({
          id,
          organizationId,
          slug: `${slugFrom(input.name)}_${id.slice(0, 4)}`,
          isSystem: false,
          position: n,
          createdByUserId: userId,
          ...fields,
        });
      }
      if (input.steps.length) {
        await tx.insert(workflowSteps).values(
          input.steps.map((payload, position) => ({ id: crypto.randomUUID(), organizationId, workflowId: id!, position, kind: payload.kind, payload })),
        );
      }
      // "Ver cambios" (Bloque E): antes/después paso por paso, con el nombre de cada archivo.
      const names = await assetNames(tx, organizationId, workflowAssetIds(before?.steps ?? [], after.steps));
      if (!before) {
        await logChanges(tx, {
          organizationId,
          userId,
          kind: "workflows",
          action: "crear",
          subject: input.name,
          subjectId: id,
          newValue: workflowSummary(after),
          detail: { type: "workflow", before: null, after: workflowDetail(after, names) },
        });
      } else {
        const edit = describeWorkflowEdit(before, after);
        if (edit) {
          await logChanges(tx, {
            organizationId,
            userId,
            kind: "workflows",
            action: "editar",
            subject: input.name,
            subjectId: id,
            oldValue: edit.before,
            newValue: edit.after,
            detail: { type: "workflow", before: workflowDetail(before, names), after: workflowDetail(after, names) },
          });
        }
      }
      return id!;
    });
    revalidatePath("/automatizacion");
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Ese comando ya lo usa otro workflow." };
    logError("[workflows] no se pudo guardar", error);
    return { ok: false, error: "No se pudo guardar el workflow." };
  }
}

export async function toggleWorkflow(input: { id: string; enabled: boolean }): Promise<Result> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, "update");
  const parsed = z.object({ id: idSchema, enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  if (parsed.data.enabled) {
    const [view] = (await loadViews(organizationId)).filter((w) => w.id === parsed.data.id);
    if (!view) return { ok: false, error: "Workflow no encontrado." };
    if (view.steps.length === 0) return { ok: false, error: "Agrega al menos un paso antes de habilitarlo." };
    if (view.missingMedia.length) return { ok: false, error: `Falta el archivo: ${view.missingMedia.join(", ")}.` };
  }
  const own = and(eq(workflows.id, parsed.data.id), eq(workflows.organizationId, organizationId));
  await db.transaction(async (tx) => {
    const [old] = await tx.select({ name: workflows.name, enabled: workflows.enabled }).from(workflows).where(own).for("update");
    if (!old) return;
    await tx.update(workflows).set({ enabled: parsed.data.enabled, updatedByUserId: userId, updatedAt: new Date() }).where(own);
    if (old.enabled === parsed.data.enabled) return;
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "workflows",
      action: parsed.data.enabled ? "encender" : "apagar",
      subject: old.name,
      subjectId: parsed.data.id,
      oldValue: old.enabled ? "Encendido" : "Apagado",
      newValue: parsed.data.enabled ? "Encendido" : "Apagado",
    });
  });
  revalidatePath("/automatizacion");
  return { ok: true };
}

export async function deleteWorkflow(input: { id: string }): Promise<Result> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, "delete");
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const [wf] = await db
    .select({ isSystem: workflows.isSystem, name: workflows.name })
    .from(workflows)
    .where(and(eq(workflows.id, parsed.data.id), eq(workflows.organizationId, organizationId)))
    .limit(1);
  if (!wf) return { ok: false, error: "Workflow no encontrado." };
  if (wf.isSystem) return { ok: false, error: "Los predeterminados no se borran; deshabilítalo." };
  await db.transaction(async (tx) => {
    // Cómo estaba (con sus pasos) para "Ver cambios": se lee antes de borrar.
    const stages = await listFunnelStages(organizationId, tx);
    const steps = await tx
      .select({ payload: workflowSteps.payload })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowId, parsed.data.id), eq(workflowSteps.organizationId, organizationId)))
      .orderBy(asc(workflowSteps.position));
    const gone = await tx
      .delete(workflows)
      .where(and(eq(workflows.id, parsed.data.id), eq(workflows.organizationId, organizationId)))
      .returning();
    if (gone.length === 0) return;
    const [old] = gone;
    const before: WorkflowSnapshot = {
      ...old,
      triggerStage: old.triggerStage ? (stages.find((st) => st.key === old.triggerStage)?.name ?? old.triggerStage) : null,
      steps: steps.map((r) => r.payload),
    };
    const names = await assetNames(tx, organizationId, workflowAssetIds(before.steps));
    await logChanges(tx, {
      organizationId,
      userId,
      kind: "workflows",
      action: "borrar",
      subject: wf.name,
      subjectId: parsed.data.id,
      oldValue: wf.name,
      newValue: "Borrado",
      detail: { type: "workflow", before: workflowDetail(before, names), after: null },
    });
  });
  revalidatePath("/automatizacion");
  return { ok: true };
}

export async function reorderWorkflows(input: { ids: string[] }): Promise<Result> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "update");
  const parsed = z.object({ ids: z.array(idSchema).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  await db.transaction(async (tx) => {
    for (const [position, id] of parsed.data.ids.entries()) {
      await tx.update(workflows).set({ position }).where(and(eq(workflows.id, id), eq(workflows.organizationId, organizationId)));
    }
  });
  revalidatePath("/automatizacion");
  return { ok: true };
}

/** Vuelve a crear los predeterminados que falten (no toca los existentes). */
export async function restoreDefaultWorkflows(): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, "create");
  // Los que se vuelven a crear quedan en el historial (nacen apagados), en la misma transacción.
  const { created } = await db.transaction(async (tx) => {
    const out = await seedDefaultWorkflows(tx, organizationId);
    await logChanges(
      tx,
      out.created.map((slug) => {
        const def = DEFAULT_WORKFLOWS.find((d) => d.slug === slug);
        return {
          organizationId,
          userId,
          kind: "workflows" as const,
          action: "crear" as const,
          subject: def?.name ?? slug,
          newValue: `${workflowSummary({ enabled: false, steps: def?.steps ?? [] })} (predeterminado)`,
          detail: def
            ? { type: "workflow" as const, before: null, after: workflowDetail({ ...def, enabled: false, triggerStage: null, triggerStartOnly: false, triggerStartOnlyAgent: true, maxSendsPerChat: null, isAnswer: false }, () => null) }
            : null,
        };
      }),
    );
    return out;
  });
  revalidatePath("/automatizacion");
  return { ok: true, created: created.length };
}

export async function listWorkflowRuns(): Promise<WorkflowRunView[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "read");
  const rows = await listRecentRuns(organizationId, 100);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}

/** Comandos disponibles para el composer ("/" del vendedor). */
export async function listWorkflowCommands(): Promise<{ id: string; name: string; command: string }[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "run");
  const rows = await db
    .select({ id: workflows.id, name: workflows.name, command: workflows.triggerCommand })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.enabled, true), sql`${workflows.triggerCommand} is not null`))
    .orderBy(asc(workflows.position));
  return rows.flatMap((r) => (r.command ? [{ id: r.id, name: r.name, command: r.command }] : []));
}

/** Un workflow listo para mandarse con un toque desde el chat (botón ▶ de la versión móvil). */
export type WorkflowQuickSend = {
  id: string;
  name: string;
  command: string;
  /** Mensaje predeterminado: el primer texto del workflow o el pie del primer archivo. */
  message: string;
  /** Primer archivo que manda (miniatura en la lista), o null si solo manda texto. */
  media: { assetId: string; kind: "image" | "video" | "document"; title: string } | null;
};

/**
 * Workflows ENCENDIDOS con comando, con su mensaje predeterminado y su primer archivo,
 * para la lista ▶ Automatizaciones del chat en el celular. Tocar uno envía lo mismo que
 * escribir el comando (runWorkflowCommand).
 */
export async function listWorkflowQuickSends(): Promise<WorkflowQuickSend[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "run");
  const rows = await db
    .select({ id: workflows.id, name: workflows.name, command: workflows.triggerCommand })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.enabled, true), sql`${workflows.triggerCommand} is not null`))
    .orderBy(asc(workflows.position));
  if (rows.length === 0) return [];
  const steps = await db
    .select({ workflowId: workflowSteps.workflowId, payload: workflowSteps.payload })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.organizationId, organizationId), inArray(workflowSteps.workflowId, rows.map((r) => r.id))))
    .orderBy(asc(workflowSteps.position));
  const assetIds = steps.flatMap((s) => (s.payload.kind === "send_media" && s.payload.assetId ? [s.payload.assetId] : []));
  const assets = assetIds.length
    ? await db
        .select({ id: mediaAssets.id, kind: mediaAssets.kind, title: mediaAssets.title, fileName: mediaAssets.fileName })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.organizationId, organizationId), inArray(mediaAssets.id, assetIds), sql`${mediaAssets.deletedAt} is null`))
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return rows.flatMap((r) => {
    if (!r.command) return [];
    const own = steps.filter((s) => s.workflowId === r.id).map((s) => s.payload);
    const firstText = own.find((s) => s.kind === "send_text");
    const firstMedia = own.find((s) => s.kind === "send_media" && s.assetId && assetById.has(s.assetId));
    const asset = firstMedia && firstMedia.kind === "send_media" && firstMedia.assetId ? assetById.get(firstMedia.assetId) : undefined;
    const message =
      (firstText && firstText.kind === "send_text" ? firstText.text : "") ||
      (firstMedia && firstMedia.kind === "send_media" ? (firstMedia.caption ?? "") : "");
    return [
      {
        id: r.id,
        name: r.name,
        command: r.command,
        message,
        media: asset ? { assetId: asset.id, kind: asset.kind, title: asset.title || asset.fileName } : null,
      },
    ];
  });
}

export type RunCommandResult =
  | { ok: true; runId: string; status: "queued" | "skipped"; reason?: string; name: string }
  | { ok: false; error: string }
  | { ok: false; notCommand: true };

/** El vendedor escribió "/algo" en el chat: dispara el workflow de ese comando. */
export async function runWorkflowCommand(input: { conversationId: string; text: string }): Promise<RunCommandResult> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, "run");
  const parsed = z.object({ conversationId: idSchema, text: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const wf = await findWorkflowByCommand(organizationId, parsed.data.text);
  if (!wf) return { ok: false, notCommand: true };
  if (!wf.enabled) return { ok: false, error: `El workflow "${wf.name}" está deshabilitado.` };
  try {
    const r: StartRunResult = await startWorkflowRun({
      organizationId,
      workflowId: wf.id,
      conversationId: parsed.data.conversationId,
      trigger: "command",
      triggeredByUserId: userId,
    });
    // Regla del dueño: un comando del vendedor SÍ pausa al agente (como un envío
    // manual), de inmediato y no "de rebote" en el siguiente entrante.
    if (r.status === "queued") await pauseAgentForManualSend(organizationId, parsed.data.conversationId);
    return { ok: true, runId: r.runId, status: r.status, reason: r.reason, name: wf.name };
  } catch (error) {
    logError("[workflows] comando falló", error);
    return { ok: false, error: "No se pudo ejecutar el comando." };
  }
}

/** "Probar": ejecuta un workflow en una conversación elegida, como comando del vendedor. */
export async function runWorkflowTest(input: { workflowId: string; conversationId: string }): Promise<RunCommandResult> {
  const { organizationId, role, userId } = await requireActiveMembership();
  requireWorkflow(role, "update");
  const parsed = z.object({ workflowId: idSchema, conversationId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const [wf] = await db
    .select({ name: workflows.name })
    .from(workflows)
    .where(and(eq(workflows.id, parsed.data.workflowId), eq(workflows.organizationId, organizationId)))
    .limit(1);
  if (!wf) return { ok: false, error: "Workflow no encontrado." };
  try {
    const r = await startWorkflowRun({
      organizationId,
      workflowId: parsed.data.workflowId,
      conversationId: parsed.data.conversationId,
      trigger: "command",
      triggeredByUserId: userId,
      // Probar no obliga a habilitar (habilitarlo lo expondría a clientes reales antes de verlo).
      allowDisabled: true,
    });
    // "Probar" es un envío del vendedor: pausa al agente igual que un comando.
    if (r.status === "queued") await pauseAgentForManualSend(organizationId, parsed.data.conversationId);
    revalidatePath("/automatizacion");
    return { ok: true, runId: r.runId, status: r.status, reason: r.reason, name: wf.name };
  } catch (error) {
    logError("[workflows] prueba falló", error);
    return { ok: false, error: "No se pudo ejecutar la prueba." };
  }
}

/** Conversaciones recientes para elegir dónde "Probar" (nombre + teléfono). */
export async function listConversationsForTest(): Promise<{ id: string; label: string }[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireWorkflow(role, "update");
  const { contacts, channels } = await import("@/lib/db/schema");
  const rows = await db
    .select({ id: conversations.id, first: contacts.firstName, last: contacts.lastName, phone: contacts.phoneE164, channel: channels.displayName })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.organizationId, organizationId))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(20);
  // Manda mensajes REALES: la etiqueta lleva canal y teléfono para que el admin
  // sepa exactamente a quién le llega, y la UI no preselecciona ninguna.
  return rows.map((r) => ({ id: r.id, label: `${r.channel} · ${[r.first, r.last].filter(Boolean).join(" ")} · ${r.phone ?? "sin teléfono"}` }));
}
