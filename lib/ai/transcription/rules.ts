// Notas de voz del cliente → texto (Agente IA parte 1, 26-sep-2026). PURO (sin BD):
// constantes, estado del intento y reglas que comparten el worker, el agente y el chat.
//
// Modelo: gpt-4o-mini-transcribe de OpenAI (llave OPENAI_API_KEY que ya existe). Es el
// más económico de OpenAI con buena calidad en español: US$0.003 por minuto (estimado
// oficial), contra 0.0045 de gpt-transcribe y 0.006 de gpt-4o-transcribe y Whisper.
// Fuente: https://developers.openai.com/api/docs/pricing (tabla de transcripción,
// consultada el 26-sep-2026). Si el precio cambia, se cambia aquí.
import type { MessageAttachment } from "@/lib/db/schema";

export const TRANSCRIPTION_MODEL_ID = "gpt-4o-mini-transcribe";
export const TRANSCRIPTION_USD_PER_MINUTE = 0.003;
// Tope del dueño: un audio de más de 10 minutos no se transcribe.
export const MAX_AUDIO_SECONDS = 10 * 60;
// Límite de archivo del endpoint de OpenAI.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// "Solo audios nuevos": un audio que llegó hace más de esto ya no se transcribe (el
// historial viejo nunca; el importado del celular tampoco, por imported_at).
export const TRANSCRIBE_MAX_AGE_MS = 60 * 60_000;
// Un intento "pendiente" más viejo que esto se considera muerto (worker reiniciado).
export const TRANSCRIPTION_CLAIM_MS = 2 * 60_000;
export const TRANSCRIBE_TIMEOUT_MS = 55_000;
// La espera del agente (15 s para juntar mensajes) aguarda la transcripción hasta 60 s
// desde que llegó el audio; después sigue con "[nota de voz sin transcribir]".
export const AGENT_TRANSCRIPTION_WAIT_MS = 60_000;

export type TranscripcionEstado = "pendiente" | "lista" | "fallida" | "omitida";
// messages.metadata.transcripcion: el estado del intento (el texto va en la columna).
export type TranscripcionMeta = { estado: TranscripcionEstado; at: string; motivo?: string; segundos?: number; modelo?: string };

export function transcripcionMeta(metadata: unknown): TranscripcionMeta | null {
  const raw = (metadata as Record<string, unknown> | null)?.transcripcion;
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.estado !== "pendiente" && t.estado !== "lista" && t.estado !== "fallida" && t.estado !== "omitida") return null;
  return {
    estado: t.estado,
    at: typeof t.at === "string" ? t.at : "",
    ...(typeof t.motivo === "string" ? { motivo: t.motivo } : {}),
    ...(typeof t.segundos === "number" ? { segundos: t.segundos } : {}),
    ...(typeof t.modelo === "string" ? { modelo: t.modelo } : {}),
  };
}

type AudioMessage = {
  direction: "in" | "out";
  importedAt: Date | null;
  attachments: readonly MessageAttachment[];
  transcripcion: string | null;
  metadata: unknown;
  createdAt: Date;
};

export function firstAudio(attachments: readonly MessageAttachment[]): MessageAttachment | null {
  return attachments.find((a) => a.type === "audio") ?? null;
}

// ¿Este mensaje se debe transcribir AHORA? Solo audios del CLIENTE, nuevos, no
// importados del celular, ya copiados al bucket y sin intento vigente.
export function shouldTranscribe(m: AudioMessage, now: Date): boolean {
  if (m.direction !== "in" || m.importedAt !== null || m.transcripcion !== null) return false;
  if (now.getTime() - m.createdAt.getTime() > TRANSCRIBE_MAX_AGE_MS) return false;
  const audio = firstAudio(m.attachments);
  if (!audio?.storageKey) return false;
  const meta = transcripcionMeta(m.metadata);
  if (!meta) return true;
  if (meta.estado !== "pendiente") return false;
  const at = Date.parse(meta.at);
  return !Number.isFinite(at) || now.getTime() - at > TRANSCRIPTION_CLAIM_MS;
}

// ¿Cuánto más espera el agente por transcripciones de este lote? 0 = nada que esperar.
// Solo audios del cliente que aún no terminan (sin texto y sin intento cerrado) y que
// llegaron hace menos de AGENT_TRANSCRIPTION_WAIT_MS.
export function transcriptionWaitMs(pending: readonly AudioMessage[], now: Date): number {
  let wait = 0;
  for (const m of pending) {
    if (m.direction !== "in" || m.importedAt !== null || m.transcripcion !== null || !firstAudio(m.attachments)) continue;
    const meta = transcripcionMeta(m.metadata);
    if (meta && meta.estado !== "pendiente") continue;
    const left = m.createdAt.getTime() + AGENT_TRANSCRIPTION_WAIT_MS - now.getTime();
    if (left > wait) wait = left;
  }
  return wait;
}

// Costo de una transcripción (por minuto de audio, como lo cobra OpenAI).
export function transcriptionCostUsd(seconds: number): number {
  return Math.round((seconds / 60) * TRANSCRIPTION_USD_PER_MINUTE * 1e8) / 1e8;
}
