// Payload del aviso "lector.status" (NOTIFY en inbox_events desde lib/ai/runtime/lector.ts)
// → evento del SSE. PURO. Cualquier dato raro descarta el aviso (nunca rompe el hub).
import type { LectorStatusEvent } from "./types";

const PHASES = ["leyendo", "listo", "error"] as const;

export function parseLectorStatus(data: Record<string, unknown>): LectorStatusEvent | null {
  const { contactId, conversationId, phase, cambios } = data;
  if (typeof contactId !== "string" || !contactId || typeof conversationId !== "string" || !conversationId) return null;
  const p = PHASES.find((x) => x === phase);
  if (!p) return null;
  const n = typeof cambios === "number" && Number.isInteger(cambios) && cambios > 0 ? Math.min(cambios, 99) : 0;
  return { type: "lector.status", contactId, conversationId, phase: p, cambios: n };
}
