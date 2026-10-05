// Orquestador del Agente IA para UNA conversación (Fase B). Lo invoca el
// consumer de la cola (worker.ts) cuando vence el debounce, ya con el candado
// Redis de la conversación tomado. Dependencias inyectables para testearlo.
//
// Flujo: pendientes → idempotencia → compuerta (interruptor, pausa por vendedor,
// ventana 24h, envío en camino) → FILTRO (solo limpia el anuncio de
// Click-to-WhatsApp) → CEREBRO con TODA la conversación → revisión antes de enviar
// (si entró algo nuevo: descartar y regenerar con TODO) → envío en mensajes para
// celular. Cada llamada al modelo deja su fila en ai_usage.
//
// Definición del dueño (23-sep-2026): el agente es el motor que hace que siempre
// haya alguien respondiendo, como Ángela en GHL, y se rige SOLO por el Goal y las
// FAQs. Responde todo, sin trabas. Lo único que lo pausa es que un vendedor
// conteste; si el cliente pide a una persona, avisa al vendedor y sigue activo.
import type { CallModelInput, CallModelResult, CatalogModel } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/catalog";
import { modelAvailability, PROVIDER_META } from "@/lib/ai/provider";
import { hasUnresolvedAgentError, holdAgentForReview, recordAgentError, supersedeAgentErrors } from "./agent-error";
import { agentErrorBody, bothModelsFailedBody, classifyModelError, EMPTY_RESPONSE_INFO, sendErrorBody, sendErrorMotive, type ModelErrorInfo } from "./model-errors";
import { cleanAdMessages } from "./ad-cleaner";
import { parseBrainOutput } from "./brain";
import { loadBrainSystem } from "./brain-system";
import { answerRunsWithText, captionRunOf, crmContextFor, executeActions, loadAgentTools, noteForVendor, prepareActions, quoteSetByVendor, runsThatSend, setQuoteByAgent, type ActionContext, type ActionPhase, type ActionPlan, type ExecutedActions, type StartWorkflow } from "./actions";
import { maxPerChatContextFor } from "@/lib/workflows/max-per-chat";
import { AGENT_CAPTION_KEY, MAX_CAPTION } from "@/lib/workflows/steps";

// Red contra el silencio (29-sep-2026, dueño). Antes, si el modelo contestaba solo con
// acciones (sin texto) y ninguna le mandaba algo al cliente, el CRM mandaba un texto fijo
// («Listo 👍 ¿En qué más te ayudo?» o uno por motivo). En producción salió 10 veces y
// ninguna era correcta: 5 tapaban la pregunta de un workflow que ya había contestado. Ahora
// el CRM NUNCA escribe por su cuenta: (1) si ya le salió algo al cliente después de su
// último mensaje, no se manda nada más; (2) si no, escribe el otro modelo; (3) si nadie
// escribe, no sale nada y el vendedor recibe el aviso "sin_respuesta" (amarillo, no pausa).
export const SIN_RESPUESTA_NOTE =
  "El cliente todavía no tiene respuesta a su último mensaje: contéstale con texto (además de las acciones que hagan falta).";
export const SIN_RESPUESTA_BODY = "El Agente IA no le escribió nada al cliente (los modelos contestaron solo con acciones). Revisa si hacía falta contestar.";
// Pregunta sin contestar, parte 2 (5-oct-2026): la respuesta solo repetía la pregunta.
export function repeatNoticeBody(question: string): string {
  return `El Agente IA solo iba a repetir la pregunta «${question}», que el cliente no contestó, y no salió. Revisa si hacía falta contestar.`;
}
import { mergeHandoffToolCalls, validateToolCalls, type ValidToolCall } from "./tools";
import { unfinishedReply } from "./internal-text";
import { applyDetalleByAgent, detalleContextFor, mergeDetalle } from "./detalle";
import { transcriptionWaitMs } from "@/lib/ai/transcription/rules";
import { handoverPauseUntil, humanPauseUntil, isWithinSchedule, type BotOptions } from "@/lib/agente-ia/opciones";
import { loadAgentConfig, loadCustomValues } from "./config";
import { loadBotOptions } from "./options";
import { pauseForHumanReply } from "./pause";
import { brainCandidates, brainModelForStage, handoffStage, impliedStage, type ModelSlot, type StageSignal } from "./model-by-stage";
import { loadContactStage } from "@/lib/contacts/stage";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { complementNote, partialNote, withoutClosingQuestions } from "./complement";
import { closingQuestion, isBareAck, onlyRepeatsLastQuestion, repeatNote, withoutUnansweredRepeat } from "./unanswered";
import {
  agentReplyCount,
  alreadyHandled,
  answeredByWorkflow,
  humanOutboundCount,
  inboundCount,
  answerRunInFlight,
  lastOutbound,
  loadHistory,
  loadSnapshot,
  messageAt,
  agentSendUnresolved,
  lastQuestionAsked,
  outboundTextsSinceLastInbound,
  pendingInbound,
  sentToClientSinceLastInbound,
  type MessageRow,
} from "./context";
import { splitRepeated } from "@/lib/messaging/repeat";
import { addNotice } from "./notices";
import { decideGate, toBubbles } from "./policy";
import { rescheduleDelayFor } from "./schedule";
import { closePlan, markAgentReply, savePlan, setAgentState } from "./state";
import {
  bubbleMessageId,
  claimSavedReply,
  discardSavedReplies,
  holdForRetry,
  inboundAfter,
  loadSavedReply,
  markAnswersUntil,
  SAVED_REPLY_TTL_MS,
  type SavedReply,
} from "./saved-reply";
import { isWindowOpen } from "@/lib/messaging/rules";
import { completedAfterConfirmation, noDisponibleEstado, UNAVAILABLE_REPLY_TEXT } from "@/lib/messaging/unavailable";
import { buildModelMessages, fitHistory } from "./transcript";
import { recordAiUsage } from "./usage";
import { allowedAgentStage, vendorAnsweredProof } from "./venta-cerrada";

export const MAX_ROUNDS = 3; // regeneraciones por corrida antes de volver al debounce
export const BUBBLE_PAUSE_MS = 1_500;
// Holgado: los modelos actuales (Sonnet 5, Luna, Opus 5.5…) razonan antes del texto
// y ese razonamiento cuenta en el tope. Con 1,024 la respuesta de B5 (dos comprobantes
// juntos) se cortó y su aviso al vendedor se perdió (docs/fase-d-diseno.md §11); desde
// la Fase E son 4,096 (solo se paga lo que se usa) y si aun así se corta, aviso.
export const BRAIN_MAX_OUTPUT_TOKENS = 4_096;
// Timeouts por llamada. Desde el 27-sep-2026 una ronda llama al cerebro hasta 2 veces (el
// otro modelo si el primero falla, o el Modelo 2 en un traspaso): 3 rondas × (limpieza del
// anuncio 20 s + 2 × 60 s) = 7 min < candado de 8 min (process.ts). El único reintento por
// proveedor saturado (10 s + 60 s) solo aplica con UN modelo, y cabe igual.
export const FILTER_TIMEOUT_MS = 20_000;
export const BRAIN_TIMEOUT_MS = 60_000;
// Fase E ("reenvío seguro"): espera antes del ÚNICO reintento automático, y solo si
// el proveedor está saturado (model-errors.ts). Uno por corrida, no por ronda: con
// él, el peor caso cabe en el candado de 8 min (process.ts).
export const SATURATED_RETRY_MS = 10_000;
// Cada cuánto vuelve a mirar el agente mientras corre un workflow «El workflow es la respuesta»
// (answerRunInFlight; tope de la espera en context.ts).
export const ANSWER_RUN_POLL_MS = 5_000;

export type RunDeps = {
  now: () => Date;
  callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
  // Envía UNA burbuja como el agente (source "ai_agent", sin usuario) con el id
  // DETERMINISTA del plan (fila de messages = Idempotency-Key; sendAgentText): un
  // "Reintentar" de la respuesta guardada reenvía la MISMA fila sin duplicar.
  // Devuelve el resultado del proveedor: "pending" = no confirmado (timeout, 5xx); el
  // outbox lo concilia y, si vence sin confirmar, el barrido deja un aviso al vendedor.
  sendBubble: (p: { organizationId: string; conversationId: string; text: string; messageId: string }) => Promise<{ status: "sent" | "pending"; messageId?: string }>;
  sleep: (ms: number) => Promise<void>;
  // URL firmada de una imagen del bucket (o null si no se puede).
  resolveImage: (storageKey: string) => Promise<string | null>;
  // Fase D: arranca una corrida de workflow (trigger "agent") pedida por el cerebro.
  startWorkflow: StartWorkflow;
  // Fase E: ¿el modelo tiene llave y adaptador en este entorno? Por defecto,
  // modelAvailability (lee process.env). Los tests lo sustituyen.
  isModelAvailable?: (modelId: string) => boolean;
  // Parte 1: ¿este worker transcribe notas de voz (bucket + llave de OpenAI)? Solo
  // entonces el agente espera la transcripción (hasta 60 s desde que llegó el audio).
  transcriptionEnabled?: boolean;
};

export type RunResult =
  | { kind: "noop"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "sent"; bubbles: number }
  | { kind: "reschedule"; delayMs: number; reason: string }
  // Fase E: el modelo falló; quedó la tarjeta "El agente no pudo responder" (sin reintento de la cola).
  | { kind: "failed"; reason: string };

const HUMAN_SOURCES = new Set(["crm", "business_app"]);

// Resultado de UNA llamada al cerebro (27-sep-2026: si falla, contesta el otro modelo).
type BrainOk = {
  ok: true;
  model: CatalogModel;
  res: CallModelResult;
  out: ReturnType<typeof parseBrainOutput>;
  toolCalls: ValidToolCall[];
  ignored: string[];
  latencyMs: number;
};
type BrainFail = { ok: false; model: CatalogModel; info: ModelErrorInfo };

// Lo que importa de las acciones para saber a qué etapa lleva la respuesta (traspaso).
function stageSignals(calls: readonly ValidToolCall[]): StageSignal[] {
  return calls.flatMap((c): StageSignal[] =>
    c.kind === "etapa" ? [{ kind: "etapa", etapa: c.etapa }] : c.kind === "workflow" ? [{ kind: "workflow", slug: c.workflow.slug }] : [],
  );
}

function isHumanReply(m: MessageRow | null): boolean {
  return m !== null && m.direction === "out" && HUMAN_SOURCES.has(m.source);
}

function latestDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Un PDF más grande (catálogo de 40 páginas, archivo renombrado) no va al modelo:
// el proveedor lo rechazaría y el agente se quedaría mudo en esa conversación.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// URLs firmadas de las imágenes Y los PDF del cliente (un comprobante SPEI suele
// llegar en PDF): el modelo los ve como archivo. Con "Responder imágenes: No"
// (Opciones del bot) las imágenes ni se firman: el modelo ve "[imagen]".
async function mediaUrlsFor(rows: readonly MessageRow[], resolve: RunDeps["resolveImage"], images = true) {
  const urls = new Map<string, string>();
  for (const m of rows) {
    if (m.direction !== "in") continue;
    for (const a of m.attachments) {
      const isPdf = a.type === "document" && a.mimeType === "application/pdf" && a.sizeBytes != null && a.sizeBytes <= MAX_PDF_BYTES;
      if ((a.type !== "image" && !isPdf) || !a.storageKey || urls.has(a.storageKey)) continue;
      if (a.type === "image" && !images) continue;
      const url = await resolve(a.storageKey).catch(() => null);
      if (url) urls.set(a.storageKey, url);
    }
  }
  return urls;
}

// Mensaje del cliente del lote que trae un comprobante (imagen o PDF), el más
// reciente; null si no hay. Clave de idempotencia del registro de comprobantes.
function receiptMessageId(pending: readonly MessageRow[]): string | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    // Solo lo que el modelo pudo ver (un PDF gigante no cuenta como comprobante).
    if (pending[i].attachments.some((a) => a.type === "image" || (a.type === "document" && a.mimeType === "application/pdf" && a.sizeBytes != null && a.sizeBytes <= MAX_PDF_BYTES))) return pending[i].id;
  }
  return null;
}

// ¿Sigue pudiendo enviar el agente? Estado FRESCO justo antes de una burbuja.
type StopReason = "cambio_antes_de_enviar" | "respuesta_humana" | "entrante_nuevo";

async function stopBeforeBubble(
  organizationId: string,
  conversationId: string,
  humansAtCheck: number,
  inboundsAtCheck: number | null,
): Promise<StopReason | null> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap || snap.channel.aiAgentMode !== "auto" || snap.conversation.agentState !== "activo") {
    return "cambio_antes_de_enviar";
  }
  if ((await humanOutboundCount(organizationId, conversationId)) > humansAtCheck) return "respuesta_humana";
  // El cliente escribió después de lo que leyó el modelo: esta respuesta ya no
  // contesta lo último (y, si saliera, dejaría su mensaje como "atendido").
  // (null = no se revisa: el reenvío de una respuesta guardada sale igual y luego
  // se atiende lo nuevo con inboundAfter.)
  if (inboundsAtCheck !== null && (await inboundCount(organizationId, conversationId)) > inboundsAtCheck) return "entrante_nuevo";
  return null;
}

// Acciones del cerebro (Fase D): nunca lanzan hacia afuera; lo que no se pudo
// ejecutar queda como aviso al vendedor.
async function runActions(
  plan: ActionPlan,
  ctx: ActionContext,
  startWorkflow: StartWorkflow,
  phase: ActionPhase,
): Promise<ExecutedActions | null> {
  if (phase === "antes" && !plan.avisos.length && plan.quote === null && !plan.stage && !plan.notes.length) return null;
  if (phase === "despues" && !plan.runs.length) return null;
  if (phase === "antes") {
    // Estricto: un aviso de pago o de pase a humano que no se pudo guardar detiene
    // la respuesta (el job reintenta); el cliente no recibe "pago recibido" a ciegas.
    const done = await executeActions(plan, ctx, startWorkflow, phase);
    if (done.avisos || done.stageMoved || done.notes.length) {
      console.info(`[agente] ${ctx.conversationId}: acciones previas → ${[done.avisos ? `${done.avisos} aviso(s)` : "", done.stageMoved ? `etapa → ${done.stageTo}` : "", ...done.notes].filter(Boolean).join("; ")}`);
    }
    const paraVendedor = done.notes.filter(noteForVendor);
    if (paraVendedor.length) {
      await addNotice({ organizationId: ctx.organizationId, conversationId: ctx.conversationId, messageId: ctx.batchMessageId, kind: "envio", body: `Acción del agente no ejecutada: ${paraVendedor.join("; ")}.` });
    }
    return done;
  }
  try {
    const done = await executeActions(plan, ctx, startWorkflow, phase);
    if (done.started.length || done.skipped.length || done.notes.length || done.avisos || done.stageMoved) {
      console.info(`[agente] ${ctx.conversationId}: acciones → ${[...done.started, ...done.skipped, ...done.notes, done.avisos ? `${done.avisos} aviso(s)` : "", done.stageMoved ? `etapa → ${done.stageTo}` : ""].filter(Boolean).join("; ")}`);
    }
    const paraVendedor = [...done.skipped, ...done.notes].filter(noteForVendor);
    if (paraVendedor.length) {
      await addNotice({ organizationId: ctx.organizationId, conversationId: ctx.conversationId, messageId: ctx.batchMessageId, kind: "envio", body: `Acción del agente no ejecutada: ${paraVendedor.join("; ")}.` });
    }
    return done;
  } catch (error) {
    console.error(`[agente] ${ctx.conversationId}: acciones fallaron`, error);
    await holdAgentForReview({ organizationId: ctx.organizationId, conversationId: ctx.conversationId, messageId: ctx.batchMessageId, body: `Las acciones del Agente IA (${plan.runs.map((r) => r.slug).join(", ") || "etapa/aviso/cotización"}) no se ejecutaron: ${errorText(error)}.` });
    return null;
  }
}

// Un vendedor contestó en la conversación: pausa según Opciones del bot ("Pausar el
// bot cuando un vendedor contesta", fábrica sí; "Reactivar solo después de N h",
// fábrica nunca = hasta "Activar").
async function pauseForHuman(conversation: { id: string; organizationId: string }, now: Date) {
  const decision = humanPauseUntil(await loadBotOptions(conversation.organizationId, now), now);
  if (!decision.pause) {
    console.info(`[agente] ${conversation.id}: un vendedor contestó; "Pausar al Agente IA cuando un vendedor contesta" está en No, sigue activo`);
    return;
  }
  await setAgentState(conversation.organizationId, conversation.id, "pausado_humano", { now, pausedUntil: decision.until, log: { action: "pausa_auto" } });
  console.info(`[agente] ${conversation.id}: pausado_humano${decision.until ? ` hasta ${decision.until.toISOString()}` : ""}`);
}

// Opciones del bot → "Cuando el cliente pide un asesor: avisar y pausar X horas": se
// aplica DESPUÉS de mandarle al cliente que un asesor lo atenderá (y de encolar la
// media de la respuesta). Condicional: si un vendedor ya lo pausó, su pausa manda.
async function pauseAfterHandover(conv: { id: string; organizationId: string }, plan: ActionPlan, options: BotOptions, now: Date): Promise<void> {
  if (!plan.avisos.some((a) => a.motivo === "cliente_pide_humano")) return;
  const until = handoverPauseUntil(options, now);
  if (!until) return;
  if (await pauseForHumanReply(conv.organizationId, conv.id, now, until, { action: "pausa_asesor" })) {
    console.info(`[agente] ${conv.id}: el cliente pidió un asesor; pausado hasta ${until.toISOString()} (Opciones del Agente IA)`);
  }
}

// Opciones del bot → "Máximo de respuestas del bot por conversación": al llegar al tope
// se pausa hasta "Activar" y deja el aviso 🤖 (tarjeta amarilla en el Embudo). Cubre un
// bucle con otro bot. Se cuenta desde el último corte ("Activar" o encendido del canal).
export function topeRespuestasBody(max: number): string {
  return `Llegó al máximo de respuestas (${max.toLocaleString("es-MX")}). El agente se pausó en este chat; revísalo y, si debe seguir, elige «Activar» en el Detalle del contacto.`;
}

// "Reintentar" de una respuesta GUARDADA (parte 1, 26-sep-2026): manda el MISMO texto
// con los MISMOS ids de mensaje (sendAgentText decide qué burbuja ya salió), después
// la media que iba tras el texto, y NUNCA llama al modelo. Si el cliente escribió
// mientras la tarjeta esperaba, lo atiende en la ronda siguiente: cada burbuja reenviada
// solo "contesta" hasta el entrante original (markAnswersUntil), así lo nuevo sigue
// pendiente en la BD aunque esa ronda se re-programe o falle.
type ResendOutcome = { kind: "done"; result: RunResult } | { kind: "newer" };

// Resultado AMBIGUO (Zernio no confirmó si salió): reenviar podría duplicar. No es tarjeta
// de "Reintentar" (daría vueltas sin salida): aviso para revisar el celular.
function isUnconfirmedResend(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown };
  return e?.name === "SendRejectedError" && e.code === "not_retryable";
}

async function resendSavedReply(
  saved: SavedReply,
  ctx: { org: string; conversationId: string; contactId: string; fallbackTriggerId: string | null; deps: RunDeps },
): Promise<ResendOutcome> {
  const { org, conversationId, deps } = ctx;
  const triggerId = saved.triggerMessageId ?? ctx.fallbackTriggerId;
  // Sin entrante de referencia (se borró) no hay a qué ligar la tarjeta ni la media.
  if (!triggerId) {
    await discardSavedReplies(org, conversationId, "obsoleto");
    return { kind: "done", result: { kind: "noop", reason: "respuesta_guardada_sin_entrante" } };
  }
  if (!(await claimSavedReply(org, saved.id))) return { kind: "done", result: { kind: "noop", reason: "reintento_en_curso" } };
  const humansAtStart = await humanOutboundCount(org, conversationId);
  let sent = 0;
  let unconfirmed = 0;
  let stopped: StopReason | null = null;
  try {
    for (const [i, text] of saved.bubbles.entries()) {
      if (sent > 0) await deps.sleep(BUBBLE_PAUSE_MS);
      stopped = await stopBeforeBubble(org, conversationId, humansAtStart, null);
      if (stopped) break;
      const outcome = await deps.sendBubble({ organizationId: org, conversationId, text, messageId: bubbleMessageId(saved.id, i) });
      sent++;
      await markAnswersUntil(org, outcome.messageId ?? bubbleMessageId(saved.id, i), triggerId);
      if (outcome.status !== "sent") {
        unconfirmed++;
        break;
      }
    }
  } catch (error) {
    if (sent === 0 && isUnconfirmedResend(error)) {
      await closePlan(org, saved.id, "enviado");
      await holdAgentForReview({
        organizationId: org,
        conversationId,
        messageId: triggerId,
        body: `WhatsApp no confirmó si le llegó al cliente la respuesta del Agente IA «${saved.bubbles.join(" / ")}». Revísalo en el celular; si no le llegó, escríbesela tú.`,
      });
      console.warn(`[agente] ${conversationId}: respuesta guardada sin confirmar; no se reenvía (podría duplicar), aviso al vendedor`);
      return { kind: "done", result: { kind: "skipped", reason: "envio_sin_confirmar" } };
    }
    if (sent === 0) {
      // Vuelve a quedar guardada y la tarjeta se reabre con el motivo nuevo.
      await holdForRetry(org, saved.id);
      await recordAgentError({ organizationId: org, conversationId, messageId: triggerId, body: sendErrorBody(sendErrorMotive(error)) });
      console.warn(`[agente] ${conversationId}: el reenvío de la respuesta guardada falló (${errorText(error)}); tarjeta otra vez`);
      return { kind: "done", result: { kind: "failed", reason: "envio_fallido" } };
    }
    await closePlan(org, saved.id, "enviado");
    await markAgentReply(org, conversationId, deps.now());
    await supersedeAgentErrors(org, conversationId);
    await holdAgentForReview({
      organizationId: org,
      conversationId,
      messageId: triggerId,
      body: `Salieron ${sent} de ${saved.bubbles.length} mensajes de la respuesta guardada del Agente IA y el siguiente falló. No se envió: «${saved.bubbles.slice(sent).join(" / ")}».`,
    });
    return { kind: "done", result: { kind: "sent", bubbles: sent } };
  }
  if (stopped && sent === 0) {
    // Un vendedor contestó, pausaron al agente o apagaron el canal: la respuesta guardada
    // ya no sale (decidió una persona).
    await closePlan(org, saved.id, "obsoleto");
    if (stopped === "respuesta_humana") await pauseForHuman({ id: conversationId, organizationId: org }, deps.now());
    return { kind: "done", result: { kind: "skipped", reason: stopped } };
  }
  await closePlan(org, saved.id, "enviado");
  await markAgentReply(org, conversationId, deps.now());
  await supersedeAgentErrors(org, conversationId);
  if (stopped === "respuesta_humana") await pauseForHuman({ id: conversationId, organizationId: org }, deps.now());
  const omitted = saved.bubbles.length - sent;
  if (omitted > 0) {
    await holdAgentForReview({
      organizationId: org,
      conversationId,
      messageId: triggerId,
      body: `${unconfirmed ? "WhatsApp no confirmó una parte de la respuesta guardada del Agente IA." : "El reenvío de la respuesta guardada del Agente IA se detuvo."} No se envió: «${saved.bubbles.slice(sent).join(" / ")}».`,
    });
  }
  console.info(`[agente] ${conversationId}: respuesta guardada reenviada (${sent} mensaje/s), sin llamar al modelo`);
  if (stopped) return { kind: "done", result: { kind: "sent", bubbles: sent } };
  // La media que iba después del texto (idempotente por el entrante de la respuesta).
  const media: ActionPlan = { runs: saved.runs, quote: null, stage: null, avisos: [], notes: [] };
  await runActions(media, { organizationId: org, conversationId, contactId: ctx.contactId, batchMessageId: triggerId, receiptMessageId: null, now: deps.now(), since: null }, deps.startWorkflow, "despues");
  if ((await inboundAfter(org, conversationId, triggerId)).length) return { kind: "newer" };
  return { kind: "done", result: { kind: "sent", bubbles: sent } };
}

// `job` viene de la cola interna: la organización acota TODAS las lecturas y
// escrituras (una conversación de otra organización no se encuentra: noop).
export async function runAgent(job: { organizationId: string; conversationId: string }, deps: RunDeps): Promise<RunResult> {
  const { organizationId: org, conversationId } = job;
  let saturatedRetryUsed = false; // Fase E: un solo reintento automático por corrida
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const now = deps.now();
    const snap = await loadSnapshot(org, conversationId);
    if (!snap) return { kind: "noop", reason: "conversacion_no_existe" };
    const { conversation: conv, channel } = snap;
    // Solo "auto" (Encendido) responde; "borrador" ya no existe y cuenta como apagado.
    if (channel.aiAgentMode !== "auto") return { kind: "skipped", reason: "canal_off" };
    const cfg = await loadAgentConfig(org);
    // Opciones del bot (caché ≤ 60 s): los cambios de la pestaña aplican sin redesplegar.
    const options = await loadBotOptions(org, now);

    const pending = await pendingInbound(org, conv.id);
    const lastOut = await lastOutbound(org, conv.id);
    // Línea base de salientes HUMANOS al INICIO de la ronda (antes del modelo): un
    // envío manual que entre en cualquier momento después detiene el envío del agente.
    const humansAtStart = await humanOutboundCount(org, conv.id);
    // Encender el canal o "Reactivar" es corte: lo que un vendedor contestó ANTES
    // no vuelve a pausar.
    const cut = latestDate(conv.agentStateChangedAt, channel.aiAgentModeChangedAt);
    // "Un vendedor tomó la conversación": el último saliente es humano (CRM o
    // celular) y es posterior al último corte.
    const humanTookOver = isHumanReply(lastOut) && (cut === null || messageAt(lastOut!) > cut);

    // Parte 1 (26-sep): ¿hay una respuesta GUARDADA cuyo envío falló? Solo cuenta si es
    // posterior al último corte ("Reactivar", encender el canal): una vieja ya no sale.
    // Se revisa ANTES que los pendientes: si su 1er mensaje sí llegó y el error fue
    // después, el entrante ya se ve "contestado" y aun así falta el resto.
    let saved: SavedReply | null = await loadSavedReply(org, conv.id);
    if (saved && cut !== null && saved.createdAt <= cut) {
      await discardSavedReplies(org, conv.id, "obsoleto");
      saved = null;
    }
    // Vieja (más de 24 h) o con la ventana de WhatsApp cerrada: ya no sale (días después
    // sería una respuesta fuera de lugar). Aviso al vendedor para que decida.
    const expired = saved && now.getTime() - saved.createdAt.getTime() > SAVED_REPLY_TTL_MS;
    if (saved && (expired || !isWindowOpen(conv.windowExpiresAt, now))) {
      await discardSavedReplies(org, conv.id, "obsoleto");
      await addNotice({
        organizationId: org,
        conversationId: conv.id,
        kind: "envio",
        body: `La respuesta guardada del agente ya no se envió: ${expired ? "pasaron más de 24 horas" : "la ventana de 24 h de WhatsApp cerró"}. No salió: «${saved.bubbles.join(" / ")}». Si hace falta, contesta tú${expired ? "" : " (con una plantilla)"}.`,
      });
      saved = null;
    }
    if (pending.length === 0 && !saved) {
      if (humanTookOver && conv.agentState === "activo") await pauseForHuman(conv, now);
      return { kind: "noop", reason: "sin_pendientes" };
    }
    const lastRead = pending.at(-1) ?? null;
    // Con respuesta guardada, su entrante cuenta como "atendido" (el plan existe): igual
    // se sigue para reenviarla.
    // El texto fijo del mensaje no disponible se guardó con el id de ESTA fila: si después
    // llegó su contenido real, está pendiente (pendingInbound) y se contesta lo que dice.
    if (!saved && lastRead && !completedAfterConfirmation(lastRead.metadata) && (await alreadyHandled(org, lastRead.id))) {
      return { kind: "noop", reason: "ya_atendido" };
    }
    // Las burbujas de la respuesta guardada no cuentan como "envío en camino": el
    // reenvío las retoma con su misma clave (sendAgentText).
    const savedIds = saved ? saved.bubbles.map((_, i) => bubbleMessageId(saved!.id, i)) : [];

    const gate = decideGate({
      channelMode: channel.aiAgentMode,
      agentState: conv.agentState,
      now: now.getTime(),
      windowExpiresAt: conv.windowExpiresAt?.getTime() ?? null,
      // Con "Pausar el bot cuando un vendedor contesta: No", una respuesta humana no
      // pausa: el agente contesta lo que el cliente escribió después de ella.
      humanRepliedSincePending: humanTookOver && options.pauseOnHumanReply,
      agentSendUnresolved: await agentSendUnresolved(org, conv.id, savedIds),
      withinSchedule: isWithinSchedule(options.schedule, now),
    });
    if (gate.action === "skip") {
      if (gate.pauseTo) await pauseForHuman(conv, now);
      return { kind: "skipped", reason: gate.reason };
    }
    // Fase E ("reenvío seguro"): con una tarjeta de error sin atender, el agente no
    // vuelve a llamar al modelo en esta conversación (ni por mensajes nuevos) hasta
    // que un vendedor elija "Reintentar" o "Apagar".
    if (await hasUnresolvedAgentError(org, conv.id)) return { kind: "skipped", reason: "error_sin_atender" };
    if (saved) {
      // "Reintentar" tras una falla de ENVÍO: sale el MISMO texto, sin llamar al modelo.
      const r = await resendSavedReply(saved, { org, conversationId: conv.id, contactId: conv.contactId, fallbackTriggerId: lastRead?.id ?? null, deps });
      if (r.kind === "done") return r.result;
      continue; // lo que el cliente escribió después sigue pendiente (markAnswersUntil)
    }
    if (!cfg.goal) return { kind: "skipped", reason: "sin_goal" };
    if (!lastRead) return { kind: "noop", reason: "sin_pendientes" };
    // Tope de respuestas por conversación (Opciones del bot): PRIMERO la pausa (nunca
    // "se pausó" con el agente todavía activo) y luego el aviso, idempotente por entrante.
    if (options.maxRepliesPerContact !== null) {
      const replies = await agentReplyCount(org, conv.id, cut);
      if (replies >= options.maxRepliesPerContact) {
        await pauseForHumanReply(org, conv.id, now, null, { action: "pausa_tope" });
        await addNotice({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, kind: "tope_respuestas", body: topeRespuestasBody(options.maxRepliesPerContact) });
        console.warn(`[agente] ${conv.id}: llegó al máximo de respuestas (${replies}/${options.maxRepliesPerContact}); pausado hasta "Activar"`);
        return { kind: "skipped", reason: "tope_respuestas" };
      }
    }
    // «El workflow es la respuesta» (29-sep-2026; antes, 28-sep, "termina en pregunta"): el
    // workflow por palabra clave contesta el mensaje que lo disparó. Mientras esa corrida va en
    // camino, el agente espera; al terminar, su último mensaje cierra SOLO ese mensaje y queda
    // pendiente lo demás que el cliente escribió (antes o después).
    if (await answerRunInFlight(org, conv.id, pending.map((p) => p.id), now)) {
      return { kind: "reschedule", delayMs: ANSWER_RUN_POLL_MS, reason: "esperando_workflow_respuesta" };
    }
    // Complemento (30-sep-2026, caso «De que cd son»): ese mensaje sigue pendiente hasta que el agente lo
    // revise, porque el workflow contesta solo SU tema. Si es el último del cliente, el agente
    // contesta lo que falte, sin repetir al workflow y sin preguntar, o no escribe nada
    // (NOTHING_TOKEN). Si el cliente ya siguió escribiendo, se contesta como siempre.
    const byWorkflow = await answeredByWorkflow(org, conv.id, pending.map((p) => p.id));
    const complementOf = byWorkflow.get(lastRead.id) ?? null;
    const workflowNote = complementOf ? complementNote(complementOf) : byWorkflow.size ? partialNote([...byWorkflow.values()][0]) : null;
    // Caso SDA (29-sep-2026, lib/messaging/unavailable.ts): el PRIMER mensaje del
    // cliente no llegó (Meta 131060, confirmado por la doble verificación). Sale el
    // texto fijo del dueño, sin llamar al modelo, con las mismas reglas que cualquier
    // respuesta (horario, pausa, ventana, humano). Lo que el cliente escriba después
    // lo contesta el modelo como siempre.
    if (pending.every((p) => noDisponibleEstado(p.metadata) === "sin_contenido")) {
      const planId = await savePlan({ organizationId: org, conversationId: conv.id, bubbles: [UNAVAILABLE_REPLY_TEXT], triggerMessageId: lastRead.id, now: deps.now() });
      const stopped = await stopBeforeBubble(org, conv.id, humansAtStart, await inboundCount(org, conv.id));
      if (stopped) {
        await closePlan(org, planId, "obsoleto");
        if (stopped === "respuesta_humana") await pauseForHuman(conv, deps.now());
        if (stopped === "entrante_nuevo") continue; // el cliente ya escribió: lo contesta el modelo
        return { kind: "skipped", reason: stopped };
      }
      try {
        await deps.sendBubble({ organizationId: org, conversationId: conv.id, text: UNAVAILABLE_REPLY_TEXT, messageId: bubbleMessageId(planId, 0) });
      } catch (error) {
        // Igual que una respuesta normal: queda GUARDADA para "Reintentar" y la tarjeta al vendedor.
        await holdForRetry(org, planId);
        await recordAgentError({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, body: sendErrorBody(sendErrorMotive(error)) });
        console.warn(`[agente] ${conv.id}: el aviso de mensaje no recibido no salió (${errorText(error)}); guardado y tarjeta para el vendedor`);
        return { kind: "failed", reason: "envio_fallido" };
      }
      await markAgentReply(org, conv.id, deps.now());
      await supersedeAgentErrors(org, conv.id);
      await closePlan(org, planId, "enviado");
      console.info(`[agente] ${conv.id}: el primer mensaje no llegó (Meta 131060); se le pidió al cliente que lo repita`);
      return { kind: "sent", bubbles: 1 };
    }
    // Parte 1: una nota de voz del cliente aún sin transcribir → la espera sigue (hasta
    // 60 s desde que llegó); el worker la adelanta en cuanto termina. Si falla o tarda
    // más, el agente contesta con "[nota de voz sin transcribir]" y no se traba.
    // Con "Responder notas de voz: No" no hay nada que esperar.
    if (deps.transcriptionEnabled && options.transcribeAudio) {
      const waitMs = transcriptionWaitMs(pending, now);
      if (waitMs > 0) return { kind: "reschedule", delayMs: waitMs, reason: "esperando_transcripcion" };
    }

    const readCount = await inboundCount(org, conv.id);
    // TODA la conversación; si algún día no cabe en el modelo, lo más reciente.
    const history = fitHistory(await loadHistory(org, conv.id));
    // Venta cerrada solo con un vendedor (2-oct-2026): ¿ya contestó un vendedor a un comprobante
    // del cliente en el chat que lee el modelo? Sin eso, Compra queda en "Cerca de compra".
    const vendorConfirmedPayment = vendorAnsweredProof(history);
    const base = { organizationId: org, conversationId: conv.id, messageId: lastRead.id };

    // ── FILTRO: solo limpia el anuncio de Click-to-WhatsApp (nunca frena) ────
    const cleanText = await cleanAdMessages(history, {
      organizationId: org,
      conversationId: conv.id,
      filterModelId: cfg.modeloFiltro,
      callModel: deps.callModel,
    });

    // ── CEREBRO ─────────────────────────────────────────────────────────────
    // Fase E: Modelo 1 o Modelo 2 según la etapa del contacto AL RESPONDER. 27-sep-2026
    // (dueño): si el que toca falla (error o respuesta vacía) contesta el otro, y si el
    // Modelo 1 lleva al contacto a una etapa del Modelo 2 (traspaso), esa misma respuesta
    // la escribe el Modelo 2. Un modelo sin llave en este entorno se salta.
    const isAvailable = deps.isModelAvailable ?? ((id: string) => modelAvailability(id).available);
    // Columnas del Embudo vigentes: modelo por etapa, claves de mover_etapa y el bloque
    // de etapas al final de las instrucciones.
    const stages = await listFunnelStages(org);
    const stageAtStart = await loadContactStage(org, conv.contactId);
    // El modelo de cada etapa sale de la tabla de columnas (funnel_stages.model_slot).
    const modelCfg = { modelo1: cfg.modelo1, modeloCerebro: cfg.modeloCerebro, stages };
    const candidates = brainCandidates(modelCfg, stageAtStart, isAvailable);
    const planned = brainModelForStage(modelCfg, stageAtStart);
    if (candidates[0].modelId !== planned.modelId) {
      console.warn(`[agente] ${conv.id}: el Modelo ${planned.slot} (${planned.modelId}) no está disponible aquí; contesta el Modelo ${candidates[0].slot} (${candidates[0].modelId})`);
    }
    // Goal y FAQs con los valores personalizados de esta conversación sustituidos.
    // El mismo armado que usa la renovación de la caché (brain-system.ts).
    const system = await loadBrainSystem(org, cfg.goal, await loadCustomValues(org, conv, cfg), stages, options.responseLength);
    // Contexto del CRM (etapa, cotización y, desde la parte 1, el Detalle ya guardado)
    // en el último turno del cliente. En un traspaso lleva también la etapa a la que pasa.
    const mediaUrls = await mediaUrlsFor(history, deps.resolveImage, options.readImages);
    const detalleContext = await detalleContextFor(org, conv.contactId);
    // «Máximo de envíos por chat» (29-sep-2026): cuántas veces ya salió, p. ej. la tabla (1 de 2).
    const maxPerChatContext = await maxPerChatContextFor(org, conv.id);
    // Un modelo sin lectura de PDF (p. ej. Qwen) recibe el PDF como nota de texto.
    // Opciones del bot: sin imágenes ("[imagen]") o sin notas de voz ("[nota de voz]").
    const messagesFor = async (model: CatalogModel, avanzaA: string | null, nota: string | null = null) =>
      buildModelMessages(history, mediaUrls, {
        cleanText,
        crmContext: [await crmContextFor(org, conv.contactId, stages, avanzaA), detalleContext, maxPerChatContext, workflowNote, nota].filter(Boolean).join("\n"),
        ...(model.pdf ? {} : { maxPdfs: 0 }),
        ...(options.readImages ? {} : { maxImages: 0 }),
        ...(options.transcribeAudio ? {} : { voiceNotesOff: true }),
      });
    // Herramientas (Fase D): una por workflow habilitado con "agente" + fijar_cotizacion.
    const agentTools = await loadAgentTools(org, stages, { id: conv.id, contactId: conv.contactId });
    // ¿Sigue el agente a cargo? Si durante la llamada un vendedor contestó, pausaron
    // al agente o apagaron el canal, no hay tarjeta ni otro intento (ya decidió alguien).
    const stillInCharge = async (): Promise<boolean> => {
      const f = await loadSnapshot(org, conv.id);
      if (!f || f.channel.aiAgentMode !== "auto" || f.conversation.agentState !== "activo") return false;
      return (await humanOutboundCount(org, conv.id)) === humansAtStart;
    };
    // Una llamada al cerebro. Un error del proveedor o una respuesta sin texto ni acciones
    // (tokens agotados, filtro del proveedor…) cuentan como falla; las dos dejan su fila.
    // Modelos ya llamados en esta ronda (la red contra el silencio no le vuelve a preguntar a ninguno).
    const tried = new Set<string>();
    const attempt = async (model: CatalogModel, avanzaA: string | null = null, nota: string | null = null): Promise<BrainOk | BrainFail> => {
      tried.add(model.id);
      const messages = await messagesFor(model, avanzaA, nota);
      const t0 = Date.now();
      let res: CallModelResult;
      try {
        res = await deps.callModel(model.id, { system, messages, tools: agentTools.tools, maxOutputTokens: BRAIN_MAX_OUTPUT_TOKENS, timeoutMs: BRAIN_TIMEOUT_MS });
      } catch (error) {
        await recordAiUsage({ ...base, stage: "cerebro", modelId: model.id, provider: model.provider, usage: null, latencyMs: Date.now() - t0, outcome: "error", error: errorText(error) });
        return { ok: false, model, info: classifyModelError(error, PROVIDER_META[model.provider].label) };
      }
      const latencyMs = Date.now() - t0;
      const out = parseBrainOutput(res.text);
      const { valid, ignored } = validateToolCalls(res.toolCalls ?? [], agentTools);
      // "Nada que agregar" solo vale como complemento de un workflow; fuera de eso es respuesta vacía.
      // En el complemento, una respuesta en blanco también (con el Goal real de staging, Luna y
      // Sonnet a veces contestan vacío en vez de escribir la señal): el workflow ya contestó.
      if (out.kind !== "reply" && !complementOf && valid.length === 0) {
        await recordAiUsage({ ...base, stage: "cerebro", modelId: res.modelId, provider: res.provider, usage: res.usage, latencyMs, outcome: "error", error: `respuesta_vacia (${res.finishReason})` });
        return { ok: false, model, info: EMPTY_RESPONSE_INFO };
      }
      return { ok: true, model, res, out, toolCalls: valid, ignored, latencyMs };
    };
    const usageOf = (r: BrainOk) => ({ ...base, stage: "cerebro" as const, modelId: r.res.modelId, provider: r.res.provider, usage: r.res.usage, latencyMs: r.latencyMs });
    // Red contra el silencio (29-sep-2026, dueño): ¿esta respuesta no le manda NADA al cliente?
    // Sin texto y sin un workflow que mande algo (el que ya salió por palabra clave no cuenta:
    // prepareActions lo quita, igual que al ejecutar). Solo lectura.
    const isSilent = async (r: BrainOk): Promise<boolean> => {
      if (r.out.kind === "reply" && r.out.text.trim()) return false;
      const draft = await prepareActions({ organizationId: org, conversationId: conv.id, calls: r.toolCalls, modelText: "", pendingSince: pending[0]?.createdAt ?? null, stages });
      const sending = await runsThatSend(org, draft.runs.map((run) => run.workflowId));
      return !draft.runs.some((run) => sending.has(run.workflowId));
    };
    // ¿Ya le salió algo al cliente después de su último mensaje? Entonces callar es correcto.
    let answered: boolean | null = null;
    const alreadyAnswered = async (): Promise<boolean> =>
      (answered ??= await sentToClientSinceLastInbound(org, conv.id, pending.map((m) => m.id)));
    // La señal vieja [TRANSFERIR] viaja como aviso para no perderla al cambiar de respuesta.
    const callsOf = (r: BrainOk): ValidToolCall[] =>
      r.out.kind === "reply" && r.out.handover && !r.toolCalls.some((c) => c.kind === "aviso" && c.aviso.motivo === "cliente_pide_humano")
        ? [...r.toolCalls, { kind: "aviso", aviso: { motivo: "cliente_pide_humano", detalle: "El cliente pidió hablar con una persona (señal [TRANSFERIR] del Goal). El agente sigue atendiendo." } }]
        : r.toolCalls;

    // Fase E ("reenvío seguro") + 27-sep-2026: si el modelo falla, contesta el otro. Con un
    // solo modelo disponible, un proveedor SATURADO se reintenta una vez por corrida tras
    // SATURATED_RETRY_MS. Si ya no queda quién conteste, la tarjeta "El agente no pudo
    // responder" y la corrida termina SIN lanzar: ni la cola ni el barrido vuelven a llamar
    // al modelo a ciegas.
    let used: BrainOk | null = null;
    let usedSlot: ModelSlot = candidates[0].slot;
    const failures: BrainFail[] = [];
    for (const [i, candidate] of candidates.entries()) {
      const model = getModel(candidate.modelId);
      if (!model) throw new Error(`modelo ${candidate.slot} desconocido: ${candidate.modelId}`);
      let r = await attempt(model);
      if (!r.ok && candidates.length === 1 && r.info.autoRetry && !saturatedRetryUsed) {
        saturatedRetryUsed = true;
        console.warn(`[agente] ${conv.id}: ${r.info.resumen} Reintento automático en ${SATURATED_RETRY_MS / 1000} s`);
        await deps.sleep(SATURATED_RETRY_MS);
        if (!(await stillInCharge())) return { kind: "skipped", reason: "cambio_durante_error" };
        r = await attempt(model);
      }
      if (r.ok) {
        used = r;
        usedSlot = candidate.slot;
        break;
      }
      failures.push(r);
      if (!(await stillInCharge())) return { kind: "skipped", reason: "cambio_durante_error" };
      const next = candidates[i + 1];
      if (next) console.warn(`[agente] ${conv.id}: ${model.label} falló (${r.info.kind}): ${r.info.resumen} Contesta el Modelo ${next.slot} (${next.modelId})`);
    }
    if (!used) {
      const last = failures[failures.length - 1];
      const body =
        failures.length > 1
          ? bothModelsFailedBody(failures.map((f) => ({ label: f.model.label, info: f.info })))
          : agentErrorBody(last.info, last.model.label, saturatedRetryUsed);
      await recordAgentError({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, body });
      console.warn(`[agente] ${conv.id}: ${failures.length > 1 ? "fallaron los dos modelos" : "el modelo falló"} (${last.info.kind}); tarjeta para el vendedor`);
      return { kind: "failed", reason: last.info.kind };
    }

    // Traspaso (27-sep-2026): el Modelo 1 contestó y, con su respuesta, el contacto pasa a
    // una etapa del Modelo 2 (mover_etapa o datos bancarios), aunque se salte etapas → esa
    // MISMA respuesta la escribe el Modelo 2, con la etapa nueva en el contexto. La etapa
    // que decidió el Modelo 1 se respeta aunque el Modelo 2 no la pida. Si el Modelo 2
    // falla, sale la respuesta del Modelo 1 (el cliente nunca se queda sin respuesta).
    if (usedSlot === 1) {
      const target = handoffStage(modelCfg, stageAtStart, allowedAgentStage(stages, impliedStage(stages, stageSignals(used.toolCalls)), vendorConfirmedPayment));
      const model2 = target ? getModel(cfg.modeloCerebro) : undefined;
      if (target && model2 && model2.id !== used.model.id && isAvailable(model2.id)) {
        const second = await attempt(model2, target);
        // Red contra el silencio: el Modelo 2 no escribió nada, nadie le ha contestado al cliente
        // y el Modelo 1 sí escribió → sale la del Modelo 1 (igual que si el Modelo 2 fallara).
        const secondMute = second.ok && (await isSilent(second)) && !(await isSilent(used)) && !(await alreadyAnswered());
        if (second.ok && secondMute) {
          await recordAiUsage({ ...usageOf(second), outcome: "sin_texto", error: `traspaso sin texto; sale la respuesta de ${used.model.id}` });
          console.warn(`[agente] ${conv.id}: ${model2.label} contestó sin texto en el traspaso; sale la respuesta de ${used.model.label}`);
          // Sus avisos y su Detalle no se pierden (mandan los del Modelo 1, que sí escribió).
          used = { ...used, toolCalls: mergeHandoffToolCalls(callsOf(second), used.toolCalls), ignored: [...used.ignored, ...second.ignored] };
        } else if (second.ok) {
          await recordAiUsage({ ...usageOf(used), outcome: "traspaso", error: `pasa a ${target}: contesta ${model2.id}` });
          console.info(`[agente] ${conv.id}: ${used.model.label} lleva al contacto a ${target}; la respuesta la escribe ${model2.label}`);
          // Las acciones que ya decidió el Modelo 1 (p. ej. el workflow que provocó el traspaso) no se
          // pierden aunque el Modelo 2 no las repita (revisión completa, 27-sep-2026).
          const toolCalls = mergeHandoffToolCalls(used.toolCalls, second.toolCalls);
          toolCalls.push({ kind: "etapa", etapa: target });
          used = { ...second, toolCalls, ignored: [...used.ignored, ...second.ignored] };
        } else {
          console.warn(`[agente] ${conv.id}: ${model2.label} falló en el traspaso (${second.info.kind}); sale la respuesta de ${used.model.label}`);
        }
      }
    }

    // ── Red contra el silencio (29-sep-2026, dueño) ─────────────────────────
    // La respuesta no le manda nada al cliente. (1) Si ya le salió algo después de su último
    // mensaje (p. ej. «Precio 2» por palabra clave, que termina con su pregunta), callar es
    // correcto: no se manda nada más. (2) Si no, escribe el otro modelo (uno que no se haya
    // usado ni fallado en esta ronda), con una nota de que el cliente sigue sin respuesta; las
    // acciones de la primera respuesta (Detalle, avisos, workflows, etapa) no se pierden. (3)
    // Si nadie escribe, no sale nada y el vendedor recibe el aviso "sin_respuesta" (abajo, ya
    // con la respuesta confirmada). Nunca un texto fijo del CRM.
    let silencio: "contestado" | "sin_respuesta" | null = null;
    if (await isSilent(used)) {
      if (await alreadyAnswered()) {
        silencio = "contestado";
      } else {
        const other = candidates.map((c) => getModel(c.modelId)).find((m): m is CatalogModel => m !== undefined && !tried.has(m.id));
        const rescue = other ? await attempt(other, null, SIN_RESPUESTA_NOTE) : null;
        if (rescue?.ok && !(await isSilent(rescue))) {
          await recordAiUsage({ ...usageOf(used), outcome: "sin_texto", error: `sin texto; contesta ${rescue.model.id}` });
          console.warn(`[agente] ${conv.id}: ${used.model.label} contestó solo con acciones; escribe ${rescue.model.label}`);
          const toolCalls = mergeHandoffToolCalls(callsOf(used), callsOf(rescue));
          // La etapa que decidió la primera respuesta se respeta (solo avanza; gana la más adelantada).
          toolCalls.push(...used.toolCalls.filter((c) => c.kind === "etapa"));
          used = { ...rescue, toolCalls, ignored: [...used.ignored, ...rescue.ignored] };
        } else {
          if (rescue?.ok) await recordAiUsage({ ...usageOf(rescue), outcome: "sin_texto", error: `tampoco escribió; sin respuesta (${used.model.id})` });
          silencio = "sin_respuesta";
          console.warn(`[agente] ${conv.id}: ningún modelo le escribió al cliente${other ? "" : " (no hay otro modelo disponible)"}; aviso al vendedor`);
        }
      }
    }
    // ── Pregunta sin contestar, parte 2 (5-oct-2026, dueño) ─────────────────
    // La respuesta era SOLO la pregunta que el cliente dejó sin contestar (p. ej. «Quiero más
    // información» otra vez, o «ha estado lloviendo mucho»). Antes salía tal cual para no dejar
    // al cliente sin respuesta; ahora se pide otra respuesta con una nota (otro modelo o, si no
    // hay, el mismo) y, si tampoco, no sale nada y el vendedor recibe el aviso amarillo. Solo un
    // acuse del cliente («ok», «gracias», 👍, sticker) deja volver a hacerla (Goal: PREGUNTA SIN
    // CONTESTAR). En el complemento de un workflow ya no hay preguntas (withoutClosingQuestions).
    let repetida: string | null = null;
    const lastAsked = complementOf ? null : await lastQuestionAsked(org, conv.id, deps.now());
    const acuse = pending.length > 0 && pending.every((m) => isBareAck(m));
    const onlyRepeat = async (r: BrainOk): Promise<boolean> => {
      if (!lastAsked || acuse || r.out.kind !== "reply" || !r.out.text.trim()) return false;
      // Lo idéntico a lo que ya salió después del último mensaje lo quita el candado de siempre.
      const { keep } = splitRepeated(toBubbles(r.out.text, options.maxBubbles), await outboundTextsSinceLastInbound(org, conv.id));
      if (!onlyRepeatsLastQuestion(keep, lastAsked)) return false;
      // Un workflow que le manda algo al cliente (p. ej. la Tabla) ya es respuesta.
      const draft = await prepareActions({ organizationId: org, conversationId: conv.id, calls: r.toolCalls, modelText: "", pendingSince: pending[0]?.createdAt ?? null, stages });
      const sending = await runsThatSend(org, draft.runs.map((run) => run.workflowId));
      return !draft.runs.some((run) => sending.has(run.workflowId));
    };
    if (lastAsked && (await onlyRepeat(used))) {
      const question = closingQuestion(lastAsked) ?? lastAsked;
      const other = candidates.map((c) => getModel(c.modelId)).find((m): m is CatalogModel => m !== undefined && !tried.has(m.id)) ?? used.model;
      const retry = await attempt(other, null, repeatNote(question));
      if (retry.ok && !(await isSilent(retry)) && !(await onlyRepeat(retry))) {
        await recordAiUsage({ ...usageOf(used), outcome: "repite_pregunta", error: `solo repetía la pregunta sin contestar; contesta ${retry.model.id}` });
        console.warn(`[agente] ${conv.id}: ${used.model.label} solo repetía la pregunta sin contestar; escribe ${retry.model.label}`);
        const toolCalls = mergeHandoffToolCalls(callsOf(used), callsOf(retry));
        toolCalls.push(...used.toolCalls.filter((c) => c.kind === "etapa"));
        used = { ...retry, toolCalls, ignored: [...used.ignored, ...retry.ignored] };
      } else {
        if (retry.ok) await recordAiUsage({ ...usageOf(retry), outcome: "repite_pregunta", error: `también repetía la pregunta o no escribió (${used.model.id})` });
        repetida = question;
        console.warn(`[agente] ${conv.id}: ningún modelo escribió algo distinto a la pregunta sin contestar; no sale y aviso al vendedor`);
        // Sus acciones (Detalle, etapa, avisos) se conservan; el texto no sale.
        used = { ...used, out: { kind: "empty" } };
      }
    }
    const brainUsage = usageOf(used);

    // ── Revisión antes de enviar: ¿llegó algo después de lo que leyó? ────────
    if ((await inboundCount(org, conv.id)) > readCount) {
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale" });
      console.info(`[agente] ${conv.id}: respuesta descartada (entró un mensaje durante la generación), ronda ${round}`);
      continue; // regenerar con TODO el contexto
    }
    // Fase E: si un vendedor movió la etapa durante la generación y con ella cambió
    // el modelo que debe contestar, esta respuesta no sale: se regenera con el correcto.
    const stageNow = await loadContactStage(org, conv.contactId);
    if (stageNow !== stageAtStart && brainCandidates(modelCfg, stageNow, isAvailable)[0].modelId !== candidates[0].modelId) {
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale", error: "cambió la etapa y con ella el modelo" });
      console.info(`[agente] ${conv.id}: respuesta descartada (la etapa cambió a ${stageNow} durante la generación), ronda ${round}`);
      continue;
    }

    // Re-chequeo: durante la generación pudo cambiar el interruptor, el estado
    // o responder un humano.
    const fresh = await loadSnapshot(org, conv.id);
    const freshLastOut = await lastOutbound(org, conv.id);
    if (!fresh || fresh.channel.aiAgentMode !== "auto" || fresh.conversation.agentState !== "activo") {
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "cambió el interruptor o el estado antes de enviar" });
      return { kind: "skipped", reason: "cambio_antes_de_enviar" };
    }
    if ((freshLastOut?.id ?? null) !== (lastOut?.id ?? null)) {
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "otro saliente antes de enviar" });
      if (isHumanReply(freshLastOut)) await pauseForHuman(conv, deps.now());
      return { kind: "skipped", reason: "respuesta_humana" };
    }

    // ── ACCIONES pedidas con herramientas (Fase D) ──────────────────────────
    // Ya validadas contra las herramientas ofrecidas (attempt); un comprobante se
    // verifica AQUÍ (monto contra lo cotizado + referencia): si no cuadra, el texto del
    // modelo se sustituye por uno amable con el motivo. Las corridas salen
    // DESPUÉS de las burbujas.
    const { res: brainRes, out, ignored } = used;
    const toolCalls = [...used.toolCalls];
    if (ignored.length) console.warn(`[agente] ${conv.id}: herramientas ignoradas: ${ignored.join("; ")}`);
    // ── Respuesta que no se pudo completar (5-oct-2026, dueño: «nunca de los nuncas») ──
    // Texto interno escrito como mensaje («[tool call] …», «*(sin acción adicional…)*»), una
    // respuesta cortada por el tope o una acción que pidió y no se puede hacer (datos inválidos,
    // herramienta que no existe): NO sale nada al cliente, nada se ejecuta, el vendedor recibe la
    // tarjeta «El agente no pudo responder» y el Agente IA queda en pausa en este chat hasta que
    // elija Reintentar o Apagar (hasUnresolvedAgentError). Antes salía el texto con un aviso.
    // (El Detalle sin datos válidos no cuenta: es de apoyo y no le promete nada al cliente.)
    const unfinished = unfinishedReply(out.kind === "reply" ? [out.text] : [], brainRes.finishReason, ignored);
    if (unfinished) {
      await recordAiUsage({ ...brainUsage, outcome: "error", error: `no salió: ${unfinished.log}` });
      await recordAgentError({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, body: unfinished.card });
      console.warn(`[agente] ${conv.id}: respuesta sin completar (${unfinished.log}); no sale nada, tarjeta y pausa en el chat`);
      return { kind: "failed", reason: "respuesta_sin_completar" };
    }
    // Solo llamadas, sin texto (algunos modelos lo hacen con tools): NO se lanza. Las
    // acciones corren igual; para un archivo el cliente recibe la media con su pie, y el
    // entrante queda atendido por la fila de uso. Si nada le llega al cliente, la red contra
    // el silencio (arriba) ya pidió otra respuesta o dejó el aviso al vendedor.
    // La señal vieja [TRANSFERIR] del Goal cuenta como aviso_vendedor(cliente_pide_humano).
    if (out.kind === "reply" && out.handover) {
      toolCalls.push({ kind: "aviso", aviso: { motivo: "cliente_pide_humano", detalle: "El cliente pidió hablar con una persona (señal [TRANSFERIR] del Goal). El agente sigue atendiendo." } });
    }
    const plan = await prepareActions({
      organizationId: org,
      conversationId: conv.id,
      calls: toolCalls,
      modelText: out.kind === "reply" ? out.text : "",
      // Un total que la empresa ya le dijo al cliente (p. ej. «Precio 2») también se fija.
      companyTexts: history.filter((m) => m.direction === "out").map((m) => m.body ?? ""),
      pendingSince: pending[0]?.createdAt ?? null,
      stages,
    });
    const actionCtx: ActionContext = { organizationId: org, conversationId: conv.id, contactId: conv.contactId, batchMessageId: lastRead.id, receiptMessageId: receiptMessageId(pending), now, since: pending[0]?.createdAt ?? null, vendorConfirmedPayment };
    // Sin texto del modelo: sale solo lo que manden sus workflows. Si no mandan nada, ya lo
    // resolvió la red contra el silencio (arriba): el CRM nunca escribe un texto fijo.
    let text = out.kind === "reply" ? out.text : "";
    // «El workflow es la respuesta» como herramienta (29-sep-2026, dueño: «Depende»): si pidió un
    // workflow marcado que trae TEXTOS, ese workflow es la respuesta y el texto del modelo no sale
    // (no se le dice lo mismo dos veces); si el workflow solo manda archivos (la Tabla), sí sale.
    const answerRuns = await answerRunsWithText(org, plan.runs.map((r) => r.workflowId));
    const withheld = answerRuns.size && text.trim() ? text.trim() : null;
    if (withheld) text = "";
    // Red contra el silencio, paso 3: nadie le escribió al cliente → aviso al vendedor
    // (amarillo en el Embudo; no pausa al agente). Uno por entrante.
    if (silencio === "sin_respuesta") {
      await addNotice({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, kind: "sin_respuesta", body: SIN_RESPUESTA_BODY });
    }
    if (repetida && !(await alreadyAnswered())) {
      await addNotice({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, kind: "sin_respuesta", body: repeatNoticeBody(repetida) });
    }
    // Parte 1: el Detalle del contacto con lo que dijo el cliente (misma llamada, nunca
    // frena la respuesta; lo del vendedor no se toca).
    const detalle = mergeDetalle(toolCalls);
    if (detalle) {
      try {
        const r = await applyDetalleByAgent(org, conv.contactId, detalle);
        if (r.llenados.length || r.delVendedor.length) {
          console.info(`[agente] ${conv.id}: detalle → ${r.llenados.join(", ") || "sin cambios"}${r.delVendedor.length ? ` (corrigió lo que había puesto un vendedor: ${r.delVendedor.join(", ")})` : ""}`);
        }
      } catch (error) {
        console.error(`[agente] ${conv.id}: el Detalle del contacto no se pudo actualizar`, error);
      }
    }
    // Avisos, comprobante, cotización y etapa ANTES de enviar (idempotentes por el
    // entrante): nunca se le dice al cliente "un asesor te atiende" o "pago recibido"
    // sin que el vendedor lo vea, y un reintento tras el texto no los pierde.
    // El monto de un vendedor solo se reemplaza cuando el total del agente sí salió.
    let deferredQuote: number | null = null;
    if (plan.quote !== null && (await quoteSetByVendor(org, conv.contactId))) {
      deferredQuote = plan.quote;
      plan.quote = null;
    }
    const applyDeferredQuote = async (confirmed: number) => {
      if (deferredQuote === null || confirmed <= 0) return;
      await setQuoteByAgent(org, conv.contactId, deferredQuote).catch((error: unknown) =>
        console.error(`[agente] ${conv.id}: la cotización no se guardó`, error),
      );
    };
    await runActions(plan, actionCtx, deps.startWorkflow, "antes");
    // Mensajes para celular: información y pregunta por separado (máx. 2; Opciones del bot).
    // Candado anti-repetición (28-sep-2026): una burbuja IDÉNTICA a algo que ya salió
    // después del último mensaje del cliente (p. ej. la pregunta de un workflow) no sale
    // otra vez; si no queda ninguna, es como una respuesta de solo acciones.
    // Complemento de un workflow (30-sep-2026): sin preguntas; ahora le toca contestar al cliente
    // (la pregunta del workflow, si la hizo, queda como la última).
    const { keep: drafted, dropped: questions } = text.trim()
      ? complementOf
        ? withoutClosingQuestions(toBubbles(text, options.maxBubbles))
        : { keep: toBubbles(text, options.maxBubbles), dropped: [] }
      : { keep: [], dropped: [] };
    if (questions.length) console.info(`[agente] ${conv.id}: complemento de «${complementOf}» sin preguntas; no sale: «${questions.join(" / ")}»`);
    const { keep: unique, dropped: repeated } = drafted.length
      ? splitRepeated(drafted, await outboundTextsSinceLastInbound(org, conv.id))
      : { keep: [], dropped: [] };
    if (repeated.length) console.info(`[agente] ${conv.id}: no se repite lo que ya salió: «${repeated.join(" / ")}»`);
    // Pregunta sin contestar (3-oct-2026, ./unanswered.ts): si el cliente no contestó la última
    // pregunta y preguntó otra cosa, el Agente IA contesta su duda sin volver a hacer la MISMA
    // pregunta; si solo iba la pregunta, sale (nunca silencio).
    const { keep: sinRepetir, dropped: unanswered } = unique.length
      ? withoutUnansweredRepeat(unique, await lastQuestionAsked(org, conv.id, deps.now()))
      : { keep: [], dropped: [] };
    if (unanswered.length) console.info(`[agente] ${conv.id}: no se repite la pregunta sin contestar: «${unanswered.join(" / ")}»`);
    let bubbles = sinRepetir;
    let stopped: StopReason | null = null;

    // Texto del Agente IA como pie del archivo (1-oct-2026, dueño: «lo puede mandar como texto
    // adjunto al video y ya»). Si su PRIMERA corrida solo manda archivos (un video, la Tabla), el
    // texto va como pie del primero en UN solo mensaje (sin la espera previa de la Tabla): antes
    // salían su frase y luego el archivo con el pie del workflow, que decía lo mismo. Si no cabe en el pie (1,024
    // caracteres de WhatsApp) o la corrida no arranca, el texto sale aparte como siempre.
    let captionedBy: string | null = null;
    const caption = bubbles.join("\n\n");
    const captionRun = bubbles.length && caption.length <= MAX_CAPTION ? await captionRunOf(org, plan.runs) : null;
    if (captionRun) {
      stopped = await stopBeforeBubble(org, conv.id, humansAtStart, readCount);
      if (stopped) {
        bubbles = []; // se resuelve abajo igual que si se detuviera antes del 1er mensaje
      } else {
        const res = await deps.startWorkflow({ organizationId: org, workflowId: captionRun.workflowId, conversationId: conv.id, trigger: "agent", triggerMessageId: lastRead.id, payload: { [AGENT_CAPTION_KEY]: caption }, now: actionCtx.now });
        plan.runs = plan.runs.filter((r) => r !== captionRun);
        if (res.status === "queued") {
          captionedBy = captionRun.slug;
          bubbles = [];
        } else {
          console.info(`[agente] ${conv.id}: «${captionRun.slug}» no salió (${res.reason ?? "omitido"}); su texto sale aparte`);
        }
      }
    }

    // Mensajes con pausa corta. Antes de CADA uno se revisa el estado fresco: si un
    // vendedor respondió (desde el INICIO de la ronda), alguien apagó el canal o
    // pausó al agente, o el cliente escribió, el agente se detiene ahí.
    // Antes del primero se guarda un PLAN durable con todos ("enviando"): si el worker
    // se reinicia a la mitad, el barrido lo concilia; si el 1er mensaje falla, queda
    // GUARDADO para "Reintentar" (parte 1, 26-sep: nunca otra llamada al modelo).
    let sent = 0;
    let unconfirmed = 0;
    const planId =
      bubbles.length > 0
        ? await savePlan({ organizationId: org, conversationId: conv.id, bubbles, runs: plan.runs, triggerMessageId: lastRead.id, now: deps.now() })
        : null;
    // Lo que no alcanzó a salir no se reenvía solo (podría duplicar): tarjeta y el Agente IA
    // en pausa en el chat hasta que el vendedor lo revise (5-oct-2026).
    const noticeRemainder = async (why: string) => {
      await holdAgentForReview({
        organizationId: org,
        conversationId: conv.id,
        messageId: lastRead.id,
        body: `${why} No se envió: «${bubbles.slice(sent).join(" / ")}».`,
      });
    };
    try {
      for (const [i, text] of bubbles.entries()) {
        if (sent > 0) await deps.sleep(BUBBLE_PAUSE_MS);
        stopped = await stopBeforeBubble(org, conv.id, humansAtStart, readCount);
        if (stopped) break;
        const outcome = await deps.sendBubble({ organizationId: org, conversationId: conv.id, text, messageId: bubbleMessageId(planId!, i) });
        sent++;
        // Sin confirmación no se manda el siguiente: el cliente no recibe media respuesta
        // encima de algo que quizá no le llegó (lo resuelve el outbox; si vence, aviso).
        if (outcome.status !== "sent") {
          unconfirmed++;
          break;
        }
      }
    } catch (error) {
      if (sent === 0) {
        // Nada salió. Parte 1 (26-sep): CUALQUIER falla (rechazo del CRM o de WhatsApp,
        // un error raro de Zernio, la BD) deja la respuesta GUARDADA y la tarjeta; ni la
        // cola ni el barrido vuelven a llamar al modelo ("pendiente" cuenta como atendido).
        // "Reintentar" reenvía este mismo texto (resendSavedReply). Si ni la tarjeta se
        // pudo guardar, se lanza: el reintento de la cola encuentra la respuesta guardada
        // y la reenvía, sin generar otra.
        await recordAiUsage({ ...brainUsage, outcome: "error", error: `envío: ${errorText(error)}` });
        await holdForRetry(org, planId!);
        await recordAgentError({ organizationId: org, conversationId: conv.id, messageId: lastRead.id, body: sendErrorBody(sendErrorMotive(error)) });
        console.warn(`[agente] ${conv.id}: el envío falló (${errorText(error)}); respuesta guardada y tarjeta para el vendedor`);
        return { kind: "failed", reason: "envio_fallido" };
      }
      // Salió una parte: el agente sigue activo; el resto queda en un aviso al vendedor.
      await applyDeferredQuote(sent);
      await markAgentReply(org, conv.id, deps.now());
      await supersedeAgentErrors(org, conv.id); // Fase E: el agente volvió a contestar
      if (planId) await closePlan(org, planId, "enviado");
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `mensaje ${sent + 1} no salió: ${errorText(error)}` });
      await noticeRemainder(`Salieron ${sent} de ${bubbles.length} mensajes de la respuesta del agente y el siguiente falló.`);
      // La media que el modelo pidió (tabla, video) sale igual: el cliente ya recibió la primera parte y
      // la esperaba; antes se perdía sin aviso (revisión completa, 27-sep-2026). Idempotente por entrante.
      await runActions(plan, actionCtx, deps.startWorkflow, "despues");
      await pauseAfterHandover(conv, plan, options, deps.now());
      return { kind: "sent", bubbles: sent };
    }
    if (stopped === "entrante_nuevo" && sent === 0) {
      // Nada salió: igual que la revisión antes de enviar, se descarta y se regenera con TODO.
      if (planId) await closePlan(org, planId, "obsoleto");
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale" });
      console.info(`[agente] ${conv.id}: respuesta descartada (entró un mensaje antes del 1er envío), ronda ${round}`);
      continue;
    }
    if (stopped) {
      // Detenido a propósito (humano, canal/estado o mensaje nuevo): el resto ya no
      // aplica. Con "entrante_nuevo" tras ≥1 mensaje, el mensaje nuevo queda
      // pendiente (es posterior a lo enviado) y lo atiende la siguiente corrida.
      if (planId) await closePlan(org, planId, sent > 0 ? "enviado" : "obsoleto");
      if (stopped === "respuesta_humana") await pauseForHuman(conv, deps.now());
      if (sent === 0) {
        await recordAiUsage({ ...brainUsage, outcome: "skipped", error: `detenido antes de enviar: ${stopped}` });
        return { kind: "skipped", reason: stopped };
      }
      await applyDeferredQuote(sent - unconfirmed);
      await markAgentReply(org, conv.id, deps.now());
      await supersedeAgentErrors(org, conv.id); // Fase E: el agente volvió a contestar
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `detenido tras ${sent} mensaje(s): ${stopped}` });
      // Las acciones no se pierden: el pago ya está registrado y su workflow (aviso
      // + etapa) debe correr; cada corrida relee el estado antes de cada paso.
      await runActions(plan, actionCtx, deps.startWorkflow, "despues");
      await pauseAfterHandover(conv, plan, options, deps.now());
      return { kind: "sent", bubbles: sent };
    }
    await applyDeferredQuote(sent - unconfirmed);
    await markAgentReply(org, conv.id, deps.now());
    await supersedeAgentErrors(org, conv.id); // Fase E: el agente volvió a contestar
    if (planId) await closePlan(org, planId, "enviado");
    // Acciones (Fase D), después del texto y solo si el agente no fue detenido:
    // cotización, registro del pago verificado y corridas de workflow (cada corrida
    // relee el estado del agente antes de cada paso). Un fallo aquí no quita la
    // respuesta ya enviada: queda un aviso al vendedor.
    // `now` de la ronda: si un humano movió la etapa DURANTE la generación, manda el humano.
    const after = await runActions(plan, actionCtx, deps.startWorkflow, "despues");
    // El texto del modelo se guardó porque un workflow «es la respuesta» iba a contestar; si ese
    // workflow no arrancó, el cliente se quedaría sin nada: el vendedor ve el texto que no salió.
    const answerSlugs = plan.runs.filter((r) => answerRuns.has(r.workflowId)).map((r) => r.slug);
    if (withheld && !answerSlugs.some((slug) => after?.started.includes(slug))) {
      await holdAgentForReview({
        organizationId: org,
        conversationId: conv.id,
        messageId: lastRead.id,
        body: `El Agente IA iba a contestar con un workflow (${answerSlugs.join(", ")}) que no salió, y su propio texto tampoco: «${withheld}».`,
      });
    }
    // Un mensaje sin confirmar queda en el outbox: si vence como "sin confirmar",
    // el barrido deja un aviso (nunca reenvía a ciegas).
    const omitted = bubbles.length - sent;
    const note = [
      unconfirmed ? `${unconfirmed} mensaje(s) sin confirmar${omitted ? `; ${omitted} sin enviar (aviso)` : ""}` : null,
      complementOf ? `complemento de «${complementOf}»${out.kind !== "reply" ? ": nada que agregar" : ""}` : null,
      questions.length ? `sin preguntas en el complemento; no salió: «${questions.join(" / ")}»` : null,
      repeated.length ? `no se repitió lo que ya salió: «${repeated.join(" / ")}»` : null,
      unanswered.length ? `no se repitió la pregunta sin contestar: «${unanswered.join(" / ")}»` : null,
      withheld ? `el workflow es la respuesta; no salió el texto del modelo: «${withheld.slice(0, 300)}»` : null,
      captionedBy ? `el texto va como pie del archivo de «${captionedBy}»` : null,
      silencio === "contestado" ? "sin texto: ya le había salido algo al cliente después de su último mensaje" : null,
      silencio === "sin_respuesta" ? "sin texto: ningún modelo le escribió al cliente (aviso sin_respuesta)" : null,
      repetida ? `sin texto: solo repetía la pregunta sin contestar «${repetida}» (aviso sin_respuesta)` : null,
    ]
      .filter(Boolean)
      .join("; ");
    await recordAiUsage({ ...brainUsage, outcome: "sent", error: note || null });
    if (unconfirmed && omitted > 0) await noticeRemainder("WhatsApp no confirmó una parte de la respuesta del agente.");
    // "Avisar y pausar X horas" al pedir un asesor (Opciones del bot): al final, ya con
    // el texto enviado y la media encolada.
    await pauseAfterHandover(conv, plan, options, deps.now());
    return { kind: "sent", bubbles: sent };
  }

  // El cliente siguió escribiendo en todas las rondas: de vuelta al debounce.
  const delayMs = await rescheduleDelayFor(org, conversationId, deps.now());
  return { kind: "reschedule", delayMs, reason: "mensajes_nuevos_durante_generacion" };
}
