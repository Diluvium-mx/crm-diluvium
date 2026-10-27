"use server";

// Acciones de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon y Mercado
// Libre): pedir la reseña con el texto fijo (solo Mercado Libre; la de Amazon se pide en Seller
// Central y aquí solo se anota), marcar cómo quedó y guardar los enlaces de las tiendas. La
// organización sale de la sesión; mismos permisos que Opinión (ACL `opinion`).
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
import { SendRejectedError, sendTextMessage } from "@/lib/messaging/send";
import { plainSendReason } from "@/lib/messaging/send-reasons";
import { esHttps } from "@/lib/opiniones/enlaces";
import { enqueueOutboxSend } from "@/lib/queue/outbox";
import { mensajeResena } from "@/lib/resenas-tienda/mensaje";
import { enlacesTiendas, resenaTienda } from "@/lib/resenas-tienda/queries";
import { cambiarEstadoResena, guardarEnlacesTiendas, marcarPedida } from "@/lib/resenas-tienda/store";
import { bloqueoDe } from "@/lib/resenas-tienda/vista";

const RUTA = "/seguimientos";

async function conPermiso(accion: "update"): Promise<ActiveMembership | null> {
  const m = await requireActiveMembership();
  return roleAllows(m.role, "opinion", accion) ? m : null;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });

/** Manda el mensaje fijo que pide la reseña (sin IA) y la marca como pedida. */
export async function pedirResena(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para pedir reseñas." };
    const fila = await resenaTienda(m.organizationId, id);
    if (!fila) return { ok: false, message: "Ese cliente ya no está en la lista." };
    if (fila.estado !== "por_pedir") return { ok: false, message: "A este cliente ya se le pidió la reseña." };
    const now = new Date();
    const bloqueo = bloqueoDe(fila, now);
    if (bloqueo || !fila.conversationId) return { ok: false, message: bloqueo ?? "Ya no está el chat donde lo dijo." };

    const enlaces = await enlacesTiendas(m.organizationId);
    try {
      await sendTextMessage(messagingProvider(), {
        organizationId: m.organizationId,
        conversationId: fila.conversationId,
        sentByUserId: m.userId,
        text: mensajeResena(fila.tienda, enlaces[fila.tienda], now, zoneForPhone(fila.telefono)),
        // Si Zernio pide esperar (429), lo manda el worker.
        deferTo: enqueueOutboxSend,
        // Lo manda un vendedor: en Instagram puede ir hasta 7 días (docs/instagram.md).
        humanAgent: true,
        metadata: { resenaTienda: fila.tienda },
      });
    } catch (error) {
      if (error instanceof SendRejectedError) return { ok: false, message: error.message };
      if (error instanceof MessagingNotConfiguredError) return { ok: false, message: "El canal no está configurado." };
      if (error instanceof SendFailedError && error.outcome === "rejected") {
        return { ok: false, message: `No salió: ${plainSendReason(error.code, error.message)}.` };
      }
      throw error;
    }
    // Como cualquier mensaje del vendedor: el Agente IA se pausa en ese chat.
    await pauseAgentForManualSend(m.organizationId, fila.conversationId);
    await marcarPedida(m.organizationId, id, m.userId, now);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo pedir la reseña", error);
    return { ok: false, message: "No se pudo confirmar el envío. Revisa su chat antes de intentar otra vez." };
  }
}

/** De Amazon: el vendedor la pidió en Seller Central («Solicitar una reseña»); aquí solo queda anotada. */
export async function yaLaPediEnAmazon(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = idSchema.parse(input);
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    const fila = await resenaTienda(m.organizationId, id);
    if (!fila) return { ok: false, message: "Ese cliente ya no está en la lista." };
    if (fila.tienda !== "amazon") return { ok: false, message: "Este cliente no compró en Amazon." };
    if (fila.estado !== "por_pedir") return { ok: false, message: "A este cliente ya se le pidió la reseña." };
    await marcarPedida(m.organizationId, id, m.userId, new Date());
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cliente no válido." };
    logError("[resenas-tienda] no se pudo anotar la de Amazon", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

const estadoSchema = z.object({
  id: z.string().min(1).max(64),
  estado: z.enum(["la_dejo", "no_quiso", "descartada"]),
});

/** «La dejó», «No quiso» o «No compró ahí» (sale de la lista y el lector ya no lo anota). */
export async function marcarResena(input: { id: string; estado: "la_dejo" | "no_quiso" | "descartada" }): Promise<AgentActionResult> {
  try {
    const { id, estado } = estadoSchema.parse(input);
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para cambiar la lista." };
    if (!(await cambiarEstadoResena(m.organizationId, id, estado))) {
      return { ok: false, message: "Ese cliente ya no está en la lista." };
    }
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Cambio no válido." };
    logError("[resenas-tienda] no se pudo cambiar el estado", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

const enlace = z
  .string()
  .trim()
  .max(500, "El enlace es demasiado largo.")
  .refine((v) => v === "" || esHttps(v), "El enlace debe empezar con https://");

const enlacesSchema = z.object({ amazon: enlace, mercadoLibre: enlace });

export async function guardarEnlacesResena(input: { amazon: string; mercadoLibre: string }): Promise<AgentActionResult> {
  try {
    const { amazon, mercadoLibre } = enlacesSchema.parse(input);
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para cambiar los enlaces." };
    await guardarEnlacesTiendas(m.organizationId, { amazon: amazon || null, mercadoLibre: mercadoLibre || null }, m.userId);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Enlace no válido." };
    logError("[resenas-tienda] no se pudieron guardar los enlaces", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}
