"use server";

// Acciones de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § 8). Desde el 6-nov-2026
// el CRM ya no manda nada: el vendedor escribe desde WhatsApp Web con los mensajes listos y aquí
// solo marca «Ya le escribí» (o lo deshace), elige el trato (Sr. · Sra. · solo su nombre) o lo
// quita de la lista. La organización sale de la sesión; mismos permisos que Opinión (ACL `opinion`).
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireActiveMembership, type ActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { logError } from "@/lib/log/safe-error";
import { resenaTienda } from "@/lib/resenas-tienda/queries";
import { cambiarEstadoResena, cambiarTrato, marcarPedida, regresarAPorPedir } from "@/lib/resenas-tienda/store";
import { TRATOS } from "@/lib/resenas-tienda/tiendas";
import { pasoDe } from "@/lib/resenas-tienda/vista";

const RUTA = "/seguimientos";

async function conPermiso(): Promise<ActiveMembership | null> {
  const m = await requireActiveMembership();
  return roleAllows(m.role, "opinion", "update") ? m : null;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });
const tratoSchema = idSchema.extend({ trato: z.enum(TRATOS).nullable() });

/**
 * Ya le escribió por WhatsApp Web: pasa a Solicitadas. Como WhatsApp Web no avisa al CRM de lo que
 * se manda desde ahí, el Agente IA se pausa en su chat para que no le conteste él.
 */
export async function yaLeEscribi(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso();
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    const fila = await resenaTienda(m.organizationId, id);
    if (!fila || fila.estado === "descartada") return { ok: false, message: "Ese cliente ya no está en la lista." };
    const now = new Date();
    const paso = pasoDe(fila, now);
    if (paso.seccion !== "pedir") return { ok: false, message: paso.aviso };
    await marcarPedida(m.organizationId, fila.id, m.userId, now);
    if (fila.conversationId) await pauseAgentForManualSend(m.organizationId, fila.conversationId);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo marcar «Ya le escribí»", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

/** «Deshacer» de «Ya le escribí» (si se marcó por error); regresa a Por solicitar. */
export async function deshacerEscribi(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso();
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    const fila = await resenaTienda(m.organizationId, id);
    // Las de Amazon pedidas en Seller Central no regresan: Amazon no deja volver a pedirla.
    if (!fila || pasoDe(fila, new Date()).marca !== "deshacer" || !(await regresarAPorPedir(m.organizationId, id))) {
      return { ok: false, message: "Ese cliente ya no está en Solicitadas." };
    }
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo deshacer «Ya le escribí»", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

/** Sr. · Sra. · solo su nombre (null): cambia el saludo de sus mensajes. */
export async function elegirTrato(input: { id: string; trato: string | null }): Promise<AgentActionResult> {
  try {
    const { id, trato } = tratoSchema.parse(input);
    const m = await conPermiso();
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    if (!(await cambiarTrato(m.organizationId, id, trato))) return { ok: false, message: "Ese cliente ya no está en la lista." };
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Opción no válida." };
    logError("[resenas-tienda] no se pudo guardar el trato", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

/** Quita al cliente de la lista (el Agente IA se equivocó o ya no se le va a pedir): el lector ya no lo vuelve a anotar. */
export async function quitarResena(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso();
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    if (!(await cambiarEstadoResena(m.organizationId, id, "descartada"))) {
      return { ok: false, message: "Ese cliente ya no está en la lista." };
    }
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo quitar de la lista", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}
