"use server";

// Seguimientos del Agente IA (píldora 🤖 del composer): capa delgada sobre lib/followups/view.ts.
// La organización y el usuario salen de la SESIÓN (nunca del cliente). Permiso: cualquier miembro
// (el vendedor es quien lo usa). En modo ensayo nada de esto le manda algo al cliente.
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { localToInstant, validateSendAt, SEND_AT_MESSAGES } from "@/lib/scheduled/rules";
import { approveFollowUp, cancelFollowUpById, changeFollowUpTime, clearSinSeguimientos, loadFollowUpState, reactivateFollowUps, turnOffFollowUps, type FollowUpState } from "@/lib/followups/view";

const id = z.string().trim().min(1).max(100);

export type FollowUpActionResult = { ok: true } | { ok: false; message: string };

/** Lo que muestra la píldora del chat (seguimiento abierto, cancelado o dado de baja), o null (nunca rompe el composer). */
export async function getFollowUp(conversationId: string): Promise<FollowUpState | null> {
  try {
    const { organizationId } = await requireActiveMembership();
    return await loadFollowUpState(organizationId, id.parse(conversationId));
  } catch {
    return null;
  }
}

export async function cancelFollowUp(followUpId: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const ok = await cancelFollowUpById(organizationId, id.parse(followUpId), userId, new Date());
  return ok ? { ok: true } : { ok: false, message: "Ese seguimiento ya no está activo." };
}

/** «Apagar seguimientos en este chat» desde la píldora dormida: queda «Cancelado» hasta «Reactivar seguimientos». */
export async function apagarSeguimientos(conversationId: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const ok = await turnOffFollowUps(organizationId, id.parse(conversationId), userId, new Date());
  return ok ? { ok: true } : { ok: false, message: "Los seguimientos de este chat ya estaban apagados." };
}

/** `local` = "2026-10-05T19:30", hora de Mazatlán (como el 🕒 Programar). */
export async function rescheduleFollowUp(followUpId: string, local: string): Promise<FollowUpActionResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const now = new Date();
  const dueAt = localToInstant(z.string().trim().parse(local));
  const problem = validateSendAt(dueAt, now);
  if (problem || !dueAt) return { ok: false, message: SEND_AT_MESSAGES[problem ?? "invalid"] };
  return changeFollowUpTime(organizationId, id.parse(followUpId), dueAt, userId, now);
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

/** «Reactivar seguimientos» en un chat donde se cancelaron (vendedor o admin; decisión del dueño, 6-oct-2026). */
export async function reactivarSeguimientos(conversationId: string): Promise<FollowUpActionResult> {
  const { organizationId } = await requireActiveMembership();
  const ok = await reactivateFollowUps(organizationId, id.parse(conversationId), new Date());
  return ok ? { ok: true } : { ok: false, message: "Los seguimientos de este chat ya estaban activos." };
}
