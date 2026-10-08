"use server";

// Server Actions del editor del agente (pestaña "Agente IA" estilo GHL): nombre del
// agente y de la empresa, Modelo 1 y Modelo 2, Goal y FAQs con versiones (y su nombre); las
// etapas y el modelo de cada una: lib/actions/funnel-stages.ts. Todos
// los roles, vendedor incluido (ACL: recurso `aiConfig`). La organización sale de la SESIÓN.
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { DEFAULT_MODEL_1, modelsForRole } from "@/lib/ai/catalog";
import { modelAvailability } from "@/lib/ai/provider";
import { faqSchema, goalSchema, profileSchema, versionNameSchema } from "@/lib/agente-ia/editor";
import {
  createFaq,
  deleteFaq,
  deleteFaqs,
  EditorNotFoundError,
  loadEditor,
  renameVersion,
  restoreFaqs,
  restoreGoal,
  saveBrainModel,
  saveGoal,
  saveModel1,
  saveProfile,
  updateFaq,
} from "@/lib/agente-ia/editor-store";
import { buildApiProviders, buildModelOptions } from "@/lib/agente-ia/options";
import { loadBotOptionsRow, loadLastOptionsChange } from "@/lib/agente-ia/opciones-store";
import { usageProfile } from "@/lib/agente-ia/model-cost";
import { brainUsageTotals, priceOverrides } from "@/lib/agente-ia/model-cost-store";
import { idSchema, toAgentMode } from "@/lib/agente-ia/settings";
import type { AgentActionResult, AgentEditorView } from "@/lib/agente-ia/types";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logError } from "@/lib/log/safe-error";

async function requireManage() {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "aiConfig", "update")) {
    throw new Error("No tienes permiso para editar el Agente IA; pídeselo a un administrador.");
  }
  return membership;
}

export async function getAgentEditor(): Promise<AgentEditorView> {
  const { organizationId, role } = await requireActiveMembership();
  if (!roleAllows(role, "aiConfig", "read")) throw new Error("No tienes permiso para ver el Agente IA.");
  const data = await loadEditor(organizationId);
  // Canales: solo los NO archivados (sandbox y número de prueba se ocultan, no se borran).
  const channelRows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.organizationId, organizationId), isNull(channels.archivedAt)))
    .orderBy(channels.createdAt);
  // Costo aproximado por modelo: uso real del cerebro (30 días) o perfil fijo.
  const [totals, overrides, options, lastChange] = await Promise.all([
    brainUsageTotals(organizationId),
    priceOverrides(organizationId),
    loadBotOptionsRow(organizationId),
    loadLastOptionsChange(organizationId),
  ]);
  const { profile, basis } = usageProfile(totals);
  const version = (v: { id: string; createdAt: Date; author: string | null; summary: string; name: string | null }) => ({ ...v, createdAt: v.createdAt.toISOString() });
  return {
    agentName: data.agentName,
    companyName: data.companyName,
    modeloCerebro: data.modeloCerebro,
    modelo1: data.modelo1,
    stages: data.stages,
    goal: data.goal,
    faqs: data.faqs,
    goalVersions: data.goalVersions.map(version),
    faqVersions: data.faqVersions.map(version),
    brainOptions: buildModelOptions("cerebro", { profile, overrides }),
    model1Options: buildModelOptions("cerebro", { profile, overrides }, DEFAULT_MODEL_1),
    costBasis: basis,
    // Solo si la variable de cada llave existe (nunca su valor): lo ve todo el
    // que tenga aiConfig:read (arriba).
    apiProviders: buildApiProviders(),
    channels: channelRows.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      type: c.type,
      phoneE164: c.phoneE164,
      isActive: c.isActive,
      mode: toAgentMode(c.aiAgentMode),
    })),
    options,
    optionsLastChange: lastChange ? { ...lastChange, createdAt: lastChange.createdAt.toISOString() } : null,
  };
}

async function run(fallback: string, fn: (m: { organizationId: string; userId: string }) => Promise<void>): Promise<AgentActionResult> {
  try {
    const m = await requireManage();
    await fn(m);
    revalidatePath("/agente-ia");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? fallback };
    if (error instanceof EditorNotFoundError) return { ok: false, message: error.message };
    logError(`[agente-ia] ${fallback}`, error);
    return { ok: false, message: error instanceof Error && error.message.startsWith("No tienes permiso") ? error.message : fallback };
  }
}

export async function updateAgentProfile(input: { agentName?: string; companyName?: string }): Promise<AgentActionResult> {
  return run("No se pudo guardar el nombre.", async ({ organizationId, userId }) => {
    await saveProfile(organizationId, profileSchema.parse(input), userId);
  });
}

const brainIds = new Set(modelsForRole("cerebro").map((m) => m.id));

// Solo modelos del cerebro que se pueden usar en este entorno (llave y adaptador):
// un cliente viejo o una llamada directa no deja al agente con un modelo sin llave.
function usableBrainModel(modelId: string, slot: string): string {
  const id = idSchema.parse(modelId);
  if (!brainIds.has(id)) throw new EditorNotFoundError(`Modelo no válido para ${slot}.`);
  const a = modelAvailability(id);
  if (!a.available) {
    throw new EditorNotFoundError(a.reason === "missing_key" ? `Ese modelo aún no se puede usar: falta la llave ${a.envKey} en Railway.` : "Ese modelo aún no se puede usar.");
  }
  return id;
}

export async function updateBrainModel(input: { modelId: string }): Promise<AgentActionResult> {
  return run("No se pudo cambiar el modelo.", async ({ organizationId, userId }) => {
    await saveBrainModel(organizationId, usableBrainModel(input.modelId, "el Modelo 2"), userId);
  });
}

// Fase E: Modelo 1 (mismo catálogo que el Modelo 2).
export async function updateModel1(input: { modelId: string }): Promise<AgentActionResult> {
  return run("No se pudo cambiar el Modelo 1.", async ({ organizationId, userId }) => {
    await saveModel1(organizationId, usableBrainModel(input.modelId, "el Modelo 1"), userId);
  });
}

export async function saveAgentGoal(input: { goal: string }): Promise<AgentActionResult> {
  return run("No se pudo guardar el Goal.", async ({ organizationId, userId }) => {
    await saveGoal(organizationId, userId, goalSchema.parse(input.goal));
  });
}

export async function restoreAgentGoal(input: { versionId: string }): Promise<AgentActionResult> {
  return run("No se pudo restaurar el Goal.", async ({ organizationId, userId }) => {
    await restoreGoal(organizationId, userId, idSchema.parse(input.versionId));
  });
}

export async function createAgentFaq(input: { question: string; answer: string; enabled?: boolean }): Promise<AgentActionResult> {
  return run("No se pudo agregar la pregunta.", async ({ organizationId, userId }) => {
    await createFaq(organizationId, userId, faqSchema.parse(input));
  });
}

export async function updateAgentFaq(input: { id: string; question: string; answer: string; enabled: boolean }): Promise<AgentActionResult> {
  return run("No se pudo guardar la pregunta.", async ({ organizationId, userId }) => {
    await updateFaq(organizationId, userId, idSchema.parse(input.id), faqSchema.parse(input));
  });
}

export async function deleteAgentFaq(input: { id: string }): Promise<AgentActionResult> {
  return run("No se pudo borrar la pregunta.", async ({ organizationId, userId }) => {
    await deleteFaq(organizationId, userId, idSchema.parse(input.id));
  });
}

// Borrar varias FAQs a la vez (casillas + «Seleccionar todas»): una sola versión.
const faqIdsSchema = z.array(idSchema).min(1, "Selecciona al menos una pregunta.").max(1_000, "Son demasiadas a la vez.");

export async function deleteAgentFaqs(input: { ids: string[] }): Promise<AgentActionResult> {
  return run("No se pudieron borrar las preguntas.", async ({ organizationId, userId }) => {
    await deleteFaqs(organizationId, userId, [...new Set(faqIdsSchema.parse(input.ids))]);
  });
}

export async function restoreAgentFaqs(input: { versionId: string }): Promise<AgentActionResult> {
  return run("No se pudieron restaurar las preguntas.", async ({ organizationId, userId }) => {
    await restoreFaqs(organizationId, userId, idSchema.parse(input.versionId));
  });
}

// Nombre de una versión del Goal o de las FAQs (lápiz ✎). Vacío = sin nombre; máx. 80
// caracteres. Solo versiones de la organización de la sesión (otra = "no existe").
export async function renameAgentVersion(input: { versionId: string; name: string }): Promise<AgentActionResult> {
  return run("No se pudo guardar el nombre de la versión.", async ({ organizationId }) => {
    await renameVersion(organizationId, idSchema.parse(input.versionId), versionNameSchema.parse(input.name));
  });
}
