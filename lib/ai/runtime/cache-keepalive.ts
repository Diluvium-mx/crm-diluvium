// Renovación de la caché del Agente IA (2-oct-2026, decisión del dueño; las 24 horas desde el 9-oct-2026).
// La regla (cuándo toca) vive en cache-keepalive-core.ts; aquí se arma la petición y se
// registra en ai_usage (etapa "cerebro", resultado "cache_renovada", sin conversación).
// Corre en el barrido de cada minuto del worker.
//
// La petición manda EXACTAMENTE el mismo system (brain-system.ts) y las mismas herramientas
// (loadAgentTools sin conversación: todas las del agente, como en casi todos los chats) que
// una respuesta, más un mensaje mínimo y 1 token de salida: Anthropic solo LEE la caché y
// su reloj de 1 h vuelve a empezar. Si la renovación no encuentra la caché (otro prefijo:
// cambió el Goal, una FAQ o las herramientas), la escribe UNA vez y la sigue renovando; si la
// siguiente tampoco la encuentra, o una renovación falla, no se repite hasta la siguiente
// respuesta real (effectiveTouch). Nunca se paga una escritura cada hora por nada.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, aiUsage } from "@/lib/db/schema";
import { getModel, modelAvailability } from "@/lib/ai";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { loadAgentTools } from "./actions";
import { loadBrainSystem } from "./brain-system";
import { effectiveTouch, keepAliveDue } from "./cache-keepalive-core";
import { loadAgentConfig, orgCustomValues } from "./config";
import { loadBotOptions } from "./options";
import { recordAiUsage } from "./usage";
import { safeErrorMessage } from "@/lib/log/safe-error";

const KEEPALIVE_TIMEOUT_MS = 30_000;
// Solo hace falta mirar las últimas 2 h (la caché dura 1 h).
const LOOKBACK_MS = 2 * 60 * 60_000;

export type KeepAliveDeps = {
  now?: () => Date;
  callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
  isModelAvailable?: (modelId: string) => boolean;
};

const START = (col: typeof aiUsage.createdAt, latency: typeof aiUsage.latencyMs) => sql`${col} - ${latency} * interval '1 millisecond'`;
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

export type CacheState = {
  /** Inicio de la última llamada que leyó o escribió la caché de ese modelo (o null; ver effectiveTouch). */
  touch: Date | null;
  /** Inicio del último intento de renovación, haya salido bien o no (o null). */
  lastAttempt: Date | null;
};

export async function cacheState(organizationId: string, modelId: string, now: Date): Promise<CacheState> {
  const start = START(aiUsage.createdAt, aiUsage.latencyMs);
  // Respuestas que leyeron o escribieron caché; renovaciones solo si de verdad la leyeron.
  const good = sql`(${aiUsage.outcome} is distinct from 'cache_renovada' and (coalesce(${aiUsage.cacheReadTokens}, 0) > 0 or coalesce(${aiUsage.cacheWriteTokens}, 0) > 0))
        or (${aiUsage.outcome} = 'cache_renovada' and coalesce(${aiUsage.cacheReadTokens}, 0) > 0)`;
  // Renovaciones que no la encontraron y la volvieron a escribir.
  const cold = sql`${aiUsage.outcome} = 'cache_renovada' and coalesce(${aiUsage.cacheReadTokens}, 0) = 0 and coalesce(${aiUsage.cacheWriteTokens}, 0) > 0`;
  const [row] = await db
    .select({
      good: sql<string | null>`to_char(max(${start}) filter (where ${good}), ${sql.raw(ISO)})`,
      lastAttempt: sql<string | null>`to_char(max(${start}) filter (where ${aiUsage.outcome} = 'cache_renovada'), ${sql.raw(ISO)})`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.modelId, modelId),
        eq(aiUsage.stage, "cerebro"),
        gte(aiUsage.createdAt, new Date(now.getTime() - LOOKBACK_MS)),
      ),
    );
  const goodAt = row?.good ? new Date(row.good) : null;
  const [colds] = await db
    .select({
      n: sql<number>`count(*)::int`,
      last: sql<string | null>`to_char(max(${start}), ${sql.raw(ISO)})`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.modelId, modelId),
        eq(aiUsage.stage, "cerebro"),
        gte(aiUsage.createdAt, new Date(now.getTime() - LOOKBACK_MS)),
        cold,
        // created_at guarda la hora UTC sin zona (como el to_char de arriba): se compara sin zona.
        goodAt ? sql`${start} > ${goodAt.toISOString()}::timestamp` : sql`true`,
      ),
    );
  return {
    touch: effectiveTouch(goodAt, Number(colds?.n ?? 0), colds?.last ? new Date(colds.last) : null),
    lastAttempt: row?.lastAttempt ? new Date(row.lastAttempt) : null,
  };
}

/** Renueva las cachés que tocan. Devuelve cuántas peticiones mandó. */
export async function keepBrainCacheAlive(deps: KeepAliveDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const isAvailable = deps.isModelAvailable ?? ((id: string) => modelAvailability(id).available);
  const orgs = await db.select({ id: aiConfig.organizationId }).from(aiConfig).where(isNotNull(aiConfig.goal));
  let sent = 0;
  for (const { id: org } of orgs) {
    const cfg = await loadAgentConfig(org);
    if (!cfg.goal) continue;
    // Modelo 1 y Modelo 2 de Anthropic con llave en este entorno (la caché es por modelo).
    const models = [...new Set([cfg.modelo1, cfg.modeloCerebro])].filter((id) => getModel(id)?.provider === "anthropic" && isAvailable(id));
    for (const modelId of models) {
      const state = await cacheState(org, modelId, now);
      // UN intento por cada vez que se tocó la caché: si una renovación falló o no la encontró,
      // no se repite cada minuto; espera a la siguiente respuesta real.
      if (state.touch && state.lastAttempt && state.lastAttempt > state.touch) continue;
      if (!keepAliveDue(now, state.touch)) continue;
      const stages = await listFunnelStages(org);
      const options = await loadBotOptions(org, now);
      const system = await loadBrainSystem(org, cfg.goal, await orgCustomValues(org, cfg), stages, options.responseLength);
      const tools = (await loadAgentTools(org, stages)).tools;
      const base = { organizationId: org, conversationId: null, messageId: null, stage: "cerebro" as const, modelId, provider: "anthropic" as const };
      const t0 = Date.now();
      try {
        const res = await deps.callModel(modelId, {
          system,
          messages: [{ role: "user", content: "." }],
          tools,
          maxOutputTokens: 1,
          timeoutMs: KEEPALIVE_TIMEOUT_MS,
        });
        await recordAiUsage({ ...base, usage: res.usage, latencyMs: Date.now() - t0, outcome: "cache_renovada" });
        sent++;
        if ((res.usage.cacheReadTokens ?? 0) > 0) {
          console.info(`[cache] ${modelId}: caché del Agente IA renovada (${res.usage.cacheReadTokens} tokens leídos)`);
        } else {
          console.warn(`[cache] ${modelId}: la renovación no encontró la caché (cambió el Goal, una FAQ o las herramientas) y la volvió a escribir; se sigue renovando una vez más`);
        }
      } catch (error) {
        // Queda el intento (sin tokens): no se repite hasta la siguiente respuesta real.
        await recordAiUsage({ ...base, usage: null, latencyMs: Date.now() - t0, outcome: "cache_renovada", error: error instanceof Error ? error.message : String(error) });
        console.warn(`[cache] ${modelId}: la renovación falló (${safeErrorMessage(error)})`);
      }
    }
  }
  return sent;
}
