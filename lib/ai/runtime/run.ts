// Orquestador del Agente IA para UNA conversación (Fase B). Lo invoca el
// consumer de la cola (worker.ts) cuando vence el debounce, ya con el candado
// Redis de la conversación tomado. Dependencias inyectables para testearlo.
//
// Flujo: pendientes → idempotencia → compuerta (interruptor, estado, silencio
// por humano, 24h, anti-bucle, tope) → FILTRO → CEREBRO → revisión antes de
// enviar (si entró algo nuevo: descartar y regenerar con TODO el contexto) →
// re-chequeo de la compuerta → borrador o envío en burbujas. Cada llamada al
// modelo deja su fila en ai_usage (también las descartadas).
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/catalog";
import { buildBrainSystemWithRuntime, parseBrainOutput } from "./brain";
import { loadAgentConfig, loadEnabledFaqs, type AgentConfig } from "./config";
import {
  agentRepliesSince,
  agentRepliesToContact,
  alreadyHandled,
  inboundCount,
  lastOutbound,
  loadSnapshot,
  messageAt,
  modelCallsSince,
  pendingInbound,
  recentMessages,
  type MessageRow,
} from "./context";
import { buildFilterPrompt, FILTER_SYSTEM, parseFilterDecision } from "./filter";
import { decideGate, pauseElapsed, rescheduleDelayMs, toBubbles, type AgentState } from "./policy";
import { addContactTag, markAgentReply, saveDraft, setAgentState } from "./state";
import { TAG_HANDOVER } from "./tags";
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
  sendBubble: (p: { organizationId: string; conversationId: string; text: string }) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  // URL firmada de una imagen del bucket (o null si no se puede).
  resolveImage: (storageKey: string) => Promise<string | null>;
};

export type RunResult =
  | { kind: "noop"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "handover"; reason: string }
  | { kind: "sent"; bubbles: number }
  | { kind: "draft"; draftId: string }
  | { kind: "reschedule"; delayMs: number; reason: string };

const HUMAN_SOURCES = new Set(["crm", "business_app"]);

function isHumanReply(m: MessageRow | null): boolean {
  return m !== null && m.direction === "out" && HUMAN_SOURCES.has(m.source);
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

async function pause(
  conversation: { id: string; contactId: string },
  state: AgentState,
  now: Date,
  opts: { pausedUntil?: Date | null; tag?: string } = {},
) {
  await setAgentState(conversation.id, state, { now, pausedUntil: opts.pausedUntil ?? null });
  if (opts.tag) await addContactTag(conversation.contactId, opts.tag);
  console.info(`[agente] ${conversation.id}: ${state}${opts.tag ? ` (+etiqueta "${opts.tag}")` : ""}`);
}

async function handover(conversation: { id: string; contactId: string }, cfg: AgentConfig, now: Date) {
  const until = new Date(now.getTime() + cfg.handoverReactivateHours * 3_600_000);
  await pause(conversation, "pausado_handover", now, { pausedUntil: until, tag: TAG_HANDOVER });
}

export async function runAgent(conversationId: string, deps: RunDeps): Promise<RunResult> {
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const now = deps.now();
    const snap = await loadSnapshot(conversationId);
    if (!snap) return { kind: "noop", reason: "conversacion_no_existe" };
    const { conversation: conv, channel } = snap;
    const org = conv.organizationId;
    if (channel.aiAgentMode === "off") return { kind: "skipped", reason: "canal_off" };
    const cfg = await loadAgentConfig(org);

    const pending = await pendingInbound(conv.id);
    const lastOut = await lastOutbound(conv.id);
    const pausedUntilMs = conv.agentPausedUntil?.getTime() ?? null;
    // Un handover vencido se reactiva: su corte es AHORA (lo que el vendedor
    // contestó durante la transferencia era lo esperado, no vuelve a pausar).
    const boundary = pauseElapsed(conv.agentState, pausedUntilMs, now.getTime()) ? now : conv.agentStateChangedAt;
    // "Un vendedor tomó la conversación": el último saliente es humano (CRM o
    // celular) y es posterior al último cambio de estado del agente.
    const humanTookOver =
      cfg.pauseOnHumanReply && isHumanReply(lastOut) && (boundary === null || messageAt(lastOut!) > boundary);

    if (pending.length === 0) {
      if (humanTookOver && conv.agentState === "activo") await pause(conv, "pausado_humano", now);
      return { kind: "noop", reason: "sin_pendientes" };
    }
    const lastRead = pending[pending.length - 1];
    if (await alreadyHandled(lastRead.id)) return { kind: "noop", reason: "ya_atendido" };

    const hourAgo = new Date(now.getTime() - 3_600_000);
    const gate = decideGate({
      channelMode: channel.aiAgentMode,
      agentState: conv.agentState,
      agentPausedUntil: pausedUntilMs,
      now: now.getTime(),
      windowExpiresAt: conv.windowExpiresAt?.getTime() ?? null,
      humanRepliedSincePending: humanTookOver,
      agentRepliesLastHour: await agentRepliesSince(conv.id, hourAgo),
      antiLoopMaxPerHour: cfg.antiLoopMaxPerHour,
      modelCallsLastHour: await modelCallsSince(conv.id, hourAgo),
      agentRepliesToContact: cfg.maxRepliesPerContact === null ? 0 : await agentRepliesToContact(conv.contactId),
      maxRepliesPerContact: cfg.maxRepliesPerContact,
    });
    if (gate.action === "skip") {
      if (gate.pauseTo) await pause(conv, gate.pauseTo, now, { tag: gate.tag });
      return { kind: "skipped", reason: gate.reason };
    }
    if (gate.reactivated) await setAgentState(conv.id, "activo", { now });
    if (!cfg.goal) return { kind: "skipped", reason: "sin_goal" };

    const readCount = await inboundCount(conv.id);
    const context = await recentMessages(conv.id, cfg.contextMessages);

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
    const filterOutcome =
      filter.decision === "necesita_cerebro" ? "passed" : filter.decision === "pasar_a_humano" ? "handover" : "skipped";
    await recordAiUsage({
      ...base,
      stage: "filtro",
      modelId: filterRes.modelId,
      provider: filterRes.provider,
      usage: filterRes.usage,
      latencyMs: Date.now() - t0,
      filterDecision: filter.decision,
      outcome: filterOutcome,
      error: filter.parsed ? null : `filtro_no_parseable: ${filterRes.text.slice(0, 200)}`,
    });
    if (filter.decision === "spam" || filter.decision === "lead_no_sigue") {
      return { kind: "skipped", reason: filter.decision };
    }
    if (filter.decision === "pasar_a_humano") {
      await handover(conv, cfg, now);
      return { kind: "handover", reason: "filtro" };
    }

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
    if ((await inboundCount(conv.id)) > readCount) {
      await recordAiUsage({ ...brainUsage, outcome: "discarded_stale" });
      console.info(`[agente] ${conv.id}: respuesta descartada (entró un mensaje durante la generación), ronda ${round}`);
      continue; // regenerar con TODO el contexto
    }

    // Re-chequeo: durante la generación pudo cambiar el interruptor, el estado
    // o responder un humano.
    const fresh = await loadSnapshot(conv.id);
    const freshLastOut = await lastOutbound(conv.id);
    if (!fresh || fresh.channel.aiAgentMode === "off" || fresh.conversation.agentState !== "activo") {
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "cambió el interruptor o el estado antes de enviar" });
      return { kind: "skipped", reason: "cambio_antes_de_enviar" };
    }
    if ((freshLastOut?.id ?? null) !== (lastOut?.id ?? null)) {
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "otro saliente antes de enviar" });
      if (cfg.pauseOnHumanReply && isHumanReply(freshLastOut)) await pause(conv, "pausado_humano", deps.now());
      return { kind: "skipped", reason: "respuesta_humana" };
    }

    const out = parseBrainOutput(brainRes.text);
    if (out.kind === "handover") {
      await recordAiUsage({ ...brainUsage, outcome: "handover" });
      await handover(conv, cfg, now);
      return { kind: "handover", reason: "cerebro" };
    }
    if (out.kind === "empty") {
      // Final (no "error"): reintentar cada minuto gastaría sin sentido.
      await recordAiUsage({ ...brainUsage, outcome: "skipped", error: "respuesta_vacia" });
      return { kind: "skipped", reason: "respuesta_vacia" };
    }
    const bubbles = toBubbles(out.text, cfg.maxBubbles);

    if (fresh.channel.aiAgentMode === "borrador") {
      const draftId = await saveDraft({
        organizationId: org,
        conversationId: conv.id,
        bubbles,
        triggerMessageId: lastRead.id,
        now: deps.now(),
      });
      await recordAiUsage({ ...brainUsage, outcome: "draft" });
      return { kind: "draft", draftId };
    }

    // auto: burbujas con pausa. Si la PRIMERA falla, nada salió → error y
    // reintento; si falla una posterior, lo enviado ya cuenta (no se duplica).
    let sent = 0;
    try {
      for (const text of bubbles) {
        if (sent > 0) await deps.sleep(BUBBLE_PAUSE_MS);
        await deps.sendBubble({ organizationId: org, conversationId: conv.id, text });
        sent++;
      }
    } catch (error) {
      if (sent === 0) {
        await recordAiUsage({ ...brainUsage, outcome: "error", error: `envío: ${errorText(error)}` });
        throw error;
      }
      await recordAiUsage({ ...brainUsage, outcome: "sent", error: `burbuja ${sent + 1} no salió: ${errorText(error)}` });
      await markAgentReply(conv.id, deps.now());
      return { kind: "sent", bubbles: sent };
    }
    await markAgentReply(conv.id, deps.now());
    await recordAiUsage({ ...brainUsage, outcome: "sent" });
    return { kind: "sent", bubbles: sent };
  }

  // El cliente siguió escribiendo en todas las rondas: de vuelta al debounce.
  const snap = await loadSnapshot(conversationId);
  const pending = snap ? await pendingInbound(conversationId) : [];
  const cfg = snap ? await loadAgentConfig(snap.conversation.organizationId) : null;
  const now = deps.now().getTime();
  const delayMs =
    cfg && pending.length
      ? rescheduleDelayMs({
          now,
          firstPendingAt: pending[0].createdAt.getTime(),
          lastInboundAt: pending[pending.length - 1].createdAt.getTime(),
          responseDelaySeconds: cfg.responseDelaySeconds,
          maxWaitSeconds: cfg.maxWaitSeconds,
        })
      : 0;
  return { kind: "reschedule", delayMs, reason: "mensajes_nuevos_durante_generacion" };
}
