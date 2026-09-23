// Orquestador del Agente IA para UNA conversación (Fase B). Lo invoca el
// consumer de la cola (worker.ts) cuando vence el debounce, ya con el candado
// Redis de la conversación tomado. Dependencias inyectables para testearlo.
//
// Flujo: pendientes → idempotencia → compuerta (interruptor, estado, silencio
// por humano, 24h, anti-bucle, tope) → FILTRO → CEREBRO → revisión antes de
// enviar (si entró algo nuevo: descartar y regenerar con TODO el contexto) →
// re-chequeo de la compuerta → envío en burbujas. Cada llamada al modelo deja su
// fila en ai_usage (también las descartadas).
//
// Reglas del dueño (23-sep-2026): el agente SIEMPRE contesta. Lo único que lo pausa
// es la respuesta de un vendedor. La guardia de salida, el pase a humano y los
// frenos solo dejan un AVISO al vendedor en el hilo (notices.ts).
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/catalog";
import { buildBrainSystemWithRuntime, parseBrainOutput } from "./brain";
import { loadAgentConfig, loadEnabledFaqs, type AgentConfig } from "./config";
import {
  agentRepliesSince,
  agentRepliesToContact,
  alreadyHandled,
  humanOutboundCount,
  inboundCount,
  lastOutbound,
  loadSnapshot,
  messageAt,
  modelCallsSince,
  orgSpendSince,
  agentSendUnresolved,
  pendingInbound,
  recentMessages,
  type MessageRow,
} from "./context";
import { buildFilterPrompt, FILTER_SYSTEM, parseFilterDecision } from "./filter";
import { addNotice, NOTICE_REPEAT_MINUTES } from "./notices";
import { decideGate, toBubbles, type NoticeKind } from "./policy";
import { rescheduleDelayFor } from "./schedule";
import { closePlan, markAgentReply, savePlan, setAgentState } from "./state";
import { reviewReply } from "./output-guard";
import { buildModelMessages, toTranscriptLines } from "./transcript";
import { recordAiUsage } from "./usage";

export const MAX_ROUNDS = 3; // regeneraciones por corrida antes de volver al debounce
export const BUBBLE_PAUSE_MS = 1_500;
export const FILTER_MAX_OUTPUT_TOKENS = 200;
// Holgado: algunos modelos (p. ej. Opus 5.5) gastan tokens de razonamiento
// ocultos antes del texto; con un tope corto la respuesta sale vacía.
export const BRAIN_MAX_OUTPUT_TOKENS = 1_024;
// Timeouts por llamada: 3 rondas × (filtro + cerebro) = 4 min < candado de 5 min (process.ts).
export const FILTER_TIMEOUT_MS = 20_000;
export const BRAIN_TIMEOUT_MS = 60_000;
const FILTER_CONTEXT_MESSAGES = 12;
// Pendientes que ve el filtro: los más recientes. Si clasificó "spam" o "lead no
// sigue" nunca hay saliente y la lista crecería sin fin con cada mensaje.
const FILTER_MAX_PENDING = 20;

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

// La ÚNICA pausa del agente: un vendedor contestó en la conversación.
async function pauseForHuman(conversation: { id: string; organizationId: string }, now: Date) {
  await setAgentState(conversation.organizationId, conversation.id, "pausado_humano", { now });
  console.info(`[agente] ${conversation.id}: pausado_humano`);
}

// Texto del aviso cuando un freno de la compuerta no deja responder.
function gateNoticeText(reason: string, cfg: AgentConfig): string {
  switch (reason) {
    case "anti_bucle":
      return `El agente no respondió: llegó a su tope de ${cfg.antiLoopMaxPerHour} respuestas por hora en esta conversación (posible bucle con otro bot). Vuelve a responder cuando baje.`;
    case "tope_de_llamadas":
      return "El agente no respondió: demasiadas llamadas al modelo en la última hora en esta conversación. Vuelve a responder cuando baje.";
    case "presupuesto_diario":
      return `El agente no respondió: se agotó el presupuesto diario de IA (${cfg.dailyBudgetUsd} USD en 24 h). Vuelve a responder cuando baje el gasto.`;
    case "tope_por_contacto":
      return `El agente no respondió: llegó al tope de ${cfg.maxRepliesPerContact ?? 0} respuestas con este contacto.`;
    default:
      return `El agente no respondió (${reason}).`;
  }
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
    // Solo "auto" responde ("borrador" ya no existe: se trata como apagado).
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
    const humanTookOver = cfg.pauseOnHumanReply && isHumanReply(lastOut) && (cut === null || messageAt(lastOut!) > cut);

    if (pending.length === 0) {
      if (humanTookOver && conv.agentState === "activo") await pauseForHuman(conv, now);
      return { kind: "noop", reason: "sin_pendientes" };
    }
    const lastRead = pending[pending.length - 1];
    if (await alreadyHandled(org, lastRead.id)) return { kind: "noop", reason: "ya_atendido" };

    const hourAgo = new Date(now.getTime() - 3_600_000);
    const gate = decideGate({
      channelMode: channel.aiAgentMode,
      agentState: conv.agentState,
      now: now.getTime(),
      windowExpiresAt: conv.windowExpiresAt?.getTime() ?? null,
      humanRepliedSincePending: humanTookOver,
      agentRepliesLastHour: await agentRepliesSince(org, conv.id, hourAgo),
      antiLoopMaxPerHour: cfg.antiLoopMaxPerHour,
      modelCallsLastHour: await modelCallsSince(org, conv.id, hourAgo),
      agentSendUnresolved: await agentSendUnresolved(org, conv.id),
      orgSpendLast24hUsd: await orgSpendSince(org, new Date(now.getTime() - 24 * 3_600_000)),
      dailyBudgetUsd: cfg.dailyBudgetUsd,
      agentRepliesToContact: cfg.maxRepliesPerContact === null ? 0 : await agentRepliesToContact(org, conv.contactId),
      maxRepliesPerContact: cfg.maxRepliesPerContact,
    });
    if (gate.action === "skip") {
      if (gate.pauseTo) await pauseForHuman(conv, now);
      if (gate.notice) {
        await addNotice({
          organizationId: org,
          conversationId: conv.id,
          kind: gate.notice,
          body: gateNoticeText(gate.reason, cfg),
          now,
          dedupeMinutes: NOTICE_REPEAT_MINUTES,
        });
      }
      return { kind: "skipped", reason: gate.reason };
    }
    if (!cfg.goal) return { kind: "skipped", reason: "sin_goal" };

    const readCount = await inboundCount(org, conv.id);
    const context = await recentMessages(org, conv.id, cfg.contextMessages);

    // ── FILTRO ──────────────────────────────────────────────────────────────
    const filterModel = getModel(cfg.modeloFiltro);
    if (!filterModel) throw new Error(`modelo de filtro desconocido: ${cfg.modeloFiltro}`);
    const pendingIds = new Set(pending.map((m) => m.id));
    // El filtro siempre ve los pendientes aunque excedan el contexto corto.
    const filterRows = [...context.slice(-FILTER_CONTEXT_MESSAGES)];
    for (const p of pending.slice(-FILTER_MAX_PENDING)) if (!filterRows.some((r) => r.id === p.id)) filterRows.push(p);
    const base = { organizationId: org, conversationId: conv.id, messageId: lastRead.id };
    let t0 = Date.now();
    let filterRes: CallModelResult;
    try {
      filterRes = await deps.callModel(filterModel.id, {
        system: FILTER_SYSTEM,
        messages: [{ role: "user", content: buildFilterPrompt(toTranscriptLines(filterRows, pendingIds)) }],
        maxOutputTokens: FILTER_MAX_OUTPUT_TOKENS,
        timeoutMs: FILTER_TIMEOUT_MS,
      });
    } catch (error) {
      await recordAiUsage({
        ...base,
        stage: "filtro",
        modelId: filterModel.id,
        provider: filterModel.provider,
        usage: null,
        latencyMs: Date.now() - t0,
        outcome: "error",
        error: errorText(error),
      });
      throw error;
    }
    const filter = parseFilterDecision(filterRes.text);
    // "pasar a humano" ya no calla al agente: el cerebro contesta según el Goal
    // (p. ej. que un asesor lo atenderá) y se avisa al vendedor.
    const skipByFilter = filter.decision === "spam" || filter.decision === "lead_no_sigue";
    await recordAiUsage({
      ...base,
      stage: "filtro",
      modelId: filterRes.modelId,
      provider: filterRes.provider,
      usage: filterRes.usage,
      latencyMs: Date.now() - t0,
      filterDecision: filter.decision,
      outcome: skipByFilter ? "skipped" : "passed",
      error: filter.parsed ? null : `filtro_no_parseable: ${filterRes.text.slice(0, 200)}`,
    });
    if (skipByFilter) return { kind: "skipped", reason: filter.decision };
    const filterHandover = filter.decision === "pasar_a_humano";

    // ── CEREBRO ─────────────────────────────────────────────────────────────
    const brainModel = getModel(cfg.modeloCerebro);
    if (!brainModel) throw new Error(`modelo de cerebro desconocido: ${cfg.modeloCerebro}`);
    const faqs = await loadEnabledFaqs(org);
    const system = buildBrainSystemWithRuntime(cfg.goal, faqs, cfg.maxBubbles);
    const modelMessages = buildModelMessages(context, await imageUrlsFor(context, deps.resolveImage));
    t0 = Date.now();
    let brainRes: CallModelResult;
    try {
      brainRes = await deps.callModel(brainModel.id, {
        system,
        messages: modelMessages,
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
      if (cfg.pauseOnHumanReply && isHumanReply(freshLastOut)) await pauseForHuman(conv, deps.now());
      return { kind: "skipped", reason: "respuesta_humana" };
    }

    const out = parseBrainOutput(brainRes.text);
    if (out.kind === "empty") {
      // Final (no "error"): reintentar cada minuto gastaría sin sentido.
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "respuesta_vacia" });
      return { kind: "skipped", reason: "respuesta_vacia" };
    }
    const bubbles = toBubbles(out.text, cfg.maxBubbles);
    // Guardia de salida: ya NO retiene ni pausa. Un monto o enlace fuera de la base
    // de conocimiento activa solo deja un aviso al vendedor (la respuesta sale igual).
    const guard = reviewReply(out.text, { goal: cfg.goal, faqs });
    // Avisos que acompañan a una respuesta que SÍ salió (al menos una burbuja).
    const noticesAfterSend = async () => {
      const at = deps.now();
      const notices: { kind: NoticeKind; body: string }[] = [];
      if (out.handover || filterHandover) {
        const motivo = filterHandover && filter.motivo ? ` (${filter.motivo})` : "";
        notices.push({
          kind: "pasar_a_humano",
          body: `El cliente pidió atención de un vendedor${motivo}. El agente le avisó y sigue contestando hasta que alguien responda.`,
        });
      }
      if (!guard.ok) notices.push({ kind: "guardia", body: `Revisa la respuesta del agente: ${guard.reason}` });
      for (const n of notices) await addNotice({ organizationId: org, conversationId: conv.id, ...n, now: at });
    };

    // Burbujas con pausa. Antes de CADA burbuja se revisa el estado fresco: si un
    // vendedor respondió (desde el INICIO de la ronda), alguien apagó el canal o
    // pausó al agente, o el cliente escribió, el agente se detiene ahí.
    // Con varias burbujas, antes del primer envío se guarda un PLAN durable con todas
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
      const rest = bubbles.slice(sent);
      await addNotice({
        organizationId: org,
        conversationId: conv.id,
        kind: "envio",
        body: `${why} No se envió: «${rest.join(" / ")}». Revisa el hilo.`,
        now: deps.now(),
      });
    };
    try {
      for (const text of bubbles) {
        if (sent > 0) await deps.sleep(BUBBLE_PAUSE_MS);
        stopped = await stopBeforeBubble(org, conv.id, humansAtStart, readCount);
        if (stopped) break;
        const outcome = await deps.sendBubble({ organizationId: org, conversationId: conv.id, text });
        sent++;
        // Sin confirmación no se manda la siguiente: el cliente no recibe media respuesta
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
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `burbuja ${sent + 1} no salió: ${errorText(error)}` });
      await noticeRemainder(`Se enviaron ${sent} de ${bubbles.length} partes de la respuesta del agente y la siguiente falló.`);
      await noticesAfterSend();
      return { kind: "sent", bubbles: sent };
    }
    if (stopped === "entrante_nuevo" && sent === 0) {
      // Nada salió: igual que la revisión antes de enviar, se descarta y se regenera con TODO.
      if (planId) await closePlan(org, planId, "obsoleto");
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale" });
      console.info(`[agente] ${conv.id}: respuesta descartada (entró un mensaje antes de la 1ª burbuja), ronda ${round}`);
      continue;
    }
    if (stopped) {
      // Detenido a propósito (humano, canal/estado o mensaje nuevo): el resto ya no
      // aplica. Con "entrante_nuevo" tras ≥1 burbuja, el mensaje nuevo queda
      // pendiente (es posterior a lo enviado) y lo atiende la siguiente corrida.
      if (planId) await closePlan(org, planId, sent > 0 ? "enviado" : "obsoleto");
      if (stopped === "respuesta_humana" && cfg.pauseOnHumanReply) await pauseForHuman(conv, deps.now());
      if (sent === 0) {
        await recordAiUsage({ ...brainUsage, outcome: "skipped", error: `detenido antes de enviar: ${stopped}` });
        return { kind: "skipped", reason: stopped };
      }
      await markAgentReply(org, conv.id, deps.now());
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `detenido tras ${sent} burbuja(s): ${stopped}` });
      if (stopped !== "respuesta_humana") await noticesAfterSend();
      return { kind: "sent", bubbles: sent };
    }
    await markAgentReply(org, conv.id, deps.now());
    if (planId) await closePlan(org, planId, "enviado");
    // Una burbuja sin confirmar queda en el outbox: si vence como "sin confirmar",
    // el barrido deja un aviso (nunca reenvía a ciegas).
    const omitted = bubbles.length - sent;
    const note = unconfirmed ? `${unconfirmed} burbuja(s) sin confirmar${omitted ? `; ${omitted} sin enviar (aviso)` : ""}` : null;
    await recordAiUsage({ ...brainUsage, outcome: "sent", error: note });
    if (unconfirmed && omitted > 0) await noticeRemainder("WhatsApp no confirmó una parte de la respuesta del agente.");
    await noticesAfterSend();
    return { kind: "sent", bubbles: sent };
  }

  // El cliente siguió escribiendo en todas las rondas: de vuelta al debounce.
  const delayMs = await rescheduleDelayFor(org, conversationId, deps.now());
  return { kind: "reschedule", delayMs, reason: "mensajes_nuevos_durante_generacion" };
}
