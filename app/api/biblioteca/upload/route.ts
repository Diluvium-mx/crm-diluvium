// Subida de un archivo a la biblioteca de media (Fase D). Ruta (no Server
// Action) para poder recibir el cuerpo en STREAMING hacia el bucket: un video
// de 16 MB no pasa por el límite de body de las acciones ni se acumula en
// memoria. El navegador manda el archivo crudo como body con estos headers:
//   Content-Type: <mime del archivo>
//   X-File-Name: <nombre, URL-encoded>
//   X-Title: <título opcional, URL-encoded>
// Solo owner/admin (ACL `mediaAsset.create`); la organización sale de la sesión.
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { MediaRejectedError } from "@/lib/media-library/rules";
import { storeUploadedAsset } from "@/lib/media-library/service";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

export async function POST(req: Request): Promise<Response> {
  let membership;
  try {
    membership = await requireActiveMembership();
  } catch {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!roleAllows(membership.role, "mediaAsset", "create")) {
    return Response.json({ error: "Sin permiso para subir archivos." }, { status: 403 });
  }
  const mimeType = req.headers.get("content-type") ?? "";
  let fileName: string;
  let title: string;
  try {
    fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
    title = decodeURIComponent(req.headers.get("x-title") ?? "");
  } catch {
    return Response.json({ error: "Nombre de archivo inválido.", code: "name" }, { status: 400 });
  }
  const declaredBytes = Number(req.headers.get("content-length") ?? req.headers.get("x-file-size") ?? 0);
  if (!req.body) return Response.json({ error: "Sin archivo." }, { status: 400 });

  let storage;
  try {
    storage = objectStorage();
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return Response.json({ error: "El almacenamiento de archivos no está configurado." }, { status: 503 });
    }
    throw error;
  }
  try {
    const asset = await storeUploadedAsset(storage, {
      organizationId: membership.organizationId,
      userId: membership.userId,
      title,
      fileName,
      mimeType,
      declaredBytes,
      body: Readable.fromWeb(req.body as WebReadableStream<Uint8Array>),
    });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof MediaRejectedError) return Response.json({ error: error.message, code: error.code }, { status: 400 });
    console.error("[biblioteca] subida falló:", error);
    return Response.json({ error: "No se pudo guardar el archivo." }, { status: 500 });
  }
}
