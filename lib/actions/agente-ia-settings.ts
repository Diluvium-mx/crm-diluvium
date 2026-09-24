"use server";

// Server Actions del interruptor por canal del Agente IA (sección "Implementar"
// de la pestaña): Apagado / Encendido. Solo owner/admin (ACL: recurso `aiConfig`).
// La organización sale de la SESIÓN. Los precios de los modelos son internos
// (lib/ai/pricing.ts + ai_model_prices), solo para calcular el gasto.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { agentModeSchema, idSchema, toAgentMode } from "@/lib/agente-ia/settings";
import type { ChannelAgentView } from "@/lib/agente-ia/types";

async function requireManage(action: "read" | "update") {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "aiConfig", action)) {
    throw new Error("No tienes permiso para la configuración del Agente IA; pídeselo a un administrador.");
  }
  return membership;
}

export async function setChannelAgentMode(input: { channelId: string; mode: string }): Promise<ChannelAgentView> {
  const { organizationId } = await requireManage("update");
  const mode = agentModeSchema.parse(input.mode);
  const channelId = idSchema.parse(input.channelId);
  const [row] = await db
    .update(channels)
    .set({ aiAgentMode: mode, aiAgentModeChangedAt: new Date() })
    .where(and(eq(channels.id, channelId), eq(channels.organizationId, organizationId)))
    .returning();
  if (!row) throw new Error("Canal no encontrado en tu organización.");
  console.info(`[agente] canal ${row.id} → ${mode}`);
  revalidatePath("/agente-ia");
  return { id: row.id, displayName: row.displayName, phoneE164: row.phoneE164, isActive: row.isActive, mode: toAgentMode(row.aiAgentMode) };
}
