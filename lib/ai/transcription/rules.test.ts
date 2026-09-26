import { describe, expect, it } from "vitest";
import {
  AGENT_TRANSCRIPTION_WAIT_MS,
  shouldTranscribe,
  TRANSCRIBE_MAX_AGE_MS,
  transcripcionMeta,
  transcriptionCostUsd,
  transcriptionWaitMs,
} from "./rules";

const NOW = new Date("2026-09-26T18:00:00Z");
const audio = (over: Partial<Parameters<typeof shouldTranscribe>[0]> = {}) => ({
  direction: "in" as const,
  importedAt: null,
  attachments: [{ type: "audio", url: "/x", storageKey: "org/a.ogg", mimeType: "audio/ogg" }],
  transcripcion: null,
  metadata: null,
  createdAt: new Date(NOW.getTime() - 5_000),
  ...over,
});

describe("reglas de la transcripción (parte 1)", () => {
  it("solo audios NUEVOS del CLIENTE, ya en el bucket; nunca el historial importado ni los salientes", () => {
    expect(shouldTranscribe(audio(), NOW)).toBe(true);
    expect(shouldTranscribe(audio({ importedAt: NOW }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ direction: "out" }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ createdAt: new Date(NOW.getTime() - TRANSCRIBE_MAX_AGE_MS - 1) }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ attachments: [{ type: "audio", url: "/x" }] }), NOW)).toBe(false); // aún sin descargar
    expect(shouldTranscribe(audio({ attachments: [{ type: "image", url: "/x", storageKey: "k" }] }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ transcripcion: "ya" }), NOW)).toBe(false);
  });

  it("un intento cerrado no se repite; uno 'pendiente' de hace más de 2 min sí (worker reiniciado)", () => {
    const meta = (estado: string, agoMs: number) => ({ transcripcion: { estado, at: new Date(NOW.getTime() - agoMs).toISOString() } });
    expect(shouldTranscribe(audio({ metadata: meta("fallida", 1_000) }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ metadata: meta("omitida", 1_000) }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ metadata: meta("pendiente", 10_000) }), NOW)).toBe(false);
    expect(shouldTranscribe(audio({ metadata: meta("pendiente", 3 * 60_000) }), NOW)).toBe(true);
    expect(transcripcionMeta({ transcripcion: { estado: "rara" } })).toBeNull();
  });

  it("espera del agente: hasta 60 s desde que llegó el audio, solo mientras no termine", () => {
    expect(transcriptionWaitMs([audio()], NOW)).toBe(AGENT_TRANSCRIPTION_WAIT_MS - 5_000);
    expect(transcriptionWaitMs([audio({ createdAt: new Date(NOW.getTime() - 61_000) })], NOW)).toBe(0); // se pasó: sigue sin texto
    expect(transcriptionWaitMs([audio({ transcripcion: "hola" })], NOW)).toBe(0);
    expect(transcriptionWaitMs([audio({ metadata: { transcripcion: { estado: "fallida", at: NOW.toISOString() } } })], NOW)).toBe(0);
    expect(transcriptionWaitMs([audio({ importedAt: NOW })], NOW)).toBe(0);
    // Dos audios: manda el más reciente.
    expect(transcriptionWaitMs([audio({ createdAt: new Date(NOW.getTime() - 50_000) }), audio({ createdAt: new Date(NOW.getTime() - 2_000) })], NOW)).toBe(58_000);
  });

  it("costo por minuto de audio (US$0.003/min)", () => {
    expect(transcriptionCostUsd(60)).toBeCloseTo(0.003, 8);
    expect(transcriptionCostUsd(30)).toBeCloseTo(0.0015, 8);
  });
});
