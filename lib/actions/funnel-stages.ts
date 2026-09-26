"use server";

// Server Actions de las columnas del Embudo (etapas): leer, crear, editar (nombre,
// color, regla del bot, modelo), reordenar, cambiar de papel y borrar reasignando
// contactos. Las editan vendedores, admin y owner (ACL `funnelStage`). La organización
// sale de la SESIÓN; la lógica vive en lib/contacts/funnel-stages.ts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import {
  countContactsByStage,
  createFunnelStage,
  deleteFunnelStage,
  FunnelStageError,
  listFunnelStages,
  reorderFunnelStages,
  setFunnelStageRole,
  updateFunnelStage,
} from "@/lib/contacts/funnel-stages";
import { MAX_STAGE_NAME, MAX_STAGE_RULE, STAGE_COLOR_PATTERN, STAGE_ROLES, type FunnelStage } from "@/lib/contacts/stages";

export type StagesActionResult = { ok: true; stages: FunnelStage[]; moved?: number } | { ok: false; message: string };

const idSchema = z.string().trim().min(1).max(128);
const nameSchema = z.string().max(MAX_STAGE_NAME + 20);
const colorSchema = z.string().regex(STAGE_COLOR_PATTERN, "Color inválido.");
const ruleSchema = z.string().max(MAX_STAGE_RULE, `La regla no puede pasar de ${MAX_STAGE_RULE} caracteres.`);
const slotSchema = z.union([z.literal(1), z.literal(2)]);

async function requireEdit() {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "funnelStage", "update")) {
    throw new Error("No tienes permiso para editar las etapas del Embudo.");
  }
  return membership;
}

/** Etapas vigentes de la organización, en orden (todos los roles). */
export async function getFunnelStages(): Promise<FunnelStage[]> {
  const { organizationId } = await requireActiveMembership();
  return listFunnelStages(organizationId);
}

/** Cuántos contactos hay en cada etapa (clave → total), para el pop-up de borrar. */
export async function getContactCountsByStage(): Promise<Record<string, number>> {
  const { organizationId } = await requireActiveMembership();
  return countContactsByStage(organizationId);
}

async function run(fallback: string, fn: (organizationId: string) => Promise<{ stages: FunnelStage[]; moved?: number }>): Promise<StagesActionResult> {
  try {
    const { organizationId } = await requireEdit();
    const out = await fn(organizationId);
    // Toda pantalla que muestra etapas se pone al día por el SSE (stages.updated);
    // esto cubre la siguiente navegación por el servidor.
    for (const path of ["/embudo", "/agente-ia", "/inicio", "/anuncios", "/automatizacion", "/dashboard"]) revalidatePath(path);
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? fallback };
    if (error instanceof FunnelStageError) return { ok: false, message: error.message };
    if (error instanceof Error && error.message.startsWith("No tienes permiso")) return { ok: false, message: error.message };
    console.error(`[etapas] ${fallback}`, error);
    return { ok: false, message: fallback };
  }
}

export async function createStage(input: { name: string; color?: string; afterId?: string | null; botRule?: string; modelSlot?: 1 | 2 }): Promise<StagesActionResult> {
  return run("No se pudo agregar la etapa.", async (organizationId) => {
    const data = z
      .object({ name: nameSchema, color: colorSchema.optional(), afterId: idSchema.nullable().optional(), botRule: ruleSchema.optional(), modelSlot: slotSchema.optional() })
      .parse(input);
    await createFunnelStage(organizationId, data);
    return { stages: await listFunnelStages(organizationId) };
  });
}

export async function updateStage(input: { id: string; name?: string; color?: string; botRule?: string; modelSlot?: 1 | 2 }): Promise<StagesActionResult> {
  return run("No se pudo guardar la etapa.", async (organizationId) => {
    const data = z
      .object({ id: idSchema, name: nameSchema.optional(), color: colorSchema.optional(), botRule: ruleSchema.optional(), modelSlot: slotSchema.optional() })
      .parse(input);
    const { id, ...patch } = data;
    await updateFunnelStage(organizationId, id, patch);
    return { stages: await listFunnelStages(organizationId) };
  });
}

export async function reorderStages(input: { orderedIds: string[] }): Promise<StagesActionResult> {
  return run("No se pudo reordenar.", async (organizationId) => {
    const { orderedIds } = z.object({ orderedIds: z.array(idSchema).min(1).max(20) }).parse(input);
    return { stages: await reorderFunnelStages(organizationId, orderedIds) };
  });
}

export async function setStageRole(input: { id: string; role: "entrada" | "cerca_compra" | "venta_cerrada" }): Promise<StagesActionResult> {
  return run("No se pudo cambiar el papel.", async (organizationId) => {
    const { id, role } = z.object({ id: idSchema, role: z.enum(STAGE_ROLES) }).parse(input);
    return { stages: await setFunnelStageRole(organizationId, id, role) };
  });
}

export async function deleteStage(input: { id: string; moveToId: string }): Promise<StagesActionResult> {
  return run("No se pudo borrar la etapa.", async (organizationId) => {
    const { id, moveToId } = z.object({ id: idSchema, moveToId: idSchema }).parse(input);
    return deleteFunnelStage(organizationId, id, moveToId);
  });
}
