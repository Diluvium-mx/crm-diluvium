// Ver un archivo de la biblioteca (vista previa en la pestaña Automatización:
// <img src="/api/biblioteca/{id}">, <video src=…>). El bucket es privado: exige
// sesión y membresía de la organización dueña, y redirige a una URL firmada de
// 5 minutos. 404 también si es de otra organización (no se revela).
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { loadMediaAsset, mediaAssetSignedUrl } from "@/lib/media-library/service";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

export async function GET(_req: Request, { params }: RouteContext<"/api/biblioteca/[assetId]">): Promise<Response> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireActiveMembership());
  } catch {
    return new Response("no autenticado", { status: 401 });
  }
  const { assetId } = await params;
  const asset = await loadMediaAsset(organizationId, assetId);
  if (!asset) return new Response("no encontrado", { status: 404 });
  try {
    const url = await mediaAssetSignedUrl(objectStorage(), asset);
    return Response.redirect(url, 302);
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    return new Response("almacenamiento no configurado", { status: 503 });
  }
}
