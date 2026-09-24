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
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/catalog";
import { cleanAdMessages } from "./ad-cleaner";
import { buildBrainSystemWithRuntime, parseBrainOutput } from "./brain";
import { commitPagoBeforeText, executeActions, loadAgentTools, prepareActions, runsThatSend, type StartWorkflow } from "./actions";

// Textos de respaldo del CRM cuando el modelo solo devolvió acciones (sin texto)
// y ninguna manda algo al cliente: el agente SIEMPRE contesta.
export const PAGO_REGISTRADO_TEXT = "¡Gracias! Tu pago quedó registrado ✅ En un momento te confirmamos los siguientes pasos.";
export const SOLO_ACCIONES_TEXT = "Listo 👍 ¿En qué más te ayudo?";
import { validateToolCalls } from "./tools";
import { applyCustomValues } from "@/lib/agente-ia/editor";
import { loadAgentConfig, loadCustomValues, loadEnabledFaqs } from "./config";
import {
  alreadyHandled,
  humanOutboundCount,
  inboundCount,
  lastOutbound,
  loadHistory,
  loadSnapshot,
  messageAt,
  agentSendUnresolved,
  pendingInbound,
  recentInboundImage,
  type MessageRow,
} from "./context";
import { addNotice, ensureHandoverNotice } from "./notices";
import { decideGate, toBubbles } from "./policy";
import { rescheduleDelayFor } from "./schedule";
import { closePlan, markAgentReply, savePlan, setAgentState } from "./state";
import { buildModelMessages, fitHistory } from "./transcript";
import { recordAiUsage } from "./usage";

export const MAX_ROUNDS = 3; // regeneraciones por corrida antes de volver al debounce
export const BUBBLE_PAUSE_MS = 1_500;
// Holgado: algunos modelos (p. ej. Opus 5.5) gastan tokens de razonamiento
// ocultos antes del texto; con un tope corto la respuesta sale vacía.
export const BRAIN_MAX_OUTPUT_TOKENS = 1_024;
// Timeouts por llamada: 3 rondas × (limpieza del anuncio + cerebro) = 4 min < candado
// de 5 min (process.ts). La limpieza del anuncio (ad-cleaner.ts) usa 20 s.
export const FILTER_TIMEOUT_MS = 20_000;
export const BRAIN_TIMEOUT_MS = 60_000;

export type RunDeps = {
  now: () => Date;
  callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
  // Envía UNA burbuja como el agente (source "ai_agent", sin usuario).
  // Devuelve el resultado del proveedor: "pending" = no confirmado (timeout, 5xx); el
  // outbox lo concilia y, si vence sin confirmar, el barrido deja un aviso al vendedor.
  sendBubble: (p: { organizationId: string; conversationId: string; text: string }) => Promise<{ status: "sent" | "pending" }>;
  sleep: (ms: number) => Promise<void>;
  // URL firmada de una imagen del bucket (o null si no se puede).
  resolveImage: (storageKey: string) => Promise<string | null>;
  // Fase D: arranca una corrida de workflow (trigger "agent") pedida por el cerebro.
  startWorkflow: StartWorkflow;
};

export type RunResult =
  | { kind: "noop"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "sent"; bubbles: number }
  | { kind: "reschedule"; delayMs: number; reason: string };

const HUMAN_SOURCES = new Set(["crm", "business_app"]);

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

async function imageUrlsFor(rows: readonly MessageRow[], resolve: RunDeps["resolveImage"]) {
  const urls = new Map<string, string>();
  for (const m of rows) {
    if (m.direction !== "in") continue;
    for (const a of m.attachments) {
      if (a.type !== "image" || !a.storageKey || urls.has(a.storageKey)) continue;
      const url = await resolve(a.storageKey).catch(() => null);
      if (url) urls.set(a.storageKey, url);
    }
  }
  return urls;
}

// ¿Sigue pudiendo enviar el agente? Estado FRESCO justo antes de una burbuja.
type StopReason = "cambio_antes_de_enviar" | "respuesta_humana" | "entrante_nuevo";

async function stopBeforeBubble(
  organizationId: string,
  conversationId: string,
  humansAtCheck: number,
  inboundsAtCheck: number,
): Promise<StopReason | null> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap || snap.channel.aiAgentMode !== "auto" || snap.conversation.agentState !== "activo") {
    return "cambio_antes_de_enviar";
  }
  if ((await humanOutboundCount(organizationId, conversationId)) > humansAtCheck) return "respuesta_humana";
  // El cliente escribió después de lo que leyó el modelo: esta respuesta ya no
  // contesta lo último (y, si saliera, dejaría su mensaje como "atendido").
  if ((await inboundCount(organizationId, conversationId)) > inboundsAtCheck) return "entrante_nuevo";
  return null;
}

// Acciones del cerebro (Fase D): nunca lanzan hacia afuera; lo que no se pudo
// ejecutar queda como aviso al vendedor.
async function runActions(
  plan: import("./actions").ActionPlan,
  ctx: { organizationId: string; conversationId: string; contactId: string; now: Date },
  startWorkflow: StartWorkflow,
): Promise<void> {
  if (!plan.runs.length && plan.quote === null && !plan.notes.length) return;
  try {
    const done = await executeActions(plan, ctx, startWorkflow);
    if (done.started.length || done.skipped.length || done.notes.length) {
      console.info(`[agente] ${ctx.conversationId}: acciones → ${[...done.started, ...done.skipped, ...done.notes].join("; ")}`);
    }
    if (done.skipped.length || done.notes.length) {
      await addNotice({ organizationId: ctx.organizationId, conversationId: ctx.conversationId, kind: "envio", body: `Acción del agente no ejecutada: ${[...done.skipped, ...done.notes].join("; ")}.` });
    }
  } catch (error) {
    console.error(`[agente] ${ctx.conversationId}: acciones fallaron`, error);
    await addNotice({ organizationId: ctx.organizationId, conversationId: ctx.conversationId, kind: "envio", body: `Las acciones del agente (${plan.runs.map((r) => r.slug).join(", ") || "cotización/pago"}) no se ejecutaron: ${errorText(error)}. Revisa el hilo.` });
  }
}

// La ÚNICA pausa del agente: un vendedor contestó en la conversación.
async function pauseForHuman(conversation: { id: string; organizationId: string }, now: Date) {
  await setAgentState(conversation.organizationId, conversation.id, "pausado_humano", { now });
  console.info(`[agente] ${conversation.id}: pausado_humano`);
}

// `job` viene de la cola interna: la organización acota TODAS las lecturas y
// escrituras (una conversación de otra organización no se encuentra: noop).
export async function runAgent(job: { organizationId: string; conversationId: string }, deps: RunDeps): Promise<RunResult> {
  const { organizationId: org, conversationId } = job;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const now = deps.now();
    const snap = await loadSnapshot(org, conversationId);
    if (!snap) return { kind: "noop", reason: "conversacion_no_existe" };
    const { conversation: conv, channel } = snap;
    // Solo "auto" (Encendido) responde; "borrador" ya no existe y cuenta como apagado.
    if (channel.aiAgentMode !== "auto") return { kind: "skipped", reason: "canal_off" };
    const cfg = await loadAgentConfig(org);

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

    if (pending.length === 0) {
      if (humanTookOver && conv.agentState === "activo") await pauseForHuman(conv, now);
      return { kind: "noop", reason: "sin_pendientes" };
    }
    const lastRead = pending[pending.length - 1];
    if (await alreadyHandled(org, lastRead.id)) return { kind: "noop", reason: "ya_atendido" };

    const gate = decideGate({
      channelMode: channel.aiAgentMode,
      agentState: conv.agentState,
      now: now.getTime(),
      windowExpiresAt: conv.windowExpiresAt?.getTime() ?? null,
      humanRepliedSincePending: humanTookOver,
      agentSendUnresolved: await agentSendUnresolved(org, conv.id),
    });
    if (gate.action === "skip") {
      if (gate.pauseTo) await pauseForHuman(conv, now);
      return { kind: "skipped", reason: gate.reason };
    }
    if (!cfg.goal) return { kind: "skipped", reason: "sin_goal" };

    const readCount = await inboundCount(org, conv.id);
    // TODA la conversación; si algún día no cabe en el modelo, lo más reciente.
    const history = fitHistory(await loadHistory(org, conv.id));
    const base = { organizationId: org, conversationId: conv.id, messageId: lastRead.id };

    // ── FILTRO: solo limpia el anuncio de Click-to-WhatsApp (nunca frena) ────
    const cleanText = await cleanAdMessages(history, {
      organizationId: org,
      conversationId: conv.id,
      filterModelId: cfg.modeloFiltro,
      callModel: deps.callModel,
    });

    // ── CEREBRO ─────────────────────────────────────────────────────────────
    const brainModel = getModel(cfg.modeloCerebro);
    if (!brainModel) throw new Error(`modelo de cerebro desconocido: ${cfg.modeloCerebro}`);
    // Goal y FAQs con los valores personalizados de esta conversación sustituidos.
    const values = await loadCustomValues(org, conv, cfg);
    const faqs = (await loadEnabledFaqs(org)).map((f) => ({
      ...f,
      question: applyCustomValues(f.question, values),
      answer: applyCustomValues(f.answer, values),
    }));
    const system = buildBrainSystemWithRuntime(applyCustomValues(cfg.goal, values), faqs);
    const modelMessages = buildModelMessages(history, await imageUrlsFor(history, deps.resolveImage), { cleanText });
    // Herramientas (Fase D): una por workflow habilitado con "agente" + fijar_cotizacion.
    const agentTools = await loadAgentTools(org);
    const t0 = Date.now();
    let brainRes: CallModelResult;
    try {
      brainRes = await deps.callModel(brainModel.id, {
        system,
        messages: modelMessages,
        tools: agentTools.tools,
        maxOutputTokens: BRAIN_MAX_OUTPUT_TOKENS,
        timeoutMs: BRAIN_TIMEOUT_MS,
      });
    } catch (error) {
      await recordAiUsage({
        ...base,
        stage: "cerebro",
        modelId: brainModel.id,
        provider: brainModel.provider,
        usage: null,
        latencyMs: Date.now() - t0,
        outcome: "error",
        error: errorText(error),
      });
      throw error;
    }
    const brainUsage = {
      ...base,
      stage: "cerebro" as const,
      modelId: brainRes.modelId,
      provider: brainRes.provider,
      usage: brainRes.usage,
      latencyMs: Date.now() - t0,
    };

    // ── Revisión antes de enviar: ¿llegó algo después de lo que leyó? ────────
    if ((await inboundCount(org, conv.id)) > readCount) {
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale" });
      console.info(`[agente] ${conv.id}: respuesta descartada (entró un mensaje durante la generación), ronda ${round}`);
      continue; // regenerar con TODO el contexto
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

    const out = parseBrainOutput(brainRes.text);
    // ── ACCIONES pedidas con herramientas (Fase D) ──────────────────────────
    // Se validan contra las herramientas ofrecidas; un comprobante se verifica
    // AQUÍ (monto contra lo cotizado + referencia): si no cuadra, el texto del
    // modelo se sustituye por uno amable con el motivo. Las corridas salen
    // DESPUÉS de las burbujas.
    const { valid: toolCalls, ignored } = validateToolCalls(brainRes.toolCalls ?? [], agentTools);
    if (ignored.length) console.warn(`[agente] ${conv.id}: herramientas ignoradas: ${ignored.join("; ")}`);
    if (out.kind === "empty" && toolCalls.length === 0) {
      // Sin texto (tokens agotados, filtro del proveedor…): NO es final. Se registra
      // como error y la cola/el barrido reintentan: el cliente nunca queda sin respuesta.
      await recordAiUsage({ ...brainUsage, outcome: "error", error: `respuesta_vacia (${brainRes.finishReason})` });
      throw new Error("el cerebro devolvió una respuesta vacía");
    }
    // Solo llamadas, sin texto (algunos modelos lo hacen con tools): NO se lanza
    // (cada reintento sería otra llamada pagada). Las acciones corren igual; para
    // un archivo el cliente recibe la media con su pie, y el entrante queda
    // atendido por la fila de uso.
    const workflowsBySlug = new Map([...agentTools.byName.values()].map((w) => [w.slug, w] as const));
    const plan = await prepareActions({
      organizationId: org,
      conversationId: conv.id,
      contactId: conv.contactId,
      calls: toolCalls,
      workflowsBySlug,
      inboundHasImage: pending.some((m) => m.attachments.some((a) => a.type === "image")) || (await recentInboundImage(org, conv.id)),
      modelText: out.kind === "reply" ? out.text : "",
      pendingSince: pending[0]?.createdAt ?? null,
    });
    // Un pago verificado se registra ANTES de decirle nada al cliente (si falla o
    // la referencia entró dos veces, el texto pasa a ser el amable).
    await commitPagoBeforeText(plan, { organizationId: org, conversationId: conv.id, contactId: conv.contactId, now }, workflowsBySlug, deps.startWorkflow);
    // Sin texto del modelo y sin ninguna acción que mande algo al cliente (solo
    // etapa/cotización/aviso): el cliente no puede quedarse sin respuesta.
    if (!plan.text.trim()) {
      const sending = await runsThatSend(org, plan.runs.map((r) => r.workflowId));
      if (!plan.runs.some((r) => sending.has(r.workflowId))) plan.text = plan.pago ? PAGO_REGISTRADO_TEXT : SOLO_ACCIONES_TEXT;
    }
    for (const w of plan.warnings) await addNotice({ organizationId: org, conversationId: conv.id, kind: "envio", body: w });
    // Mensajes para celular: información y pregunta por separado (máx. 2).
    const bubbles = plan.text.trim() ? toBubbles(plan.text) : [];
    // El cliente pidió a una persona: el aviso al vendedor se guarda ANTES de enviar
    // (idempotente por el entrante): nunca se le dice al cliente que lo atenderán sin
    // que un vendedor lo vea en la Bandeja. El agente sigue activo.
    if (out.kind === "reply" && out.handover) await ensureHandoverNotice({ organizationId: org, conversationId: conv.id, triggerMessageId: lastRead.id });

    // Mensajes con pausa corta. Antes de CADA uno se revisa el estado fresco: si un
    // vendedor respondió (desde el INICIO de la ronda), alguien apagó el canal o
    // pausó al agente, o el cliente escribió, el agente se detiene ahí.
    // Con varios mensajes, antes del primero se guarda un PLAN durable con todos
    // ("enviando"): si el worker se reinicia a la mitad, el barrido lo concilia.
    let sent = 0;
    let unconfirmed = 0;
    let stopped: StopReason | null = null;
    const planId =
      bubbles.length > 1
        ? await savePlan({ organizationId: org, conversationId: conv.id, bubbles, triggerMessageId: lastRead.id, now: deps.now() })
        : null;
    // Lo que no alcanzó a salir no se reenvía solo (podría duplicar): queda en un aviso.
    const noticeRemainder = async (why: string) => {
      await addNotice({
        organizationId: org,
        conversationId: conv.id,
        kind: "envio",
        body: `${why} No se envió: «${bubbles.slice(sent).join(" / ")}». Revisa el hilo.`,
      });
    };
    try {
      for (const text of bubbles) {
        if (sent > 0) await deps.sleep(BUBBLE_PAUSE_MS);
        stopped = await stopBeforeBubble(org, conv.id, humansAtStart, readCount);
        if (stopped) break;
        const outcome = await deps.sendBubble({ organizationId: org, conversationId: conv.id, text });
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
        // Nada salió: el plan no cuenta (obsoleto) y la cola reintenta.
        if (planId) await closePlan(org, planId, "obsoleto");
        await recordAiUsage({ ...brainUsage, outcome: "error", error: `envío: ${errorText(error)}` });
        throw error;
      }
      // Salió una parte: el agente sigue activo; el resto queda en un aviso al vendedor.
      await markAgentReply(org, conv.id, deps.now());
      if (planId) await closePlan(org, planId, "enviado");
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `mensaje ${sent + 1} no salió: ${errorText(error)}` });
      await noticeRemainder(`Salieron ${sent} de ${bubbles.length} mensajes de la respuesta del agente y el siguiente falló.`);
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
      await markAgentReply(org, conv.id, deps.now());
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `detenido tras ${sent} mensaje(s): ${stopped}` });
      // Las acciones no se pierden: el pago ya está registrado y su workflow (aviso
      // + etapa) debe correr; cada corrida relee el estado antes de cada paso.
      await runActions(plan, { organizationId: org, conversationId: conv.id, contactId: conv.contactId, now }, deps.startWorkflow);
      return { kind: "sent", bubbles: sent };
    }
    await markAgentReply(org, conv.id, deps.now());
    if (planId) await closePlan(org, planId, "enviado");
    // Acciones (Fase D), después del texto y solo si el agente no fue detenido:
    // cotización, registro del pago verificado y corridas de workflow (cada corrida
    // relee el estado del agente antes de cada paso). Un fallo aquí no quita la
    // respuesta ya enviada: queda un aviso al vendedor.
    // `now` de la ronda: si un humano movió la etapa DURANTE la generación, manda el humano.
    await runActions(plan, { organizationId: org, conversationId: conv.id, contactId: conv.contactId, now }, deps.startWorkflow);
    // Un mensaje sin confirmar queda en el outbox: si vence como "sin confirmar",
    // el barrido deja un aviso (nunca reenvía a ciegas).
    const omitted = bubbles.length - sent;
    const note = unconfirmed ? `${unconfirmed} mensaje(s) sin confirmar${omitted ? `; ${omitted} sin enviar (aviso)` : ""}` : null;
    await recordAiUsage({ ...brainUsage, outcome: "sent", error: note });
    if (unconfirmed && omitted > 0) await noticeRemainder("WhatsApp no confirmó una parte de la respuesta del agente.");
    return { kind: "sent", bubbles: sent };
  }

  // El cliente siguió escribiendo en todas las rondas: de vuelta al debounce.
  const delayMs = await rescheduleDelayFor(org, conversationId, deps.now());
  return { kind: "reschedule", delayMs, reason: "mensajes_nuevos_durante_generacion" };
}
