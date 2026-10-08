// El archivo de la Biblioteca servido por el MISMO origen (30-sep-2026): solo para que el navegador
// haga la miniatura de una foto o video que se subió antes de que existieran (un canvas no puede leer
// un archivo que viene directo del bucket, de otro dominio). Se usa una vez por archivo. Exige sesión y
// membresía de la organización dueña; 404 también si es de otra (no se revela).
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { loadMediaAsset } from "@/lib/media-library/service";
import { isMultimedia, MEDIA_LIMITS } from "@/lib/media-library/rules";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";
import { safeErrorMessage } from "@/lib/log/safe-error";

export async function GET(_req: Request, { params }: RouteContext<"/api/biblioteca/[assetId]/original">): Promise<Response> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireActiveMembership());
  } catch {
    return new Response("no autenticado", { status: 401 });
  }
  const { assetId } = await params;
  const asset = await loadMediaAsset(organizationId, assetId);
  if (!asset || !isMultimedia(asset.kind)) return new Response("no encontrado", { status: 404 });
  try {
    const bytes = await objectStorage().getBytes(asset.storageKey, MEDIA_LIMITS[asset.kind].maxBytes);
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": asset.mimeType, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return new Response("almacenamiento no configurado", { status: 503 });
    console.error("[biblioteca] original no disponible", assetId, safeErrorMessage(error));
    return new Response("no disponible", { status: 502 });
  }
}
