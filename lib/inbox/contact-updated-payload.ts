// Lectura del payload de `contact.updated` que arma notifyContactUpdated
// (lib/contacts/notify-updated.ts) en el NOTIFY. PURO (sin BD): lo usa el hub del
// SSE (lib/inbox/events.ts). Todo lo que no cuadra se descarta: nunca llega a la
// UI un evento a medias.
import type { ContactChange, ContactChangeActor, ContactUpdatedEvent } from "./types";

const CHANGES: readonly ContactChange[] = ["etapa", "temperatura", "cotizacion", "detalle", "comentarios"];

function isChange(value: unknown): value is ContactChange {
  return typeof value === "string" && (CHANGES as readonly string[]).includes(value);
}

function actorOf(data: Record<string, unknown>): ContactChangeActor | null {
  const { by, byUserId, byName, byRole } = data;
  const userId = typeof byUserId === "string" && byUserId ? byUserId : null;
  if (by === "agente") return { kind: "agente" };
  if (by === "automatizacion") return { kind: "automatizacion", userId };
  if (by === "vendedor" && userId) {
    const name = typeof byName === "string" ? byName : "";
    return typeof byRole === "string" && byRole ? { kind: "vendedor", userId, name, role: byRole } : { kind: "vendedor", userId, name };
  }
  return null;
}

export function parseContactUpdated(data: Record<string, unknown>): ContactUpdatedEvent | null {
  const { contactId, contactName, changes, stageFrom, stageTo, at } = data;
  if (typeof contactId !== "string" || !contactId) return null;
  if (!Array.isArray(changes)) return null;
  const known = [...new Set(changes.filter(isChange))];
  if (known.length === 0) return null;
  const by = actorOf(data);
  if (!by) return null;
  const hasStage = typeof stageFrom === "string" && typeof stageTo === "string";
  // "etapa" sin de → a no sirve (ni para mover la tarjeta ni para el aviso).
  const cleaned = hasStage ? known : known.filter((c) => c !== "etapa");
  if (cleaned.length === 0) return null;
  return {
    type: "contact.updated",
    contactId,
    contactName: typeof contactName === "string" ? contactName : "",
    changes: cleaned,
    ...(hasStage && cleaned.includes("etapa") ? { stage: { from: stageFrom, to: stageTo } } : {}),
    by,
    at: typeof at === "string" ? at : new Date().toISOString(),
  };
}
