// Transcribe la nota de voz de UN mensaje del cliente (Agente IA parte 1, 26-sep-2026).
// La llama el worker justo después de copiar el audio al bucket (worker/index.ts) y el
// barrido para intentos que quedaron a medias. Reglas en ./rules.ts: solo audios del
// cliente, nuevos, nunca el historial importado del celular, tope de 10 minutos.
// El texto va a messages.transcripcion (lo leen el agente y el chat, que se actualiza
// solo por el aviso de la tabla messages); el estado del intento a
// messages.metadata.transcripcion; el costo a ai_usage (etapa "transcripcion").
// Nunca lanza: una falla deja "fallida" y el agente sigue con "[nota de voz sin transcribir]".
import { createOpenAI } from "@ai-sdk/openai";
import { transcribe } from "ai";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { audioDurationSeconds } from "@/lib/audio/duration";
import { PROVIDER_META } from "@/lib/ai/provider";
import { loadBotOptions } from "@/lib/ai/runtime/options";
import { recordAiUsage } from "@/lib/ai/runtime/usage";
import type { ObjectStorage } from "@/lib/storage/s3";
import {
  firstAudio,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  shouldTranscribe,
  TRANSCRIBE_MAX_AGE_MS,
  TRANSCRIBE_TIMEOUT_MS,
  TRANSCRIPTION_CLAIM_MS,
  TRANSCRIPTION_MODEL_ID,
  transcriptionCostUsd,
  type TranscripcionMeta,
} from "./rules";

// Pista para el modelo (no cambia el idioma): mejora números y medidas dictadas.
export const TRANSCRIPTION_PROMPT =
  "Nota de voz de WhatsApp de un cliente en México que pregunta por compuertas contra inundaciones; puede dictar medidas en centímetros o metros.";

export type Transcriber = (audio: Uint8Array) => Promise<{ text: string }>;

export function transcriptionEnabled(): boolean {
  return Boolean(process.env[PROVIDER_META.openai.envKey]);
}

// Llamada directa a OpenAI con la llave de siempre (sin reintentos ocultos del SDK).
export function openaiTranscriber(): Transcriber {
  const apiKey = process.env[PROVIDER_META.openai.envKey];
  return async (audio) => {
    if (!apiKey) throw new Error(`falta ${PROVIDER_META.openai.envKey}`);
    const openai = createOpenAI({ apiKey });
    const result = await transcribe({
      model: openai.transcription(TRANSCRIPTION_MODEL_ID),
      audio,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      providerOptions: { openai: { prompt: TRANSCRIPTION_PROMPT } },
    });
    return { text: result.text };
  };
}

export type TranscribeOutcome =
  | { kind: "no_aplica" }
  | { kind: "en_curso" }
  | { kind: "terminada"; organizationId: string; conversationId: string; estado: "lista" | "fallida" | "omitida"; motivo?: string };

const metaJson = (meta: TranscripcionMeta) => sql`${JSON.stringify(meta)}::jsonb`;

export async function transcribeMessageAudio(
  storage: ObjectStorage,
  messageId: string,
  deps: { transcriber?: Transcriber; now?: () => Date } = {},
): Promise<TranscribeOutcome> {
  const now = deps.now ?? (() => new Date());
  try {
    const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!m || !transcriptionEnabled() || !shouldTranscribe(m, now())) return { kind: "no_aplica" };
    const audio = firstAudio(m.attachments)!;
    const own = and(eq(messages.id, m.id), eq(messages.organizationId, m.organizationId));
    // Opciones del bot → "Responder notas de voz: No": ni se lee ni se paga; queda
    // "omitida" con su motivo (el chat lo muestra) y el agente no la espera.
    if (!(await loadBotOptions(m.organizationId, now())).transcribeAudio) {
      const motivo = "las notas de voz están apagadas en Opciones del bot";
      await db
        .update(messages)
        .set({ metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{transcripcion}', ${metaJson({ estado: "omitida", at: now().toISOString(), motivo })})` })
        .where(and(own, isNull(messages.transcripcion)));
      return { kind: "terminada", organizationId: m.organizationId, conversationId: m.conversationId, estado: "omitida", motivo };
    }
    // Reclamo atómico: dos jobs del mismo mensaje (reintento, barrido) no pagan dos veces.
    const stale = new Date(now().getTime() - TRANSCRIPTION_CLAIM_MS).toISOString();
    const claimed = await db
      .update(messages)
      .set({ metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{transcripcion}', ${metaJson({ estado: "pendiente", at: now().toISOString() })})` })
      .where(
        and(
          own,
          isNull(messages.transcripcion),
          sql`(${messages.metadata}->'transcripcion' is null or (${messages.metadata}->'transcripcion'->>'estado' = 'pendiente' and ${messages.metadata}->'transcripcion'->>'at' < ${stale} and coalesce(${messages.metadata}->'transcripcion'->>'fase', '') <> 'llamada'))`,
        ),
      )
      .returning({ id: messages.id });
    if (claimed.length === 0) return { kind: "en_curso" };

    const finish = async (estado: "lista" | "fallida" | "omitida", extra: { texto?: string; motivo?: string; segundos?: number } = {}) => {
      const meta: TranscripcionMeta = {
        estado,
        at: now().toISOString(),
        ...(extra.motivo ? { motivo: extra.motivo } : {}),
        ...(extra.segundos !== undefined ? { segundos: Math.round(extra.segundos) } : {}),
        ...(estado === "lista" ? { modelo: TRANSCRIPTION_MODEL_ID } : {}),
      };
      await db
        .update(messages)
        .set({
          ...(extra.texto !== undefined ? { transcripcion: extra.texto } : {}),
          metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{transcripcion}', ${metaJson(meta)})`,
        })
        .where(own);
      return { kind: "terminada" as const, organizationId: m.organizationId, conversationId: m.conversationId, estado, ...(extra.motivo ? { motivo: extra.motivo } : {}) };
    };

    let bytes: Uint8Array;
    try {
      bytes = await storage.getBytes(audio.storageKey!, MAX_AUDIO_BYTES);
    } catch (error) {
      const tooBig = /máximo|más de/.test(error instanceof Error ? error.message : "");
      return await finish(tooBig ? "omitida" : "fallida", { motivo: tooBig ? "el archivo pesa más de 25 MB" : "no se pudo leer el audio" });
    }
    const seconds = audioDurationSeconds(bytes, audio.mimeType);
    if (seconds === null) return await finish("omitida", { motivo: "no se pudo leer la duración del audio" });
    if (seconds > MAX_AUDIO_SECONDS) return await finish("omitida", { motivo: "dura más de 10 minutos", segundos: seconds });

    // Fase "llamada" ANTES de pagar: si algo falla después de que OpenAI cobró (o el
    // proceso muere), un reclamo vencido NO vuelve a llamar (cerrarInterrumpidas lo da por
    // fallido). Nunca se cobra dos veces el mismo audio.
    await db
      .update(messages)
      .set({ metadata: sql`jsonb_set(${messages.metadata}, '{transcripcion,fase}', '"llamada"'::jsonb)` })
      .where(own);
    const t0 = Date.now();
    const base = { organizationId: m.organizationId, conversationId: m.conversationId, messageId: m.id, stage: "transcripcion" as const, modelId: TRANSCRIPTION_MODEL_ID, provider: "openai" as const, usage: null };
    let text: string;
    try {
      text = (await (deps.transcriber ?? openaiTranscriber())(bytes)).text.replace(/\s+/g, " ").trim().slice(0, 10_000);
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      await recordAiUsage({ ...base, latencyMs: Date.now() - t0, outcome: "transcripcion_fallida", error: detalle, costUsd: null });
      console.warn(`[transcripcion] ${m.id}: falló (${detalle})`);
      return await finish("fallida", { motivo: "el servicio de transcripción falló", segundos: seconds });
    }
    await recordAiUsage({ ...base, latencyMs: Date.now() - t0, outcome: "transcrita", costUsd: transcriptionCostUsd(seconds) });
    if (!text) return await finish("omitida", { motivo: "no se oyen palabras", segundos: seconds });
    console.info(`[transcripcion] ${m.id}: ${Math.round(seconds)} s transcritos`);
    return await finish("lista", { texto: text, segundos: seconds });
  } catch (error) {
    console.error(`[transcripcion] ${messageId}: error inesperado`, error);
    return { kind: "no_aplica" };
  }
}

// Intentos que quedaron "pendiente" (el worker se reinició a la mitad), dentro de la
// ventana de audios nuevos. Nunca toca audios que jamás se intentaron (el historial).
export async function staleTranscriptionIds(now: Date, limit = 10): Promise<string[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        isNull(messages.transcripcion),
        isNull(messages.importedAt),
        sql`${messages.createdAt} > ${new Date(now.getTime() - TRANSCRIBE_MAX_AGE_MS).toISOString()}::timestamp`,
        sql`${messages.metadata}->'transcripcion'->>'estado' = 'pendiente'`,
        sql`coalesce(${messages.metadata}->'transcripcion'->>'fase', '') <> 'llamada'`,
        sql`${messages.metadata}->'transcripcion'->>'at' < ${new Date(now.getTime() - TRANSCRIPTION_CLAIM_MS).toISOString()}`,
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

// Intentos que ya habían llamado a OpenAI y quedaron a medias (se cayó la BD o el
// proceso después de pagar): se cierran como "fallida" SIN volver a llamar. Devuelve
// cuántos cerró.
export async function closeInterruptedTranscriptions(now: Date): Promise<number> {
  const meta: TranscripcionMeta = { estado: "fallida", at: now.toISOString(), motivo: "la transcripción se interrumpió" };
  const rows = await db
    .update(messages)
    .set({ metadata: sql`jsonb_set(${messages.metadata}, '{transcripcion}', ${metaJson(meta)})` })
    .where(
      and(
        isNull(messages.transcripcion),
        sql`${messages.createdAt} > ${new Date(now.getTime() - 2 * TRANSCRIBE_MAX_AGE_MS).toISOString()}::timestamp`,
        sql`${messages.metadata}->'transcripcion'->>'estado' = 'pendiente'`,
        sql`${messages.metadata}->'transcripcion'->>'fase' = 'llamada'`,
        sql`${messages.metadata}->'transcripcion'->>'at' < ${new Date(now.getTime() - TRANSCRIPTION_CLAIM_MS).toISOString()}`,
      ),
    )
    .returning({ id: messages.id });
  return rows.length;
}
