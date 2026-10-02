"use server";

// Server Actions del interruptor por canal del Agente IA (subpestaña "Canales"
// de la pestaña): Apagado / Encendido. Todos los roles (ACL: recurso `aiConfig`).
// La organización sale de la SESIÓN. Los precios de los modelos son internos
// (lib/ai/pricing.ts + ai_model_prices), solo para calcular el gasto.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { AGENT_MODE_LABEL, agentModeSchema, idSchema, toAgentMode } from "@/lib/agente-ia/settings";
import { logChanges } from "@/lib/historial/log";
import type { ChannelAgentView } from "@/lib/agente-ia/types";

async function requireManage(action: "read" | "update") {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "aiConfig", action)) {
    throw new Error("No tienes permiso para la configuración del Agente IA; pídeselo a un administrador.");
  }
  return membership;
}

export async function setChannelAgentMode(input: { channelId: string; mode: string }): Promise<ChannelAgentView> {
  const { organizationId, userId } = await requireManage("update");
  const mode = agentModeSchema.parse(input.mode);
  const channelId = idSchema.parse(input.channelId);
  const own = and(eq(channels.id, channelId), eq(channels.organizationId, organizationId));
  // El cambio y su fila del historial (Bloque A) en la misma transacción.
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select({ mode: channels.aiAgentMode }).from(channels).where(own).for("update");
    if (!before) return null;
    const [updated] = await tx.update(channels).set({ aiAgentMode: mode, aiAgentModeChangedAt: new Date() }).where(own).returning();
    const from = toAgentMode(before.mode);
    if (from !== mode) {
      await logChanges(tx, {
        organizationId,
        userId,
        kind: "canales",
        action: mode === "auto" ? "encender" : "apagar",
        subject: updated.displayName,
        subjectId: updated.id,
        oldValue: AGENT_MODE_LABEL[from],
        newValue: AGENT_MODE_LABEL[mode],
      });
    }
    return updated;
  });
  if (!row) throw new Error("Canal no encontrado en tu organización.");
  console.info(`[agente] canal ${row.id} → ${mode}`);
  revalidatePath("/agente-ia");
  return { id: row.id, displayName: row.displayName, type: row.type, phoneE164: row.phoneE164, isActive: row.isActive, mode: toAgentMode(row.aiAgentMode) };
}
