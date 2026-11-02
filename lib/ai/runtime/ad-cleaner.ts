// Limpieza del anuncio de Click-to-WhatsApp con el FILTRO (Luna), antes del
// cerebro. Solo se llama para los entrantes que traen datos del anuncio; el
// resultado queda guardado en el mensaje (metadata.agenteAnuncio: mensaje limpio +
// resumen del anuncio) para no volver a pagarlo en cada respuesta. Nunca lanza:
// si Luna falla, se usa el respaldo sin modelo y el cliente recibe respuesta igual.
// Desde el 2-nov-2026 (A2 de la auditoría de velocidad) se limpia en cuanto llega el mensaje, durante la espera de
// la ráfaga (prelimpiarAnuncios, desde el worker): antes iba en fila justo antes de contestar y sumaba ~2.2 s a la
// primera respuesta de cada cliente que llega por anuncio. Si la respuesta lo necesita mientras la limpieza sigue
// en camino, la espera en vez de pedirla otra vez (misma promesa por mensaje).
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { getModel } from "@/lib/ai/catalog";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { buildAdCleanerPrompt, FILTER_SYSTEM, needsAdCleaning, parseAdCleaner } from "./filter";
import type { MessageRow } from "./context";
import { recordAiUsage } from "./usage";
import { loadAgentConfig } from "./config";
import { loadSnapshot, pendingInbound } from "./context";
import { logError } from "@/lib/log/safe-error";

export const AD_CLEAN_KEY = "agenteAnuncio";
export const AD_CLEANER_TIMEOUT_MS = 20_000;
const AD_CLEANER_MAX_OUTPUT_TOKENS = 300;

export type AdClean = { mensaje: string; anuncio: string | null };

function cached(m: MessageRow): AdClean | null {
  const v = (m.metadata as Record<string, unknown> | null)?.[AD_CLEAN_KEY];
  if (!v || typeof v !== "object") return null;
  const { mensaje, anuncio } = v as { mensaje?: unknown; anuncio?: unknown };
  return typeof mensaje === "string" ? { mensaje, anuncio: typeof anuncio === "string" ? anuncio : null } : null;
}

type CleanCtx = {
  organizationId: string;
  conversationId: string;
  filterModelId: string;
  callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
};

// Limpiezas en camino por id de mensaje (en este proceso): quien llega después espera la misma.
const enCurso = new Map<string, Promise<AdClean>>();

// Texto limpio por id de mensaje (solo los que traían anuncio).
export async function cleanAdMessages(rows: readonly MessageRow[], ctx: CleanCtx): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const m of rows) {
    if (!needsAdCleaning(m)) continue;
    const hit = cached(m);
    if (hit) {
      out.set(m.id, hit.mensaje);
      continue;
    }
    let limpieza = enCurso.get(m.id);
    if (!limpieza) {
      limpieza = cleanOne(m, ctx).finally(() => enCurso.delete(m.id));
      enCurso.set(m.id, limpieza);
    }
    out.set(m.id, (await limpieza).mensaje);
  }
  return out;
}

/**
 * Limpia ya (durante la espera de la ráfaga) el anuncio de lo que el cliente acaba de mandar, si el Agente IA lo
 * va a contestar: así, al contestar, ya está guardado. Nunca lanza.
 */
export async function prelimpiarAnuncios(
  input: { organizationId: string; conversationId: string },
  callModel: CleanCtx["callModel"],
): Promise<void> {
  try {
    const snap = await loadSnapshot(input.organizationId, input.conversationId);
    if (!snap || snap.channel.aiAgentMode !== "auto" || snap.sinAgenteIa || snap.conversation.agentState !== "activo") return;
    const porLimpiar = (await pendingInbound(input.organizationId, input.conversationId)).filter((m) => needsAdCleaning(m) && !cached(m));
    if (porLimpiar.length === 0) return;
    const cfg = await loadAgentConfig(input.organizationId);
    await cleanAdMessages(porLimpiar, { ...input, filterModelId: cfg.modeloFiltro, callModel });
  } catch (error) {
    logError(`[agente] no se pudo limpiar antes el anuncio de ${input.conversationId}; se limpia al contestar`, error);
  }
}

async function cleanOne(m: MessageRow, ctx: CleanCtx): Promise<AdClean> {
  const model = getModel(ctx.filterModelId);
  let clean = parseAdCleaner("", m); // respaldo sin modelo
  let answered = false;
  if (model) {
    const t0 = Date.now();
    try {
      const res = await ctx.callModel(model.id, {
        system: FILTER_SYSTEM,
        messages: [{ role: "user", content: buildAdCleanerPrompt(m) }],
        maxOutputTokens: AD_CLEANER_MAX_OUTPUT_TOKENS,
        timeoutMs: AD_CLEANER_TIMEOUT_MS,
      });
      clean = parseAdCleaner(res.text, m);
      answered = true;
      await recordAiUsage({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        messageId: m.id,
        stage: "filtro",
        modelId: res.modelId,
        provider: res.provider,
        usage: res.usage,
        latencyMs: Date.now() - t0,
        filterDecision: "limpieza_anuncio",
        outcome: "passed",
        error: clean.parsed ? null : `filtro_no_parseable: ${res.text.slice(0, 200)}`,
      });
    } catch (error) {
      await recordAiUsage({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        messageId: m.id,
        stage: "filtro",
        modelId: model.id,
        provider: model.provider,
        usage: null,
        latencyMs: Date.now() - t0,
        filterDecision: "limpieza_anuncio",
        outcome: "passed",
        error: `limpieza del anuncio falló (se usó el respaldo): ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  // Se guarda si Luna contestó (aunque no se entendiera: queda el respaldo); si falló
  // la llamada (caída, timeout), se reintenta en la siguiente respuesta.
  if (answered) {
    await db
      .update(messages)
      .set({
        metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object(${AD_CLEAN_KEY}::text, jsonb_build_object('mensaje', ${clean.mensaje}::text, 'anuncio', ${clean.anuncio}::text))`,
      })
      .where(and(eq(messages.id, m.id), eq(messages.organizationId, ctx.organizationId)))
      .catch((error: unknown) => logError(`[agente] no se pudo guardar la limpieza del anuncio de ${m.id}`, error));
  }
  return { mensaje: clean.mensaje, anuncio: clean.anuncio };
}
