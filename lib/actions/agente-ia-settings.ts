"use server";

// Server Actions de los ajustes del runtime del Agente IA (Fase B): interruptor
// por canal, tiempos, pausas, límites, respuesta y precios de los modelos. Solo
// owner/admin (ACL: recurso `aiConfig`). La organización sale de la SESIÓN.
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { aiConfig, aiKnowledge, aiModelPrices, channels } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL, getModel, MODEL_CATALOG } from "@/lib/ai/catalog";
import { PROVIDER_META } from "@/lib/ai/provider";
import { DEFAULT_MODEL_PRICES } from "@/lib/ai/pricing";
import { loadAgentConfig } from "@/lib/ai/runtime/config";
import { agentModeSchema, agentSettingsSchema, idSchema, priceSchema, type AgentSettings } from "@/lib/agente-ia/settings";
import { obsoleteChannelDrafts } from "@/lib/ai/runtime/state";
import type { AgentSettingsBundleView, ChannelAgentView, ModelPriceView } from "@/lib/agente-ia/types";

async function requireManage(action: "read" | "update") {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "aiConfig", action)) {
    throw new Error("No tienes permiso para la configuración del Agente IA; pídeselo a un administrador.");
  }
  return membership;
}

function cacheNote(provider: string): string {
  return provider === "anthropic" || provider === "openai"
    ? "Caché: lectura 10% · escritura 125% de la entrada"
    : "Caché: sin descuento (se cobra como entrada)";
}

export async function getAgentSettings(): Promise<AgentSettingsBundleView> {
  const { organizationId } = await requireManage("read");
  const cfg = await loadAgentConfig(organizationId);
  const settings: AgentSettings = {
    responseDelaySeconds: cfg.responseDelaySeconds,
    maxWaitSeconds: cfg.maxWaitSeconds,
    pauseOnHumanReply: cfg.pauseOnHumanReply,
    handoverReactivateHours: cfg.handoverReactivateHours,
    antiLoopMaxPerHour: cfg.antiLoopMaxPerHour,
    maxRepliesPerContact: cfg.maxRepliesPerContact,
    contextMessages: cfg.contextMessages,
    maxBubbles: cfg.maxBubbles,
  };
  const channelRows = await db
    .select()
    .from(channels)
    .where(eq(channels.organizationId, organizationId))
    .orderBy(channels.createdAt);
  const channelViews: ChannelAgentView[] = channelRows.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    phoneE164: c.phoneE164,
    isActive: c.isActive,
    mode: c.aiAgentMode,
  }));
  const overrides = await db.select().from(aiModelPrices).where(eq(aiModelPrices.organizationId, organizationId));
  const prices: ModelPriceView[] = MODEL_CATALOG.map((m) => {
    const base = DEFAULT_MODEL_PRICES[m.id] ?? null;
    const o = overrides.find((r) => r.modelId === m.id);
    return {
      modelId: m.id,
      label: m.label,
      providerLabel: PROVIDER_META[m.provider].label,
      defaultInput: base?.input ?? null,
      defaultOutput: base?.output ?? null,
      overrideInput: o?.inputPerMTok ?? null,
      overrideOutput: o?.outputPerMTok ?? null,
      cacheNote: cacheNote(m.provider),
    };
  });
  const [{ value: faqsEnabled }] = await db
    .select({ value: count() })
    .from(aiKnowledge)
    .where(and(eq(aiKnowledge.organizationId, organizationId), eq(aiKnowledge.enabled, true)));
  return {
    settings,
    channels: channelViews,
    prices,
    knowledge: { goalChars: cfg.goal?.length ?? 0, faqsEnabled },
  };
}

export async function updateAgentSettings(input: AgentSettings): Promise<AgentSettings> {
  const { organizationId } = await requireManage("update");
  const parsed = agentSettingsSchema.parse(input);
  const now = new Date();
  await db
    .insert(aiConfig)
    .values({
      organizationId,
      modeloFiltro: DEFAULT_FILTER_MODEL,
      modeloCerebro: DEFAULT_BRAIN_MODEL,
      ...parsed,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: aiConfig.organizationId, set: { ...parsed, updatedAt: now } });
  revalidatePath("/agente-ia");
  return parsed;
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
  // Apagado = nada del agente sale por este canal, ni un borrador que ya esperaba.
  if (mode === "off") await obsoleteChannelDrafts(organizationId, row.id, new Date());
  console.info(`[agente] canal ${row.id} → ${mode}`);
  revalidatePath("/agente-ia");
  return { id: row.id, displayName: row.displayName, phoneE164: row.phoneE164, isActive: row.isActive, mode: row.aiAgentMode };
}

export async function updateModelPrice(input: {
  modelId: string;
  inputPerMTok: number;
  outputPerMTok: number;
}): Promise<void> {
  const { organizationId, userId } = await requireManage("update");
  const parsed = priceSchema.parse(input);
  if (!getModel(parsed.modelId)) throw new Error("Modelo desconocido en el catálogo.");
  const now = new Date();
  await db
    .insert(aiModelPrices)
    .values({ organizationId, ...parsed, updatedAt: now, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: [aiModelPrices.organizationId, aiModelPrices.modelId],
      set: { inputPerMTok: parsed.inputPerMTok, outputPerMTok: parsed.outputPerMTok, updatedAt: now, updatedByUserId: userId },
    });
  revalidatePath("/agente-ia");
}

export async function resetModelPrice(input: { modelId: string }): Promise<void> {
  const { organizationId } = await requireManage("update");
  await db
    .delete(aiModelPrices)
    .where(and(eq(aiModelPrices.organizationId, organizationId), eq(aiModelPrices.modelId, idSchema.parse(input.modelId))));
  revalidatePath("/agente-ia");
}
