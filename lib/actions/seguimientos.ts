"use server";

// Seguimientos del Agente IA (píldora 🤖 del composer): capa delgada sobre lib/followups/view.ts.
// La organización y el usuario salen de la SESIÓN (nunca del cliente). Permiso: cualquier miembro
// (el vendedor es quien lo usa). En modo ensayo nada de esto le manda algo al cliente.
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { localToInstant, validateSendAt, SEND_AT_MESSAGES } from "@/lib/scheduled/rules";
import { approveFollowUp, cancelFollowUpById, changeFollowUpTime, clearSinSeguimientos, loadFollowUpView, type FollowUpView } from "@/lib/followups/view";

const id = z.string().trim().min(1).max(100);

export type FollowUpActionResult = { ok: true } | { ok: false; message: string };

/** El seguimiento abierto del chat, o null (nunca rompe el composer). */
export async function getFollowUp(conversationId: string): Promise<FollowUpView | null> {
  try {
    const { organizationId } = await requireActiveMembership();
    return await loadFollowUpView(organizationId, id.parse(conversationId));
  } catch {
    return null;
  }
}

export async function cancelFollowUp(followUpId: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const ok = await cancelFollowUpById(organizationId, id.parse(followUpId), userId, new Date());
  return ok ? { ok: true } : { ok: false, message: "Ese seguimiento ya no está activo." };
}

/** `local` = "2026-10-05T19:30", hora de Mazatlán (como el 🕒 Programar). */
export async function rescheduleFollowUp(followUpId: string, local: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const now = new Date();
  const dueAt = localToInstant(z.string().trim().parse(local));
  const problem = validateSendAt(dueAt, now);
  if (problem || !dueAt) return { ok: false, message: SEND_AT_MESSAGES[problem ?? "invalid"] };
  const ok = await changeFollowUpTime(organizationId, id.parse(followUpId), dueAt, userId, now);
  return ok ? { ok: true } : { ok: false, message: "Ese seguimiento ya no está programado." };
}

/** "Que salga solo": el intento sugerido sale a su hora aunque el Agente IA esté en pausa. */
export async function approveSuggestedFollowUp(followUpId: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const ok = await approveFollowUp(organizationId, id.parse(followUpId), userId, new Date());
  return ok ? { ok: true } : { ok: false, message: "Ese seguimiento ya no está pendiente." };
}

/** «Quitar» en el Detalle del contacto: deja de estar «sin seguimientos» (baja de promociones, 131050). */
export async function quitarSinSeguimientos(contactId: string): Promise<FollowUpActionResult> {
  const { organizationId } = await requireActiveMembership();
  const ok = await clearSinSeguimientos(organizationId, id.parse(contactId));
  return ok ? { ok: true } : { ok: false, message: "Ese contacto ya tenía seguimientos." };
}
