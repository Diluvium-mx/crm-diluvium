"use server";

// Server Actions de la biblioteca de media (Fase D). La organización sale de la
// SESIÓN; el ACL (`mediaAsset`) decide: todos los roles leen, suben y borran.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { deleteMediaAsset, listMediaAssets, MediaInUseError, renameMediaAsset, saveMediaThumbnail, type MediaAssetView } from "@/lib/media-library/service";
import { isMultimedia, MediaRejectedError } from "@/lib/media-library/rules";
import { logError } from "@/lib/log/safe-error";

const idSchema = z.string().trim().min(1).max(200);

function requireMedia(role: string, action: "read" | "create" | "delete"): void {
  if (!roleAllows(role, "mediaAsset", action)) throw new Error("No tienes permiso para gestionar la biblioteca de media.");
}

export async function getMediaAssets(): Promise<MediaAssetView[]> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "read");
  return listMediaAssets(organizationId);
}

/** Multimedia del chat (30-sep-2026): las fotos y los videos de la misma Biblioteca, sin documentos. */
export async function getMultimediaAssets(): Promise<MediaAssetView[]> {
  return (await getMediaAssets()).filter((a) => isMultimedia(a.kind));
}

/** Miniatura que hizo el navegador (JPEG chico en base64). Sin revalidar: la lista la trae la próxima vez. */
export async function saveMediaThumbnailAction(input: { assetId: string; jpegBase64: string }): Promise<{ ok: boolean }> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "create");
  const parsed = z.object({ assetId: idSchema, jpegBase64: z.string().max(100_000) }).safeParse(input);
  if (!parsed.success) return { ok: false };
  try {
    return { ok: await saveMediaThumbnail(organizationId, parsed.data.assetId, parsed.data.jpegBase64) };
  } catch (error) {
    if (error instanceof MediaRejectedError) return { ok: false };
    logError("[biblioteca] miniatura falló", error);
    return { ok: false };
  }
}

export async function renameMediaAssetAction(input: { assetId: string; title: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, role } = await requireActiveMembership();
  requireMedia(role, "create");
  const parsed = z.object({ assetId: idSchema, title: z.string().max(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    await renameMediaAsset(organizationId, parsed.data.assetId, parsed.data.title);
  } catch (error) {
    if (error instanceof MediaRejectedError) return { ok: false, error: error.message };
    logError("[biblioteca] renombrar falló", error);
    return { ok: false, error: "No se pudo renombrar el archivo." };
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
    if (error instanceof MediaInUseError || error instanceof MediaRejectedError) return { ok: false, error: error.message };
    logError("[biblioteca] borrar falló", error);
    return { ok: false, error: "No se pudo borrar el archivo." };
  }
  revalidatePath("/automatizacion");
  return { ok: true };
}
