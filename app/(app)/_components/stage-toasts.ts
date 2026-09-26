// Avisos emergentes de "cambió de etapa" (decisión del dueño, 26-sep-2026). PURO
// (sin React): qué aviso sale por cada evento `contact.updated` y cómo se apilan.
// Reglas:
// - Solo cambios de ETAPA hechos por otro: el Agente IA, una automatización u otro
//   vendedor. Nunca el del mismo usuario que lo ve (tampoco su /banco).
// - Cada aviso dura 10 s. Máximo 3 a la vez; si llega otro con 3 a la vista, se
//   juntan en uno ("5 contactos cambiaron de etapa") y los siguientes se suman a él.
// - El mismo contacto otra vez: se actualiza su aviso (no se apila).
import type { ContactUpdatedEvent } from "@/lib/inbox/types";
import { STAGE_LABELS, type Stage } from "../contactos/_data/types";

export const TOAST_MS = 10_000;
export const MAX_TOASTS = 3;

export type StageToastInfo = { contactId: string; text: string };

export type StageToast =
  | { kind: "single"; key: string; contactId: string; text: string; expiresAt: number }
  | { kind: "group"; key: string; contactIds: string[]; expiresAt: number };

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as Stage] ?? stage;
}

// "Daniel" de "Daniel López" (como en el ejemplo del dueño).
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** El aviso de este evento para quien lo ve, o null si no le toca. */
export function stageToastFor(event: ContactUpdatedEvent, viewerUserId: string): StageToastInfo | null {
  if (!event.stage || !event.changes.includes("etapa")) return null;
  const by = event.by;
  if (by.kind !== "agente" && by.userId === viewerUserId) return null;
  const who =
    by.kind === "agente" ? "🤖 Agente IA" : by.kind === "automatizacion" ? "⚙️ Automatización" : firstName(by.name) || "Un vendedor";
  const contact = event.contactName.trim() || "un contacto";
  return { contactId: event.contactId, text: `${who} movió a ${contact} a ${stageLabel(event.stage.to)}` };
}

export function groupText(count: number): string {
  return count === 1 ? "1 contacto cambió de etapa" : `${count} contactos cambiaron de etapa`;
}

/** Agrega un aviso a los que están a la vista (los vencidos se descartan). */
export function pushStageToast(toasts: readonly StageToast[], info: StageToastInfo, now: number, key: string): StageToast[] {
  const live = toasts.filter((t) => t.expiresAt > now);
  const expiresAt = now + TOAST_MS;
  const group = live.find((t) => t.kind === "group");
  if (group && group.kind === "group") {
    const contactIds = group.contactIds.includes(info.contactId) ? group.contactIds : [...group.contactIds, info.contactId];
    return live.map((t) => (t === group ? { ...group, contactIds, expiresAt } : t));
  }
  const same = live.find((t) => t.kind === "single" && t.contactId === info.contactId);
  if (same && same.kind === "single") {
    return [...live.filter((t) => t !== same), { ...same, text: info.text, expiresAt }];
  }
  if (live.length < MAX_TOASTS) {
    return [...live, { kind: "single", key, contactId: info.contactId, text: info.text, expiresAt }];
  }
  const contactIds = [...new Set([...live.flatMap((t) => (t.kind === "single" ? [t.contactId] : t.contactIds)), info.contactId])];
  return [{ kind: "group", key, contactIds, expiresAt }];
}

/** Próximo vencimiento (para programar el único reloj), o null si no hay avisos. */
export function nextExpiry(toasts: readonly StageToast[]): number | null {
  return toasts.length ? Math.min(...toasts.map((t) => t.expiresAt)) : null;
}
