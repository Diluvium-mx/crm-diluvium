"use server";

// Server Actions de la biblioteca de media (Fase D). La organización sale de la
// SESIÓN; el ACL (`mediaAsset`) decide: owner/admin suben y borran, todos leen.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { deleteMediaAsset, listMediaAssets, MediaInUseError, renameMediaAsset, type MediaAssetView } from "@/lib/media-library/service";
import { MediaRejectedError } from "@/lib/media-library/rules";

const idSchema = z.string().trim().min(1).max(200);

function requireMedia(role: string, action: "read" | "create" | "delete"): void {
  if (!roleAllows(role, "mediaAsset", action)) throw new Error("No tienes permiso para gestionar la biblioteca de media.");
}

export async function getMediaAssets(): Promise<MediaAssetView[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "read");
  return listMediaAssets(organizationId);
}

export async function renameMediaAssetAction(input: { assetId: string; title: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "create");
  const parsed = z.object({ assetId: idSchema, title: z.string().max(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    await renameMediaAsset(organizationId, parsed.data.assetId, parsed.data.title);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo renombrar." };
  }
  revalidatePath("/automatizacion");
  return { ok: true };
}

export async function deleteMediaAssetAction(input: { assetId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "delete");
  const parsed = z.object({ assetId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    await deleteMediaAsset(organizationId, parsed.data.assetId);
  } catch (error) {
    if (error instanceof MediaInUseError || error instanceof MediaRejectedError || error instanceof Error) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "No se pudo borrar." };
  }
  revalidatePath("/automatizacion");
  return { ok: true };
}
