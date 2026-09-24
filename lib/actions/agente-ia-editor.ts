"use server";

// Server Actions del editor del agente (pestaña "Agente IA" estilo GHL): nombre del
// agente y de la empresa, modelo cerebro, Goal y FAQs con versiones. Solo
// owner/admin (ACL: recurso `aiConfig`). La organización sale de la SESIÓN.
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { modelsForRole } from "@/lib/ai/catalog";
import { faqSchema, goalSchema, profileSchema } from "@/lib/agente-ia/editor";
import {
  createFaq,
  deleteFaq,
  EditorNotFoundError,
  loadEditor,
  restoreFaqs,
  restoreGoal,
  saveBrainModel,
  saveGoal,
  saveProfile,
  updateFaq,
} from "@/lib/agente-ia/editor-store";
import { buildModelOptions } from "@/lib/agente-ia/options";
import { idSchema, toAgentMode } from "@/lib/agente-ia/settings";
import type { AgentActionResult, AgentEditorView } from "@/lib/agente-ia/types";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
  const channelRows = await db.select().from(channels).where(eq(channels.organizationId, organizationId)).orderBy(channels.createdAt);
  const version = (v: { id: string; createdAt: Date; author: string | null; summary: string }) => ({ ...v, createdAt: v.createdAt.toISOString() });
  return {
    agentName: data.agentName,
    companyName: data.companyName,
    modeloCerebro: data.modeloCerebro,
    goal: data.goal,
    faqs: data.faqs,
    goalVersions: data.goalVersions.map(version),
    faqVersions: data.faqVersions.map(version),
    brainOptions: buildModelOptions("cerebro"),
    channels: channelRows.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      phoneE164: c.phoneE164,
      isActive: c.isActive,
      mode: toAgentMode(c.aiAgentMode),
    })),
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
    console.error(`[agente-ia] ${fallback}`, error);
    return { ok: false, message: error instanceof Error && error.message.startsWith("No tienes permiso") ? error.message : fallback };
  }
}

export async function updateAgentProfile(input: { agentName: string; companyName: string }): Promise<AgentActionResult> {
  return run("No se pudo guardar el nombre.", async ({ organizationId }) => {
    await saveProfile(organizationId, profileSchema.parse(input));
  });
}

const brainIds = new Set(modelsForRole("cerebro").map((m) => m.id));

export async function updateBrainModel(input: { modelId: string }): Promise<AgentActionResult> {
  return run("No se pudo cambiar el modelo.", async ({ organizationId }) => {
    const id = idSchema.parse(input.modelId);
    if (!brainIds.has(id)) throw new EditorNotFoundError("Modelo no válido para el cerebro.");
    await saveBrainModel(organizationId, id);
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

export async function restoreAgentFaqs(input: { versionId: string }): Promise<AgentActionResult> {
  return run("No se pudieron restaurar las preguntas.", async ({ organizationId, userId }) => {
    await restoreFaqs(organizationId, userId, idSchema.parse(input.versionId));
  });
}
