// Avisos emergentes de "cambió de etapa" (decisión del dueño, 26-sep-2026). PURO
// (sin React): qué aviso sale por cada evento `contact.updated` y cómo se apilan.
// Reglas:
// - Solo cambios de ETAPA: del Agente IA, de una automatización o de una persona
//   (vendedor, admin u owner). Desde el 29-sep-2026 (pedido del dueño) también le sale a
//   QUIEN hizo el cambio: todos los que tienen el CRM abierto ven el mismo aviso.
// - Cada aviso dura 10 s. Máximo 3 a la vez; si llega otro con 3 a la vista, se
//   juntan en uno ("5 contactos cambiaron de etapa") y los siguientes se suman a él.
// - El mismo contacto otra vez: se actualiza su aviso (no se apila).
// Versión móvil (decisión del dueño, 29-sep-2026): dura 4 s, la persona lleva 🌎 (owner
// o admin) o 👨🏽‍💻 (vendedor) antes de su nombre (`mobileText`) y el aviso agrupado se despliega con cada cambio
// (`items`); mientras está desplegado no vence (`heldKey`).
import type { ContactUpdatedEvent } from "@/lib/inbox/types";

export const TOAST_MS = 10_000;
export const MOBILE_TOAST_MS = 4_000;
export const MAX_TOASTS = 3;

/** Texto del aviso en escritorio (`text`) y en el celular (`mobileText`: el vendedor con 👨🏽‍💻). */
export type StageToastInfo = { contactId: string; text: string; mobileText: string };

export type StageToast =
  | { kind: "single"; key: string; contactId: string; text: string; mobileText: string; expiresAt: number }
  | { kind: "group"; key: string; contactIds: string[]; items: StageToastInfo[]; expiresAt: number };

// "Daniel" de "Daniel López" (como en el ejemplo del dueño).
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * El aviso de este evento para quien lo ve, o null si no le toca. `labelOf`: nombre
 * de la etapa por su clave (las columnas del Embudo son editables; la clave viaja
 * en el evento y el nombre lo pone quien lo muestra).
 */
// `_viewerUserId` se conserva en la firma: antes excluía los cambios propios (regla
// quitada el 29-sep-2026) y así los llamadores no cambian si vuelve a hacer falta.
export function stageToastFor(event: ContactUpdatedEvent, _viewerUserId: string, labelOf: (key: string) => string = (k) => k): StageToastInfo | null {
  if (!event.stage || !event.changes.includes("etapa")) return null;
  const by = event.by;
  const who =
    by.kind === "agente" ? "🤖 Agente IA" : by.kind === "automatizacion" ? "⚙️ Automatización" : firstName(by.name) || "Un vendedor";
  // En el celular la persona lleva su emoji, como el 🤖 del Agente IA: 🌎 owner o admin
  // (decisión del dueño, 29-sep-2026) y 👨🏽‍💻 vendedor.
  const mobileWho = by.kind === "vendedor" ? `${isAdminRole(by.role) ? "🌎" : "👨🏽‍💻"} ${who}` : who;
  const contact = event.contactName.trim() || "un contacto";
  const rest = `movió a ${contact} a ${labelOf(event.stage.to)}`;
  return { contactId: event.contactId, text: `${who} ${rest}`, mobileText: `${mobileWho} ${rest}` };
}

// member.role puede traer varios ("owner,admin"): basta con uno de administrador.
function isAdminRole(role: string | undefined): boolean {
  return (role ?? "").split(",").some((r) => ["owner", "admin"].includes(r.trim()));
}

export function groupText(count: number): string {
  return count === 1 ? "1 contacto cambió de etapa" : `${count} contactos cambiaron de etapa`;
}

/** El último cambio de cada contacto, en orden de llegada (el repetido pasa al final). */
function upsertItem(items: readonly StageToastInfo[], info: StageToastInfo): StageToastInfo[] {
  return [...items.filter((i) => i.contactId !== info.contactId), info];
}

/** Quita los vencidos; `heldKey` (el agrupado desplegado en el celular) no vence mientras siga abierto. */
export function pruneExpired(toasts: readonly StageToast[], now: number, heldKey: string | null = null): StageToast[] {
  return toasts.filter((t) => t.key === heldKey || t.expiresAt > now);
}

/**
 * Agrega un aviso a los que están a la vista (los vencidos se descartan, salvo `heldKey`).
 * `durationMs`: 10 s en escritorio, 4 s en el celular.
 */
export function pushStageToast(
  toasts: readonly StageToast[],
  info: StageToastInfo,
  now: number,
  key: string,
  durationMs: number = TOAST_MS,
  heldKey: string | null = null,
): StageToast[] {
  const live = pruneExpired(toasts, now, heldKey);
  const expiresAt = now + durationMs;
  const group = live.find((t) => t.kind === "group");
  if (group && group.kind === "group") {
    const contactIds = group.contactIds.includes(info.contactId) ? group.contactIds : [...group.contactIds, info.contactId];
    return live.map((t) => (t === group ? { ...group, contactIds, items: upsertItem(group.items, info), expiresAt } : t));
  }
  const same = live.find((t) => t.kind === "single" && t.contactId === info.contactId);
  if (same && same.kind === "single") {
    return [...live.filter((t) => t !== same), { ...same, text: info.text, mobileText: info.mobileText, expiresAt }];
  }
  if (live.length < MAX_TOASTS) {
    return [...live, { kind: "single", key, contactId: info.contactId, text: info.text, mobileText: info.mobileText, expiresAt }];
  }
  let items: StageToastInfo[] = [];
  for (const t of live) {
    if (t.kind === "single") items = upsertItem(items, { contactId: t.contactId, text: t.text, mobileText: t.mobileText });
    else for (const i of t.items) items = upsertItem(items, i);
  }
  items = upsertItem(items, info);
  const contactIds = [...new Set([...live.flatMap((t) => (t.kind === "single" ? [t.contactId] : t.contactIds)), info.contactId])];
  return [{ kind: "group", key, contactIds, items, expiresAt }];
}

/** Al plegar el agrupado en el celular, su tiempo vuelve a contar desde cero. */
export function renewToast(toasts: readonly StageToast[], key: string, now: number, durationMs: number): StageToast[] {
  return toasts.map((t) => (t.key === key ? { ...t, expiresAt: now + durationMs } : t));
}

/** Próximo vencimiento (para programar el único reloj), o null si no hay avisos. `heldKey` no cuenta. */
export function nextExpiry(toasts: readonly StageToast[], heldKey: string | null = null): number | null {
  const pending = toasts.filter((t) => t.key !== heldKey);
  return pending.length ? Math.min(...pending.map((t) => t.expiresAt)) : null;
}
