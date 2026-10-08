"use server";

// Server Actions de las columnas del Embudo (etapas): leer, crear, editar (nombre,
// regla del bot, modelo), reordenar, cambiar de papel y borrar reasignando
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
import { MAX_STAGE_NAME, MAX_STAGE_RULE, STAGE_ROLES, type FunnelStage } from "@/lib/contacts/stages";
import { logError } from "@/lib/log/safe-error";

export type StagesActionResult = { ok: true; stages: FunnelStage[]; moved?: number } | { ok: false; message: string };

const idSchema = z.string().trim().min(1).max(128);
const nameSchema = z.string().max(MAX_STAGE_NAME + 20);
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

async function run(
  fallback: string,
  fn: (organizationId: string, userId: string) => Promise<{ stages: FunnelStage[]; moved?: number }>,
): Promise<StagesActionResult> {
  try {
    const { organizationId, userId } = await requireEdit();
    const out = await fn(organizationId, userId);
    // Toda pantalla que muestra etapas se pone al día por el SSE (stages.updated);
    // esto cubre la siguiente navegación por el servidor.
    for (const path of ["/embudo", "/agente-ia", "/inicio", "/anuncios", "/automatizacion", "/dashboard"]) revalidatePath(path);
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? fallback };
    if (error instanceof FunnelStageError) return { ok: false, message: error.message };
    // Llave foránea: alguien movió un contacto a esa etapa justo en ese instante.
    if (typeof error === "object" && error !== null && ((error as { code?: string }).code === "23503" || (error as { cause?: { code?: string } }).cause?.code === "23503")) {
      return { ok: false, message: "Un contacto entró a esa etapa en este momento; inténtalo de nuevo." };
    }
    if (error instanceof Error && error.message.startsWith("No tienes permiso")) return { ok: false, message: error.message };
    logError(`[etapas] ${fallback}`, error);
    return { ok: false, message: fallback };
  }
}

// Sin color desde el 27-sep-2026 (decisión del dueño): la columna `color` de la base se
// queda con su valor de fábrica y ninguna pantalla la usa.
export async function createStage(input: { name: string; afterId?: string | null; botRule?: string; modelSlot?: 1 | 2 }): Promise<StagesActionResult> {
  return run("No se pudo agregar la etapa.", async (organizationId, userId) => {
    const data = z
      .object({ name: nameSchema, afterId: idSchema.nullable().optional(), botRule: ruleSchema.optional(), modelSlot: slotSchema.optional() })
      .parse(input);
    await createFunnelStage(organizationId, data, userId);
    return { stages: await listFunnelStages(organizationId) };
  });
}

export async function updateStage(input: { id: string; name?: string; botRule?: string; modelSlot?: 1 | 2 }): Promise<StagesActionResult> {
  return run("No se pudo guardar la etapa.", async (organizationId, userId) => {
    const data = z
      .object({ id: idSchema, name: nameSchema.optional(), botRule: ruleSchema.optional(), modelSlot: slotSchema.optional() })
      .parse(input);
    const { id, ...patch } = data;
    await updateFunnelStage(organizationId, id, patch, userId);
    return { stages: await listFunnelStages(organizationId) };
  });
}

export async function reorderStages(input: { orderedIds: string[] }): Promise<StagesActionResult> {
  return run("No se pudo reordenar.", async (organizationId, userId) => {
    const { orderedIds } = z.object({ orderedIds: z.array(idSchema).min(1).max(20) }).parse(input);
    return { stages: await reorderFunnelStages(organizationId, orderedIds, userId) };
  });
}

export async function setStageRole(input: { id: string; role: "entrada" | "cerca_compra" | "venta_cerrada" }): Promise<StagesActionResult> {
  return run("No se pudo cambiar el papel.", async (organizationId, userId) => {
    const { id, role } = z.object({ id: idSchema, role: z.enum(STAGE_ROLES) }).parse(input);
    return { stages: await setFunnelStageRole(organizationId, id, role, userId) };
  });
}

export async function deleteStage(input: { id: string; moveToId: string }): Promise<StagesActionResult> {
  return run("No se pudo borrar la etapa.", async (organizationId, userId) => {
    const { id, moveToId } = z.object({ id: idSchema, moveToId: idSchema }).parse(input);
    return deleteFunnelStage(organizationId, id, moveToId, userId);
  });
}
