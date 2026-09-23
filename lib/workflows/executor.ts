// Ejecutor de workflows (Fase D, docs/fase-d-diseno.md §7 A4).
//
// Dos mitades:
// - `startWorkflowRun` (web o worker): decide si la corrida procede (workflow
//   habilitado, sin archivos faltantes, modo del canal para disparos no humanos,
//   "una vez por conversación"), deja la fila `workflow_runs` y encola el job.
//   Si no procede, la fila queda `skipped` con el motivo: nunca se calla.
// - `executeWorkflowRun` (worker): reclama la fila (queued → running), ejecuta
//   los pasos en orden desde `step_cursor` y avanza el cursor DESPUÉS de cada
//   paso: un reintento retoma donde quedó y nunca repite un envío al cliente.
//
// Los envíos al cliente pasan por lib/messaging/send (outbox + ventana de 24 h
// + idempotencia); los pasos internos (etapa, etiqueta, pausa del agente, aviso)
// escriben directo, siempre acotados a la organización.
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages, user, workflowRuns, workflowSteps, workflows } from "@/lib/db/schema";
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";
import { renderSnippet } from "@/lib/snippets/variables";
import { sendMediaMessage, sendTextMessage, SendRejectedError, type SendOutcome } from "@/lib/messaging/send";
import { SendFailedError, type MessagingProvider } from "@/lib/messaging/provider";
import type { ObjectStorage } from "@/lib/storage/s3";
import { enqueueWorkflowRun } from "@/lib/queue/workflows";
import { addContactTag, notifyConversation, setAgentState } from "@/lib/ai/runtime/state";
import { TAG_HANDOVER } from "@/lib/ai/runtime/tags";
import { loadAgentConfig } from "@/lib/ai/runtime/config";
import { missingMedia, stripUnresolvedVariables } from "./steps";

export type RunTrigger = "agent" | "keyword" | "command" | "stage";

export type StartRunInput = {
  organizationId: string;
  workflowId: string;
  conversationId: string;
  trigger: RunTrigger;
  /** Vendedor que lo disparó (comando / etapa manual). */
  triggeredByUserId?: string | null;
  /** Argumentos de la herramienta (agente) o del disparador; se vuelcan a las variables {{…}}. */
  payload?: Record<string, unknown> | null;
  /** Solo "Probar" del admin: ejecuta aunque el workflow esté deshabilitado. */
  allowDisabled?: boolean;
  now?: Date;
};

export type StartRunResult = { runId: string; status: "queued" | "skipped"; reason?: string };

// Motivos de `skipped` (error_code) visibles en la pestaña.
export const SKIP_DISABLED = "workflow_deshabilitado";
export const SKIP_MISSING_MEDIA = "falta_archivo";
export const SKIP_ALREADY_SENT = "ya_enviado";
export const SKIP_CHANNEL_OFF = "canal_apagado";
export const SKIP_DRAFT_MODE = "modo_borrador";
export const SKIP_NO_STEPS = "sin_pasos";
export const FAIL_WINDOW = "ventana_24h";
export const FAIL_STUCK = "atorado";

// Una corrida "running" más vieja que esto se da por atorada (el worker murió).
export const RUN_STUCK_AFTER_MS = 10 * 60_000;
// Una "queued" sin job después de esto la recoge el barrido.
export const RUN_QUEUED_GRACE_MS = 30_000;

const HUMAN_TRIGGERS = new Set<RunTrigger>(["command", "stage"]);

async function loadWorkflowWithSteps(organizationId: string, workflowId: string) {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.organizationId, organizationId)))
    .limit(1);
  if (!wf) return null;
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowId, wf.id), eq(workflowSteps.organizationId, organizationId)))
    .orderBy(workflowSteps.position);
  return { wf, steps };
}

async function insertRun(
  input: StartRunInput,
  contactId: string,
  status: "queued" | "skipped",
  reason?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = input.now ?? new Date();
  await db.insert(workflowRuns).values({
    id,
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    conversationId: input.conversationId,
    contactId,
    trigger: input.trigger,
    triggeredByUserId: input.triggeredByUserId ?? null,
    payload: input.payload ?? null,
    status,
    errorCode: reason ?? null,
    createdAt: now,
    ...(status === "skipped" ? { finishedAt: now } : {}),
  });
  return id;
}

/**
 * Decide y registra la corrida. Nunca lanza por reglas de negocio: devuelve
 * `skipped` con motivo. Lanza solo si la conversación o el workflow no son de
 * la organización (error de programación, no de negocio).
 */
export async function startWorkflowRun(input: StartRunInput): Promise<StartRunResult> {
  const loaded = await loadWorkflowWithSteps(input.organizationId, input.workflowId);
  if (!loaded) throw new Error("Workflow no encontrado en esta organización.");
  const { wf, steps } = loaded;
  const [conv] = await db
    .select({ id: conversations.id, contactId: conversations.contactId, aiAgentMode: channels.aiAgentMode })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.organizationId)))
    .limit(1);
  if (!conv) throw new Error("Conversación no encontrada en esta organización.");

  const skip = async (reason: string): Promise<StartRunResult> => ({
    runId: await insertRun(input, conv.contactId, "skipped", reason),
    status: "skipped",
    reason,
  });

  if (!wf.enabled && !(input.allowDisabled && input.trigger === "command")) return skip(SKIP_DISABLED);
  if (steps.length === 0) return skip(SKIP_NO_STEPS);
  if (missingMedia(steps.map((s) => s.payload)).length > 0) return skip(SKIP_MISSING_MEDIA);
  // Disparos NO humanos (agente, palabra clave del cliente) respetan el modo del
  // canal: apagado no toca nada; borrador no ejecuta acciones (definición 1).
  if (!HUMAN_TRIGGERS.has(input.trigger)) {
    if (conv.aiAgentMode === "off") return skip(SKIP_CHANNEL_OFF);
    if (conv.aiAgentMode === "borrador") return skip(SKIP_DRAFT_MODE);
  }
  // "No vuelvas a enviar contenido ya compartido": un comando del vendedor lo
  // repite a propósito; el agente y las palabras clave no.
  if (wf.oncePerConversation && input.trigger !== "command") {
    const [prev] = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.conversationId, conv.id),
          eq(workflowRuns.workflowId, wf.id),
          inArray(workflowRuns.status, ["queued", "running", "done"]),
        ),
      )
      .limit(1);
    if (prev) return skip(SKIP_ALREADY_SENT);
  }

  let runId: string;
  try {
    runId = await insertRun(input, conv.contactId, "queued");
  } catch (error) {
    // Carrera con otra corrida viva del mismo workflow (índice único parcial):
    // se registra como omitida, nunca se manda dos veces.
    if ((error as { code?: string }).code === "23505") return skip(SKIP_ALREADY_SENT);
    throw error;
  }
  await enqueueWorkflowRun(runId);
  return { runId, status: "queued" };
}

export type ExecutorDeps = {
  provider: MessagingProvider;
  storage: ObjectStorage | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type ExecuteOutcome = "done" | "failed" | "cancelled" | "not_claimed";

function variablesFor(run: { payload: Record<string, unknown> | null }, contact: { firstName: string; lastName: string | null }, sellerName: string | null) {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(run.payload ?? {})) {
    if (typeof v === "string" || typeof v === "number") values[k] = String(v).slice(0, 500);
  }
  // Las variables del CRM van DESPUÉS: un argumento de herramienta o un texto
  // del cliente nunca pisa el nombre del contacto ni el del vendedor.
  values.nombre = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  values.vendedor = sellerName ?? "";
  return values;
}

async function markRun(runId: string, patch: Partial<typeof workflowRuns.$inferInsert>): Promise<void> {
  await db.update(workflowRuns).set(patch).where(eq(workflowRuns.id, runId));
}

/**
 * Ejecuta una corrida en el worker. Reclama la fila de forma atómica; dos
 * jobs del mismo run no la ejecutan dos veces. Devuelve el resultado final.
 */
export async function executeWorkflowRun(runId: string, deps: ExecutorDeps): Promise<ExecuteOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const [claimed] = await db
    .update(workflowRuns)
    .set({ status: "running", startedAt: now(), attempts: sql`${workflowRuns.attempts} + 1` })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "queued")))
    .returning();
  if (!claimed) return "not_claimed";
  const run = claimed;

  const loaded = await loadWorkflowWithSteps(run.organizationId, run.workflowId);
  const [contact] = await db
    .select({ firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(eq(contacts.id, run.contactId), eq(contacts.organizationId, run.organizationId)))
    .limit(1);
  if (!loaded || !contact) {
    await markRun(runId, { status: "failed", errorCode: "no_encontrado", finishedAt: now() });
    return "failed";
  }
  const seller = run.triggeredByUserId
    ? (await db.select({ name: user.name }).from(user).where(eq(user.id, run.triggeredByUserId)).limit(1))[0]?.name ?? null
    : null;
  const values = variablesFor(run, contact, seller);
  const source = ctxSource(run);
  const sentBy = source === "crm" ? (run.triggeredByUserId ?? null) : null;
  const messageIds = [...run.messageIds];

  const fail = async (code: string, message: string): Promise<ExecuteOutcome> => {
    await markRun(runId, { status: "failed", errorCode: code, errorMessage: message.slice(0, 500), messageIds, finishedAt: now() });
    // Una corrida disparada por un humano que falla (ventana cerrada, rechazo)
    // se avisa EN EL HILO: el vendedor que arrastró la tarjeta creería que el
    // cliente ya recibió los datos y esperaría un comprobante que nunca llega.
    if (run.trigger === "command" || run.trigger === "stage") {
      await insertInternalNote(run, `No se envió "${loaded.wf.name}": ${FAIL_LABEL[code] ?? message.slice(0, 200)}.`, ctxSource(run), sentBy, now()).catch(
        (e) => console.error("[workflows] no se pudo dejar el aviso de fallo", e),
      );
    }
    return "failed";
  };

  for (let i = run.stepCursor; i < loaded.steps.length; i++) {
    const step = loaded.steps[i].payload;
    // Antes de cada paso que llega al cliente, el agente relee si sigue
    // pudiendo hablar (definición 1 / Fase B): si un vendedor respondió a la
    // mitad o apagaron el canal, lo que falta no sale.
    if (source === "ai_agent" && (step.kind === "send_text" || step.kind === "send_media")) {
      const stop = await agentMustStop(run.organizationId, run.conversationId, run.createdAt);
      if (stop) {
        await markRun(runId, { status: "cancelled", errorCode: stop, messageIds, stepCursor: i, finishedAt: now() });
        return "cancelled";
      }
    }
    try {
      const sent = await runStep(step, {
        run,
        workflowSlug: loaded.wf.slug,
        values,
        source,
        sentBy,
        deps: { ...deps, now, sleep },
      });
      if (sent) messageIds.push(sent.messageId);
    } catch (error) {
      if (error instanceof SendRejectedError && error.code === "window_closed") return fail(FAIL_WINDOW, error.message);
      if (error instanceof SendRejectedError) return fail(error.code, error.message);
      if (error instanceof SendFailedError) return fail(error.code, error.message);
      return fail("error", error instanceof Error ? error.message : String(error));
    }
    await markRun(runId, { stepCursor: i + 1, messageIds });
  }
  await markRun(runId, { status: "done", finishedAt: now(), messageIds });
  return "done";
}

// ¿Debe callarse el agente? Canal fuera de auto, agente pausado, o un humano
// escribió después de que se creó la corrida.
async function agentMustStop(organizationId: string, conversationId: string, since: Date): Promise<string | null> {
  const [row] = await db
    .select({ mode: channels.aiAgentMode, state: conversations.agentState })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!row || row.mode !== "auto") return "cambio_de_modo";
  if (row.state !== "activo") return "agente_pausado";
  const [human] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.organizationId, organizationId),
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "business_app"]),
        // Un aviso interno (system_note) no es una respuesta humana.
        sql`${messages.type} <> 'system_note'`,
        gt(messages.createdAt, since),
      ),
    )
    .limit(1);
  return human ? "respuesta_humana" : null;
}

const FAIL_LABEL: Record<string, string> = {
  [FAIL_WINDOW]: "la ventana de 24 h está cerrada; solo se puede mandar una plantilla",
  media_not_found: "el archivo ya no está en la biblioteca",
  storage_unavailable: "el almacenamiento de archivos no está disponible",
};

function ctxSource(run: { trigger: RunTrigger }): "crm" | "ai_agent" {
  return run.trigger === "agent" || run.trigger === "keyword" ? "ai_agent" : "crm";
}

// Aviso interno en el hilo: fila system_note que NUNCA va al proveedor. Sube la
// conversación en la bandeja y la marca no leída: es algo que el vendedor debe
// ver (cotejar un depósito, un envío que no salió).
async function insertInternalNote(
  run: { organizationId: string; conversationId: string },
  text: string,
  source: "crm" | "ai_agent",
  sentBy: string | null,
  at: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id,
      organizationId: run.organizationId,
      conversationId: run.conversationId,
      direction: "out",
      source,
      type: "system_note",
      body: text,
      status: "sent",
      sentByUserId: sentBy,
      sentAt: at,
    });
    await tx
      .update(conversations)
      .set({ lastMessageAt: at, unreadCount: sql`${conversations.unreadCount} + 1` })
      .where(and(eq(conversations.id, run.conversationId), eq(conversations.organizationId, run.organizationId)));
    await notifyConversation(tx, run.organizationId, run.conversationId);
  });
  return id;
}

type StepCtx = {
  run: typeof workflowRuns.$inferSelect;
  workflowSlug: string;
  values: Record<string, string>;
  source: "crm" | "ai_agent";
  sentBy: string | null;
  deps: ExecutorDeps & { now: () => Date; sleep: (ms: number) => Promise<void> };
};

async function runStep(step: WorkflowStepPayload, ctx: StepCtx): Promise<SendOutcome | null> {
  const { run, deps } = ctx;
  switch (step.kind) {
    case "send_text":
      return sendTextMessage(deps.provider, {
        organizationId: run.organizationId,
        conversationId: run.conversationId,
        text: stripUnresolvedVariables(renderSnippet(step.text, ctx.values)),
        source: ctx.source,
        sentByUserId: ctx.sentBy,
        // Solo un comando (el vendedor está viendo el chat) marca leídos.
        markRead: run.trigger === "command",
        now: deps.now(),
      });
    case "send_media": {
      if (!step.assetId) throw new SendRejectedError("media_not_found", "El paso no tiene archivo.");
      if (!deps.storage) throw new SendRejectedError("storage_unavailable", "El almacenamiento de archivos no está configurado.");
      return sendMediaMessage(deps.provider, deps.storage, {
        organizationId: run.organizationId,
        conversationId: run.conversationId,
        assetId: step.assetId,
        caption: step.caption ? stripUnresolvedVariables(renderSnippet(step.caption, ctx.values)) : null,
        source: ctx.source,
        sentByUserId: ctx.sentBy,
        markRead: run.trigger === "command",
        now: deps.now(),
      });
    }
    case "set_stage": {
      // SOLO el workflow `cambiar_etapa` toma la etapa del argumento de la
      // herramienta; en cualquier otro manda el paso (un argumento "etapa" no
      // puede mover a "compra" desde datos_bancarios).
      const fromPayload = ctx.workflowSlug === "cambiar_etapa" && typeof run.payload?.etapa === "string" ? run.payload.etapa : null;
      const stage = isStage(fromPayload) ? fromPayload : step.stage;
      await db
        .update(contacts)
        .set({ stage, stageChangedAt: deps.now() })
        .where(and(eq(contacts.id, run.contactId), eq(contacts.organizationId, run.organizationId), sql`${contacts.stage} <> ${stage}`));
      await notifyConversation(db, run.organizationId, run.conversationId);
      return null;
    }
    case "add_tag":
      await addContactTag(run.organizationId, run.contactId, renderSnippet(step.tag, ctx.values).slice(0, 40));
      return null;
    case "handover": {
      const cfg = await loadAgentConfig(run.organizationId);
      const now = deps.now();
      await setAgentState(run.organizationId, run.conversationId, "pausado_handover", {
        now,
        pausedUntil: new Date(now.getTime() + cfg.handoverReactivateHours * 3_600_000),
      });
      await addContactTag(run.organizationId, run.contactId, step.tag ?? TAG_HANDOVER);
      await notifyConversation(db, run.organizationId, run.conversationId);
      return null;
    }
    case "internal_note": {
      const id = await insertInternalNote(run, renderSnippet(step.text, ctx.values), ctx.source, ctx.sentBy, deps.now());
      return { messageId: id, status: "sent" };
    }
    case "wait":
      await deps.sleep(step.seconds * 1_000);
      return null;
  }
}

const STAGES = new Set(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]);
function isStage(v: string | null): v is "inbox" | "prospecto" | "interesado" | "cerca_compra" | "compra" {
  return v !== null && STAGES.has(v);
}

/** Barrido: corridas "queued" viejas (perdieron su job) para re-encolar. */
export async function staleQueuedRuns(now = new Date(), graceMs = RUN_QUEUED_GRACE_MS): Promise<string[]> {
  const rows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.status, "queued"), lt(workflowRuns.createdAt, new Date(now.getTime() - graceMs))))
    .limit(100);
  return rows.map((r) => r.id);
}

/** Barrido: corridas "running" atoradas (el worker murió a la mitad) → failed sin reintento. */
export async function failStuckRuns(now = new Date()): Promise<number> {
  const rows = await db
    .update(workflowRuns)
    .set({ status: "failed", errorCode: FAIL_STUCK, finishedAt: now })
    .where(and(eq(workflowRuns.status, "running"), lt(workflowRuns.startedAt, new Date(now.getTime() - RUN_STUCK_AFTER_MS))))
    .returning({ id: workflowRuns.id });
  return rows.length;
}

/** Últimas corridas de la organización (pestaña Automatización). */
export async function listRecentRuns(organizationId: string, limit = 50) {
  return db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      conversationId: workflowRuns.conversationId,
      contactId: workflowRuns.contactId,
      contactName: contacts.firstName,
      trigger: workflowRuns.trigger,
      status: workflowRuns.status,
      errorCode: workflowRuns.errorCode,
      createdAt: workflowRuns.createdAt,
      finishedAt: workflowRuns.finishedAt,
    })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .innerJoin(contacts, eq(contacts.id, workflowRuns.contactId))
    .where(eq(workflowRuns.organizationId, organizationId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(limit);
}
