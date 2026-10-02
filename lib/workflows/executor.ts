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
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages, user, workflowRuns, workflowSteps, workflows } from "@/lib/db/schema";
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";
import { renderSnippet } from "@/lib/snippets/variables";
import { sendMediaMessage, sendTextMessage, SendRejectedError, type SendOutcome } from "@/lib/messaging/send";
import { SendFailedError, type MessagingProvider } from "@/lib/messaging/provider";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import type { ObjectStorage } from "@/lib/storage/s3";
import { enqueueWorkflowRun } from "@/lib/queue/workflows";
import { notifyConversation } from "@/lib/ai/runtime/state";
import { addNotice } from "@/lib/ai/runtime/notices";
import { outboundTextsSinceLastInbound } from "@/lib/ai/runtime/context";
import { markAnswersOnly, markAnswersUntil } from "@/lib/ai/runtime/saved-reply";
import { splitRepeated } from "@/lib/messaging/repeat";
import { moveStageForward } from "@/lib/contacts/stage";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { roleKey } from "@/lib/contacts/stages";
import { AGENT_CAPTION_KEY, agentCaptionIndex, agentCaptionOf, lastSendIndex, missingMedia, startOnlyApplies, stripUnresolvedVariables, waitMs } from "./steps";
import { startOnlyBlock, type StartOnlyBlock } from "./start-only";
import { atMaxPerChat, maxPerChatApplies } from "./max-per-chat";
import { SLUG_DATOS_BANCARIOS } from "./defaults";

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
  /** Agente: entrante que originó la corrida (idempotencia entre reintentos del job). */
  triggerMessageId?: string | null;
  now?: Date;
};

export type StartRunResult = { runId: string; status: "queued" | "skipped"; reason?: string };

// Motivos de `skipped` (error_code) visibles en la pestaña.
export const SKIP_DISABLED = "workflow_deshabilitado";
export const SKIP_MISSING_MEDIA = "falta_archivo";
export const SKIP_CHANNEL_OFF = "canal_apagado";
export const SKIP_NO_STEPS = "sin_pasos";
// Por palabra clave, un workflow se manda UNA vez por contacto (como GHL). También un
// workflow «solo al inicio» que ya le salió al contacto por cualquier camino.
export const SKIP_ALREADY_SENT = "ya_enviado_a_este_contacto";
// «Solo al inicio»: el Agente IA (con texto propio) o un vendedor ya le contestaron.
export const SKIP_NOT_START = "ya_no_es_el_inicio";
// «Solo al inicio» (30-sep-2026): a este cliente ya le salió otra respuesta de inicio.
export const SKIP_OTHER_START = "ya_salio_otra_de_inicio";
// «Máximo de envíos por chat» (29-sep-2026): ya salió las veces que permite este chat.
export const SKIP_MAX_PER_CHAT = "maximo_por_chat";
const START_ONLY_SKIP: Record<StartOnlyBlock, string> = { ya_enviado: SKIP_ALREADY_SENT, no_inicio: SKIP_NOT_START, otra_de_inicio: SKIP_OTHER_START };
export const FAIL_WINDOW = "ventana_24h";
export const FAIL_STUCK = "atorado";
// Vive en defaults.ts (puro): el runtime del agente también la usa para decidir qué modelo contesta.
export { SLUG_DATOS_BANCARIOS };

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
  const rows = await db
    .insert(workflowRuns)
    .values({
      id,
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      conversationId: input.conversationId,
      contactId,
      trigger: input.trigger,
      triggeredByUserId: input.triggeredByUserId ?? null,
      // Agente y palabra clave: el entrante que la originó (idempotencia entre reintentos y barridos).
      triggerMessageId: input.trigger === "agent" || input.trigger === "keyword" ? (input.triggerMessageId ?? null) : null,
      payload: input.payload ?? null,
      status,
      errorCode: reason ?? null,
      createdAt: now,
      ...(status === "skipped" ? { finishedAt: now } : {}),
    })
    // Reintento del job del agente (o nueva evaluación de la palabra clave) para el mismo
    // entrante: la corrida ya existe. Agente: una por workflow y mensaje; palabra clave: una por mensaje.
    .onConflictDoNothing()
    .returning({ id: workflowRuns.id });
  if (rows.length) return id;
  const [existing] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        input.trigger === "keyword" ? undefined : eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.trigger, input.trigger === "keyword" ? "keyword" : "agent"),
        eq(workflowRuns.triggerMessageId, input.triggerMessageId ?? ""),
      ),
    )
    .limit(1);
  return existing?.id ?? id;
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
    .select({ id: conversations.id, contactId: conversations.contactId, aiAgentMode: channels.aiAgentMode, keywordSent: contacts.keywordWorkflowsSent })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
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
  // Disparos NO humanos (agente, palabra clave del cliente) solo con el canal en
  // AUTO: cualquier otro valor cuenta como apagado (el modo "borrador" ya no
  // existe en el negocio). Los comandos del vendedor y la etapa manual siempre.
  if (!HUMAN_TRIGGERS.has(input.trigger) && conv.aiAgentMode !== "auto") return skip(SKIP_CHANNEL_OFF);
  // Palabra clave: una sola vez por contacto (marca invisible, como GHL).
  if (input.trigger === "keyword" && conv.keywordSent.includes(input.workflowId)) return skip(SKIP_ALREADY_SENT);
  // «Solo al inicio»: por palabra clave (y, en la regla estricta, por el Agente IA), solo
  // mientras nadie le ha contestado y una sola vez por contacto (lib/workflows/start-only.ts).
  if (startOnlyApplies(wf, input.trigger)) {
    const block = await startOnlyBlock({ organizationId: input.organizationId, conversationId: input.conversationId, contactId: conv.contactId, workflowId: input.workflowId });
    if (block) return skip(START_ONLY_SKIP[block]);
  }
  // «Máximo de envíos por chat»: la palabra clave y el Agente IA no lo pasan (el comando del
  // vendedor sí: lo decide él). Cuenta también lo que va en camino.
  if (maxPerChatApplies(input.trigger) && (await atMaxPerChat(input.organizationId, input.conversationId, wf, { includeLive: true }))) {
    return skip(SKIP_MAX_PER_CHAT);
  }
  const runId = await insertRun(input, conv.contactId, "queued");
  await enqueueWorkflowRun(runId);
  return { runId, status: "queued" };
}

export type ExecutorDeps = {
  provider: MessagingProvider;
  storage: ObjectStorage | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

// "busy": otra corrida de la MISMA conversación está en curso; el job se
// reintenta (los mensajes de dos corridas no deben intercalarse al cliente).
export type ExecuteOutcome = "done" | "failed" | "cancelled" | "not_claimed" | "busy";

// Una corrida "running" cuyo worker no avanzó en este tiempo se puede
// reclamar de nuevo y retomar por cursor (reinicio del worker a la mitad).
export const RUN_LEASE_MS = 2 * 60_000;
export const RUN_MAX_ATTEMPTS = 3;
export const FAIL_UNCONFIRMED = "envio_sin_confirmar";

function variablesFor(run: { payload: Record<string, unknown> | null }, contact: { firstName: string; lastName: string | null }, sellerName: string | null) {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(run.payload ?? {})) {
    if (k === AGENT_CAPTION_KEY) continue;
    if (typeof v === "string" || typeof v === "number") values[k] = String(v).slice(0, 500);
  }
  // Las variables del CRM van DESPUÉS: un argumento de herramienta o un texto
  // del cliente nunca pisa el nombre del contacto ni el del vendedor.
  values.nombre = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  values.vendedor = sellerName ?? "";
  return values;
}

// El último mensaje que la corrida SÍ mandó (no fallido). Los ids se anotan en la corrida antes de
// mandar: un paso que el candado anti-repetición quitó tiene id pero no fila en `messages`.
async function lastSentMessageOf(organizationId: string, messageIds: readonly string[]): Promise<string | null> {
  if (messageIds.length === 0) return null;
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), inArray(messages.id, [...messageIds]), eq(messages.direction, "out"), sql`${messages.status} <> 'failed'`))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.id ?? null;
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

  const leaseCut = new Date(now().getTime() - RUN_LEASE_MS);
  // Reclamo atómico: "queued", o "running" con lease vencido (retoma por cursor).
  // Exclusividad por conversación: si otra corrida viva de la misma
  // conversación está en curso, no se reclama (busy → reintento).
  // Candado consultivo por conversación dentro de la transacción del reclamo:
  // en READ COMMITTED dos UPDATEs concurrentes de corridas distintas de la misma
  // conversación se verían mutuamente como "queued" y ambos reclamarían (los
  // mensajes de A y B se intercalarían al cliente). Con el candado, el segundo
  // espera a que el primero confirme y entonces sí ve la corrida "running".
  const [claimed] = await db.transaction(async (tx) => {
    const [target] = await tx.select({ conversationId: workflowRuns.conversationId }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!target) return [];
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${target.conversationId}))`);
    return tx
      .update(workflowRuns)
      .set({ status: "running", startedAt: now(), attempts: sql`${workflowRuns.attempts} + 1` })
      .where(
        and(
          eq(workflowRuns.id, runId),
          or(eq(workflowRuns.status, "queued"), and(eq(workflowRuns.status, "running"), lt(workflowRuns.startedAt, leaseCut))),
          sql`not exists (select 1 from workflow_runs r2 where r2.conversation_id = ${workflowRuns.conversationId} and r2.id <> ${runId} and r2.status = 'running' and r2.started_at > ${leaseCut.toISOString()}::timestamp)`,
        ),
      )
      .returning();
  });
  if (!claimed) {
    const [row] = await db.select({ status: workflowRuns.status, startedAt: workflowRuns.startedAt }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (row && (row.status === "queued" || (row.status === "running" && row.startedAt && row.startedAt < leaseCut))) return "busy";
    return "not_claimed";
  }
  const run = claimed;
  if (run.attempts > RUN_MAX_ATTEMPTS) {
    await markRun(runId, { status: "failed", errorCode: FAIL_STUCK, errorMessage: "reintentos agotados", finishedAt: now() });
    return "failed";
  }

  const loaded = await loadWorkflowWithSteps(run.organizationId, run.workflowId);
  const [contact] = await db
    .select({ firstName: contacts.firstName, lastName: contacts.lastName, keywordSent: contacts.keywordWorkflowsSent })
    .from(contacts)
    .where(and(eq(contacts.id, run.contactId), eq(contacts.organizationId, run.organizationId)))
    .limit(1);
  if (!loaded || !contact) {
    await markRun(runId, { status: "failed", errorCode: "no_encontrado", finishedAt: now() });
    return "failed";
  }
  // Texto del Agente IA que va como pie del primer archivo (run.ts, 1-oct-2026). Si la corrida ya
  // no sale al arrancar, ese texto sale SOLO: el cliente no se queda sin la respuesta (en el peor
  // caso queda como antes del cambio: la frase sin el archivo).
  const agentCaption = run.trigger === "agent" ? agentCaptionOf(run.payload) : null;
  // Paso del archivo que lleva el pie; las esperas antes de él no corren. Si alguien cambió el
  // workflow mientras la corrida esperaba (ahora trae textos), el texto sale solo antes del 1er paso.
  const captionIndex = agentCaption !== null ? agentCaptionIndex(loaded.steps.map((st) => st.payload)) : -1;
  const captionFits = captionIndex >= 0;
  // ¿El texto del agente todavía no ha salido? (un reintento retoma por cursor)
  const captionPending = agentCaption !== null && run.stepCursor <= Math.max(captionIndex, 0);
  const skipAtClaim = async (code: string): Promise<ExecuteOutcome> => {
    if (agentCaption && captionPending) await sendAgentCaptionAlone(run, agentCaption, deps.provider, now());
    await markRun(runId, { status: "skipped", errorCode: code, finishedAt: now() });
    return "cancelled";
  };
  // Se revalida al reclamar: si el admin deshabilitó el workflow (o borró un
  // archivo) mientras la corrida esperaba en cola, no se ejecuta. Un comando
  // del vendedor ("Probar") es una acción explícita y no exige "habilitado".
  if (run.trigger !== "command" && !loaded.wf.enabled) return skipAtClaim(SKIP_DISABLED);
  if (missingMedia(loaded.steps.map((st) => st.payload)).length > 0) return skipAtClaim(SKIP_MISSING_MEDIA);
  // Dos mensajes seguidos con la misma palabra clave encolan dos corridas; la
  // segunda encuentra la marca al reclamar y no repite.
  if (run.trigger === "keyword" && run.stepCursor === 0 && contact.keywordSent.includes(run.workflowId)) {
    await markRun(runId, { status: "skipped", errorCode: SKIP_ALREADY_SENT, finishedAt: now() });
    return "cancelled";
  }
  // «Solo al inicio», otra vez al arrancar: dos corridas del mismo workflow (palabra clave y
  // Agente IA) o una respuesta que salió mientras esperaba en cola. Gana la primera que arrancó.
  if (run.stepCursor === 0 && startOnlyApplies(loaded.wf, run.trigger)) {
    const block = await startOnlyBlock({
      organizationId: run.organizationId,
      conversationId: run.conversationId,
      contactId: run.contactId,
      workflowId: run.workflowId,
      exceptRunId: run.id,
      includeQueued: false,
    });
    if (block) return skipAtClaim(START_ONLY_SKIP[block]);
  }
  // «Máximo de envíos por chat», otra vez al arrancar: otra corrida con la misma foto (p. ej.
  // «Precio 2» y la Tabla en la misma ráfaga) ya la mandó mientras esta esperaba.
  if (run.stepCursor === 0 && maxPerChatApplies(run.trigger) && (await atMaxPerChat(run.organizationId, run.conversationId, loaded.wf, { exceptRunId: run.id }))) {
    return skipAtClaim(SKIP_MAX_PER_CHAT);
  }
  const seller = run.triggeredByUserId
    ? (await db.select({ name: user.name }).from(user).where(eq(user.id, run.triggeredByUserId)).limit(1))[0]?.name ?? null
    : null;
  const values = variablesFor(run, contact, seller);
  const source = ctxSource(run);
  const sentBy = source === "crm" ? (run.triggeredByUserId ?? null) : null;
  const messageIds = [...run.messageIds];
  // «El workflow es la respuesta»: el último mensaje que le llega al cliente es el que contesta.
  const answerIndex = loaded.wf.isAnswer ? lastSendIndex(loaded.steps.map((st) => st.payload)) : -1;
  // Paso en curso (el aviso de un fallo en el primer archivo lleva el texto del Agente IA que no salió).
  let stepAt = run.stepCursor;

  const fail = async (code: string, message: string): Promise<ExecuteOutcome> => {
    await markRun(runId, { status: "failed", errorCode: code, errorMessage: message.slice(0, 500), messageIds, finishedAt: now() });
    // Una corrida disparada por un humano que falla (ventana cerrada, rechazo)
    // se avisa EN EL HILO: el vendedor que arrastró la tarjeta creería que el
    // cliente ya recibió los datos y esperaría un comprobante que nunca llega.
    if (run.trigger === "command" || run.trigger === "stage") {
      await insertInternalNote(run, `No se envió "${loaded.wf.name}": ${FAIL_LABEL[code] ?? message.slice(0, 200)}.`, ctxSource(run), sentBy, now()).catch(
        (e) => console.error("[workflows] no se pudo dejar el aviso de fallo", e),
      );
    } else {
      // Del agente o por palabra clave: el cliente esperaba un archivo que no llegó;
      // el vendedor lo ve como aviso 🤖 (idempotente por corrida).
      await addNotice({
        organizationId: run.organizationId,
        conversationId: run.conversationId,
        messageId: run.triggerMessageId,
        kind: "envio",
        body:
          `No se envió "${loaded.wf.name}" (${FAIL_LABEL[code] ?? message.slice(0, 200)}). El cliente lo estaba esperando: revisa el hilo.` +
          (captionFits && stepAt <= captionIndex ? ` Iba con el texto del Agente IA: «${agentCaption}».` : ""),
      });
    }
    return "failed";
  };

  for (let i = run.stepCursor; i < loaded.steps.length; i++) {
    const step = loaded.steps[i].payload;
    stepAt = i;
    // Antes de CADA paso (también etapa/etiqueta/pausa), el agente relee si
    // sigue pudiendo actuar (definición 1 / Fase B): si un vendedor respondió a
    // la mitad o apagaron el canal, lo que falta no se ejecuta ("apagado no
    // toca nada").
    if (isAgentTrigger(run)) {
      const stop = await agentMustStop(run.organizationId, run.conversationId, run.createdAt);
      if (stop) {
        await markRun(runId, { status: "cancelled", errorCode: stop, messageIds, stepCursor: i, finishedAt: now() });
        return "cancelled";
      }
    }
    try {
      // El id del mensaje es determinista: se anota en la corrida ANTES de mandar,
      // así el runtime del agente (que excluye los mensajes de corridas keyword/
      // agent al calcular pendientes) nunca ve la fila sin su marca.
      if (step.kind === "send_text" || step.kind === "send_media") {
        const preId = stepMessageId(run.id, i);
        if (!messageIds.includes(preId)) {
          messageIds.push(preId);
          await markRun(runId, { messageIds });
        }
      }
      if (i === 0 && agentCaption && !captionFits) await sendAgentCaptionAlone(run, agentCaption, deps.provider, now());
      const withCaption = captionFits && i === captionIndex;
      // Con el texto del Agente IA como pie, una espera ANTES del archivo no corre: era para que el
      // cliente leyera primero ese texto, que ahora va con el archivo (steps.ts, agentCaptionIndex).
      const sent = captionFits && i < captionIndex && step.kind === "wait" ? null : await runStep(step, {
        run,
        workflowSlug: loaded.wf.slug,
        stepIndex: i,
        values,
        source,
        sentBy,
        agentCaption: withCaption ? agentCaption : null,
        deps: { ...deps, now, sleep },
      });
      if (sent && !messageIds.includes(sent.messageId)) messageIds.push(sent.messageId);
      // El archivo con el texto del Agente IA ES su respuesta: contesta hasta el último mensaje que
      // el agente leyó (sin la marca sería "relleno" de un workflow y lo leído seguiría pendiente).
      if (withCaption && sent && run.triggerMessageId) {
        await markAnswersUntil(run.organizationId, sent.messageId, run.triggerMessageId).catch((error: unknown) =>
          console.error(`[workflows] ${run.id}: no se pudo marcar el archivo con el texto del Agente IA como su respuesta`, error),
        );
      }
      // «El workflow es la respuesta» (29-sep-2026; antes, 28-sep, solo si terminaba en
      // pregunta): su último mensaje contesta al cliente. Se marca aunque WhatsApp no haya
      // confirmado: si al final falla, la fila queda "failed" y deja de contar. Si la marca no se
      // guarda, el agente contesta como antes (y el candado anti-repetición sigue).
      // - Palabra clave: contesta SOLO el mensaje que lo disparó (bug de la ráfaga, 29-sep: con la
      //   hora del disparador cerraba también lo anterior, p. ej. "¿Cuánto tarda el envío?" +
      //   "Precio"); lo demás lo atiende el agente.
      // - Agente IA con un workflow que trae textos (su propio texto no salió, run.ts): contesta
      //   todo lo que el agente leyó, hasta el último mensaje del lote.
      // 30-sep-2026 (bug, caso 12:31 «Quiero más información» + «Hola costos»): el último paso puede
      // NO salir porque el candado anti-repetición lo quita (la misma pregunta ya la mandó otro
      // workflow de la ráfaga). Antes la marca dependía de ese paso y se perdía: el mensaje quedaba
      // sin contestar y el Agente IA preguntaba encima. Ahora contesta el último mensaje que esta
      // corrida SÍ mandó (si no mandó nada, no hay marca y lo atiende el agente).
      if (run.triggerMessageId && i === answerIndex) {
        const answerId = sent?.messageId ?? (await lastSentMessageOf(run.organizationId, messageIds));
        const mark = !answerId
          ? null
          : run.trigger === "keyword"
            ? markAnswersOnly(run.organizationId, answerId, run.triggerMessageId)
            : run.trigger === "agent" && loaded.steps.some((st) => st.payload.kind === "send_text")
              ? markAnswersUntil(run.organizationId, answerId, run.triggerMessageId)
              : null;
        await mark?.catch((error: unknown) => console.error(`[workflows] ${run.id}: no se pudo marcar el último mensaje como la respuesta`, error));
      }
      // Resultado DESCONOCIDO del proveedor (timeout): no se sabe si el cliente
      // recibió el archivo. No se avanza (moverlo a "Cerca de compra" sin la
      // CLABE sería mentir): la corrida queda fallida con motivo y el mensaje se
      // reconcilia solo (send_unconfirmed) como cualquier envío manual.
      if (sent?.status === "pending") {
        await markRun(runId, { messageIds, stepCursor: i + 1 });
        return fail(FAIL_UNCONFIRMED, "el proveedor no confirmó el envío; se verifica en unos minutos");
      }
    } catch (error) {
      if (error instanceof SendRejectedError && error.code === "window_closed") return fail(FAIL_WINDOW, error.message);
      if (error instanceof SendRejectedError) return fail(error.code, error.message);
      // Motivo del proveedor en palabras simples (tarjeta del vendedor; Bloque B).
      if (error instanceof SendFailedError) return fail(error.code, plainSendReason(error.code, error.message));
      return fail("error", error instanceof Error ? error.message : String(error));
    }
    // Avanza el cursor y RENUEVA el lease: una corrida larga (esperas + envíos
    // lentos) que siga viva no debe poder ser reclamada por otro worker.
    await markRun(runId, { stepCursor: i + 1, messageIds, startedAt: now() });
  }
  await markRun(runId, { status: "done", finishedAt: now(), messageIds });
  // Regla interna del CRM (24-sep-2026): recibir los datos bancarios deja al
  // contacto en la etapa con papel "Cerca de compra" (sea cual sea su nombre u orden
  // hoy; solo hacia adelante; la etapa de un vendedor no se regresa). No es un paso
  // del workflow: vive aquí, sea cual sea el disparador.
  if (loaded.wf.slug === SLUG_DATOS_BANCARIOS) {
    // Sin disparar workflows por etapa (evita "datos bancarios → cerca_compra → datos bancarios otra vez").
    // actorUserId: quien escribió /banco (el aviso en vivo no le sale a él).
    await (async () => {
      const stages = await listFunnelStages(run.organizationId);
      const to = roleKey(stages, "cerca_compra");
      if (!to) return;
      await moveStageForward({ organizationId: run.organizationId, contactId: run.contactId, to, by: run.trigger === "agent" ? "agente" : "sistema", now: now(), since: run.createdAt, stages, fireStageTriggers: false, actorUserId: run.triggeredByUserId });
    })().catch((error) => console.error(`[workflows] no se pudo mover a "Cerca de compra" tras ${loaded.wf.slug}`, error));
    await notifyConversation(db, run.organizationId, run.conversationId).catch(() => undefined);
  }
  if (run.trigger === "keyword") {
    await db
      .update(contacts)
      .set({
        keywordWorkflowsSent: sql`case when ${run.workflowId} = any(${contacts.keywordWorkflowsSent}) then ${contacts.keywordWorkflowsSent} else array_append(${contacts.keywordWorkflowsSent}, ${run.workflowId}) end`,
      })
      .where(and(eq(contacts.id, run.contactId), eq(contacts.organizationId, run.organizationId)));
  }
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
  [FAIL_UNCONFIRMED]: "WhatsApp no confirmó el envío; revisa el hilo antes de repetirlo",
  media_not_found: "el archivo ya no está en la biblioteca",
  storage_unavailable: "el almacenamiento de archivos no está disponible",
};

// Regla del dueño (24-sep-2026): lo que manda un workflow cuenta como del AGENTE
// (no pausa al agente, no apaga el semáforo ni cuenta como primera respuesta
// humana); la única excepción es el comando del vendedor, que sí es suyo.
function ctxSource(run: { trigger: RunTrigger }): "crm" | "ai_agent" {
  return run.trigger === "command" ? "crm" : "ai_agent";
}

// ¿La corrida la disparó el agente o el cliente (no un humano del CRM)? Solo
// estas releen el estado del agente antes de cada paso; una etapa arrastrada o
// un comando corren siempre.
function isAgentTrigger(run: { trigger: RunTrigger }): boolean {
  return run.trigger === "agent" || run.trigger === "keyword";
}

// Aviso interno en el hilo: fila system_note que NUNCA va al proveedor. Sube la
// conversación en la bandeja y la marca no leída: es algo que el vendedor debe
// ver (cotejar un depósito, un envío que no salió).
async function insertInternalNote(
  run: { organizationId: string; conversationId: string; trigger?: RunTrigger },
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
      // Un comando del vendedor: él está viendo el chat, no se le marca no leído.
      .set({ lastMessageAt: at, ...(run.trigger === "command" ? {} : { unreadCount: sql`${conversations.unreadCount} + 1` }) })
      .where(and(eq(conversations.id, run.conversationId), eq(conversations.organizationId, run.organizationId)));
    await notifyConversation(tx, run.organizationId, run.conversationId);
  });
  return id;
}

type StepCtx = {
  run: typeof workflowRuns.$inferSelect;
  workflowSlug: string;
  stepIndex: number;
  values: Record<string, string>;
  source: "crm" | "ai_agent";
  sentBy: string | null;
  /** Texto del Agente IA que va como pie de este archivo, en lugar del pie del workflow. */
  agentCaption?: string | null;
  deps: ExecutorDeps & { now: () => Date; sleep: (ms: number) => Promise<void> };
};

// Id DETERMINISTA del mensaje de un paso: uuid v5-like de (corrida, paso). Si
// el worker muere entre el 2xx del proveedor y el avance del cursor, el
// reintento encuentra la fila ya creada y NO vuelve a mandar la imagen.
export function stepMessageId(runId: string, stepIndex: number): string {
  const h = createHash("sha256").update(`workflow-step:${runId}:${stepIndex}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function alreadySent(organizationId: string, messageId: string): Promise<SendOutcome | null> {
  const [row] = await db
    .select({ status: messages.status, errorCode: messages.errorCode, errorMessage: messages.errorMessage })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  // Al retomar solo cuenta como enviado lo que WhatsApp confirmó (enviado,
  // entregado o leído; Bloque B). Un fallido detiene la corrida con su motivo:
  // la etapa NO pasa a "Cerca de compra" sin que el cliente tenga la CLABE.
  if (row.status === "failed") {
    throw new SendFailedError(row.errorCode ?? "failed", row.errorMessage ?? "WhatsApp no lo entregó", "rejected");
  }
  // "queued" = el envío anterior quedó sin confirmar; lo concilia el outbox, no se reenvía.
  return { messageId, status: row.status === "queued" ? "pending" : "sent" };
}

// El texto del Agente IA que iba como pie sale SOLO (la corrida ya no salía, o al workflow le
// agregaron textos). Id determinista: un reintento no lo repite. Si el agente ya no puede
// actuar (un vendedor contestó, lo pausaron) no sale; si el envío falla, aviso 🤖 con el texto.
async function sendAgentCaptionAlone(run: typeof workflowRuns.$inferSelect, text: string, provider: MessagingProvider, now: Date): Promise<void> {
  if (await agentMustStop(run.organizationId, run.conversationId, run.createdAt)) return;
  const messageId = stepMessageId(run.id, -1);
  try {
    if (!(await alreadySent(run.organizationId, messageId))) {
      await sendTextMessage(provider, { organizationId: run.organizationId, conversationId: run.conversationId, text, source: "ai_agent", sentByUserId: null, markRead: false, messageId, now });
    }
  } catch (error) {
    const reason = error instanceof SendFailedError ? plainSendReason(error.code, error.message) : error instanceof Error ? error.message : String(error);
    await addNotice({
      organizationId: run.organizationId,
      conversationId: run.conversationId,
      messageId: run.triggerMessageId,
      kind: "envio",
      body: `No salió el texto del Agente IA (${reason.slice(0, 200)}): «${text}». Revisa el hilo.`,
    });
    return;
  }
  // Contesta hasta lo que el agente leyó (no lo que el cliente escribió después).
  if (run.triggerMessageId) {
    await markAnswersUntil(run.organizationId, messageId, run.triggerMessageId).catch((error: unknown) =>
      console.error(`[workflows] ${run.id}: no se pudo marcar el texto del Agente IA como su respuesta`, error),
    );
  }
}

async function runStep(step: WorkflowStepPayload, ctx: StepCtx): Promise<SendOutcome | null> {
  const { run, deps } = ctx;
  switch (step.kind) {
    case "send_text": {
      const messageId = stepMessageId(run.id, ctx.stepIndex);
      const prior = await alreadySent(run.organizationId, messageId);
      if (prior) return prior;
      const text = stripUnresolvedVariables(renderSnippet(step.text, ctx.values));
      // Candado anti-repetición (28-sep-2026): lo que sale a nombre del agente (corrida del
      // agente o por palabra clave) no repite un texto IDÉNTICO que ya salió después del
      // último mensaje del cliente (p. ej. la pregunta que el agente ya hizo). El comando o
      // la etapa de un vendedor salen siempre: los pidió él.
      if (isAgentTrigger(run) && splitRepeated([text], await outboundTextsSinceLastInbound(run.organizationId, run.conversationId)).dropped.length) {
        console.info(`[workflows] ${run.id}: paso ${ctx.stepIndex + 1} omitido; ya salió igual: «${text.slice(0, 120)}»`);
        return null;
      }
      return sendTextMessage(deps.provider, {
        organizationId: run.organizationId,
        conversationId: run.conversationId,
        text,
        source: ctx.source,
        sentByUserId: ctx.sentBy,
        // Solo un comando (el vendedor está viendo el chat) marca leídos.
        markRead: run.trigger === "command",
        messageId,
        now: deps.now(),
      });
    }
    case "send_media": {
      if (!step.assetId) throw new SendRejectedError("media_not_found", "El paso no tiene archivo.");
      if (!deps.storage) throw new SendRejectedError("storage_unavailable", "El almacenamiento de archivos no está configurado.");
      const messageId = stepMessageId(run.id, ctx.stepIndex);
      const prior = await alreadySent(run.organizationId, messageId);
      if (prior) return prior;
      return sendMediaMessage(deps.provider, deps.storage, {
        organizationId: run.organizationId,
        conversationId: run.conversationId,
        assetId: step.assetId,
        caption: ctx.agentCaption ?? (step.caption ? stripUnresolvedVariables(renderSnippet(step.caption, ctx.values)) : null),
        source: ctx.source,
        sentByUserId: ctx.sentBy,
        markRead: run.trigger === "command",
        messageId,
        now: deps.now(),
      });
    }
    case "wait": {
      // Un "/" del vendedor no espera (waitMs); agente y palabra clave sí.
      const ms = waitMs(step, run.trigger);
      if (ms > 0) await deps.sleep(ms);
      return null;
    }
  }
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

/** Barrido: corridas "running" con lease vencido y reintentos disponibles → se re-encolan (retoman por cursor). */
export async function staleRunningRuns(now = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.status, "running"),
        lt(workflowRuns.startedAt, new Date(now.getTime() - RUN_LEASE_MS)),
        lte(workflowRuns.attempts, RUN_MAX_ATTEMPTS),
      ),
    )
    .limit(100);
  return rows.map((r) => r.id);
}

/** Barrido: corridas "running" atoradas SIN reintentos (o muy viejas) → failed. */
export async function failStuckRuns(now = new Date()): Promise<number> {
  const rows = await db
    .update(workflowRuns)
    .set({ status: "failed", errorCode: FAIL_STUCK, finishedAt: now })
    .where(
      and(
        eq(workflowRuns.status, "running"),
        or(
          and(lt(workflowRuns.startedAt, new Date(now.getTime() - RUN_LEASE_MS)), gt(workflowRuns.attempts, RUN_MAX_ATTEMPTS)),
          lt(workflowRuns.startedAt, new Date(now.getTime() - RUN_STUCK_AFTER_MS)),
        ),
      ),
    )
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
