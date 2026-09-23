// Limpieza del anuncio de Click-to-WhatsApp con el FILTRO (Luna), antes del
// cerebro. Solo se llama para los entrantes que traen datos del anuncio; el
// resultado queda guardado en el mensaje (metadata.agenteAnuncio: mensaje limpio +
// resumen del anuncio) para no volver a pagarlo en cada respuesta. Nunca lanza:
// si Luna falla, se usa el respaldo sin modelo y el cliente recibe respuesta igual.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { getModel } from "@/lib/ai/catalog";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";
import { buildAdCleanerPrompt, FILTER_SYSTEM, needsAdCleaning, parseAdCleaner } from "./filter";
import type { MessageRow } from "./context";
import { recordAiUsage } from "./usage";

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

// Texto limpio por id de mensaje (solo los que traían anuncio).
export async function cleanAdMessages(
  rows: readonly MessageRow[],
  ctx: {
    organizationId: string;
    conversationId: string;
    filterModelId: string;
    callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
  },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const m of rows) {
    if (!needsAdCleaning(m)) continue;
    const hit = cached(m);
    if (hit) {
      out.set(m.id, hit.mensaje);
      continue;
    }
    const model = getModel(ctx.filterModelId);
    let clean = parseAdCleaner("", m); // respaldo sin modelo
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
    out.set(m.id, clean.mensaje);
    // Solo se guarda lo que limpió Luna: un respaldo se reintenta en la siguiente respuesta.
    if (clean.parsed) {
      await db
        .update(messages)
        .set({
          metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object(${AD_CLEAN_KEY}::text, jsonb_build_object('mensaje', ${clean.mensaje}::text, 'anuncio', ${clean.anuncio}::text))`,
        })
        .where(and(eq(messages.id, m.id), eq(messages.organizationId, ctx.organizationId)))
        .catch((error: unknown) => console.error(`[agente] no se pudo guardar la limpieza del anuncio de ${m.id}`, error));
    }
  }
  return out;
}
