"use server";

// Acciones de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon y Mercado
// Libre). Solo Mercado Libre se pide por WhatsApp: el texto fijo con la ventana abierta o la
// plantilla «Reseña en tienda» con la ventana cerrada. La de Amazon se pide en Seller Central y
// aquí solo se marca («Ya la solicité») o se deshace.
// Cada acción revisa en el servidor que su paso sea el de hoy (`pasoDe`). La organización sale
// de la sesión; mismos permisos que Opinión (ACL `opinion`).
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireActiveMembership, type ActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { zoneForPhone } from "@/lib/followups/timezone";
import { logError } from "@/lib/log/safe-error";
import { MessagingNotConfiguredError, messagingProvider } from "@/lib/messaging";
import { SendFailedError } from "@/lib/messaging/provider";
import { SendRejectedError, sendTemplateMessage, sendTextMessage } from "@/lib/messaging/send";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import { syncTemplatesForOrg } from "@/lib/messaging/templates";
import { enqueueOutboxSend } from "@/lib/queue/outbox";
import { mensajeResena } from "@/lib/resenas-tienda/mensaje";
import { plantillaResenaId, resenaTienda, type ResenaFila } from "@/lib/resenas-tienda/queries";
import { cambiarEstadoResena, marcarPedida, regresarAPorPedir } from "@/lib/resenas-tienda/store";
import { TIENDA_NOMBRE } from "@/lib/resenas-tienda/tiendas";
import { pasoDe, type AccionResena } from "@/lib/resenas-tienda/vista";

const RUTA = "/seguimientos";

async function conPermiso(): Promise<ActiveMembership | null> {
  const m = await requireActiveMembership();
  return roleAllows(m.role, "opinion", "update") ? m : null;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });

type Listo = { m: ActiveMembership; fila: ResenaFila & { conversationId: string }; now: Date };

/** El cliente, si su paso de hoy es justo esta acción; si no, por qué no. */
async function paraAccion(input: { id: string }, accion: AccionResena): Promise<Listo | { ok: false; message: string }> {
  const { id } = idSchema.parse(input);
  const m = await conPermiso();
  if (!m) return { ok: false, message: "No tienes permiso para pedir reseñas." };
  const fila = await resenaTienda(m.organizationId, id);
  if (!fila || fila.estado === "descartada") return { ok: false, message: "Ese cliente ya no está en la lista." };
  const now = new Date();
  const paso = pasoDe(fila, now);
  if (!paso || paso.accion !== accion || !fila.conversationId) {
    return { ok: false, message: paso?.aviso ?? "Ya no se le puede pedir la reseña." };
  }
  return { m, fila: { ...fila, conversationId: fila.conversationId }, now };
}

/** Errores del envío que sí se le explican al vendedor; el resto se relanza. */
function motivoDeEnvio(error: unknown): string | null {
  if (error instanceof SendRejectedError) return error.message;
  if (error instanceof MessagingNotConfiguredError) return "El canal no está configurado.";
  if (error instanceof SendFailedError && error.outcome === "rejected") {
    return `No salió: ${plainSendReason(error.code, error.message)}.`;
  }
  return null;
}

/** Ventana abierta: manda el texto fijo que pide la reseña (sin IA) y la deja como pedida. */
export async function pedirResena(input: { id: string }): Promise<AgentActionResult> {
  try {
    const listo = await paraAccion(input, "texto");
    if (!("m" in listo)) return listo;
    const { m, fila, now } = listo;
    try {
      await sendTextMessage(messagingProvider(), {
        organizationId: m.organizationId,
        conversationId: fila.conversationId,
        sentByUserId: m.userId,
        text: mensajeResena(fila.tienda, now, zoneForPhone(fila.telefono)),
        // Si Zernio pide esperar (429), lo manda el worker.
        deferTo: enqueueOutboxSend,
        // Lo manda un vendedor: en Instagram puede ir hasta 7 días (docs/instagram.md).
        humanAgent: true,
        metadata: { resenaTienda: fila.tienda },
      });
    } catch (error) {
      const motivo = motivoDeEnvio(error);
      if (motivo) return { ok: false, message: motivo };
      throw error;
    }
    // Como cualquier mensaje del vendedor: el Agente IA se pausa en ese chat.
    await pauseAgentForManualSend(m.organizationId, fila.conversationId);
    await marcarPedida(m.organizationId, fila.id, m.userId, now);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo pedir la reseña", error);
    return { ok: false, message: "No se pudo confirmar el envío. Revisa su chat antes de intentar otra vez." };
  }
}

/**
 * Ventana cerrada (WhatsApp): manda la plantilla «Reseña en tienda» con la tienda en {{1}}. No la
 * marca como pedida: cuando el cliente conteste, su paso cambia a «Pedir reseña».
 */
export async function mandarPlantillaResena(input: { id: string }): Promise<AgentActionResult> {
  try {
    const listo = await paraAccion(input, "plantilla");
    if (!("m" in listo)) return listo;
    const { m, fila, now } = listo;
    if (!fila.channelId) return { ok: false, message: "Ya no está el chat donde lo dijo." };
    // Si la plantilla todavía no se ha traído de Meta (se dio de alta fuera del CRM), se trae una vez.
    let templateId = await plantillaResenaId(m.organizationId, fila.channelId);
    if (!templateId) {
      try {
        await syncTemplatesForOrg(m.organizationId);
      } catch (error) {
        logError("[resenas-tienda] no se pudo traer la plantilla de Meta", error);
        return { ok: false, message: "No se pudo traer la plantilla «Reseña en tienda» de Meta. Intenta de nuevo en un momento." };
      }
      templateId = await plantillaResenaId(m.organizationId, fila.channelId);
    }
    if (!templateId) return { ok: false, message: "La plantilla «Reseña en tienda» no está en este número de WhatsApp." };
    try {
      await sendTemplateMessage(messagingProvider(), {
        organizationId: m.organizationId,
        conversationId: fila.conversationId,
        sentByUserId: m.userId,
        templateId,
        variableValues: [TIENDA_NOMBRE[fila.tienda]],
        metadata: { resenaTienda: fila.tienda },
        deferTo: enqueueOutboxSend,
        now,
      });
    } catch (error) {
      const motivo = motivoDeEnvio(error);
      if (motivo) return { ok: false, message: motivo };
      throw error;
    }
    await pauseAgentForManualSend(m.organizationId, fila.conversationId);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo mandar la plantilla", error);
    return { ok: false, message: "No se pudo confirmar el envío. Revisa su chat antes de intentar otra vez." };
  }
}

/** Amazon: el vendedor ya tocó «Solicitar una reseña» › «Sí» en Seller Central; pasa a Solicitadas. */
export async function yaLaSolicite(input: { id: string }): Promise<AgentActionResult> {
  try {
    const listo = await paraAccion(input, "amazon");
    if (!("m" in listo)) return listo;
    const { m, fila, now } = listo;
    await marcarPedida(m.organizationId, fila.id, m.userId, now);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo marcar la de Amazon", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

/** Amazon: «Deshacer» de «Ya la solicité» (si se marcó por error); regresa a Por solicitar. */
export async function deshacerSolicitada(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso();
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    if (!(await regresarAPorPedir(m.organizationId, id))) {
      return { ok: false, message: "Ese cliente ya no está en Solicitadas." };
    }
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo deshacer la de Amazon", error);
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
