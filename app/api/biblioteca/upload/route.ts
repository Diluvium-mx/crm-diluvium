// Subida de un archivo a la biblioteca de media (Fase D). Ruta (no Server
// Action) para poder recibir el cuerpo en STREAMING hacia el bucket: un video
// de 16 MB no pasa por el límite de body de las acciones ni se acumula en
// memoria. El navegador manda el archivo crudo como body con estos headers:
//   Content-Type: <mime del archivo>
//   X-File-Name: <nombre, URL-encoded>
//   X-Title: <título opcional, URL-encoded>
// Todos los roles (ACL `mediaAsset.create`); la organización sale de la sesión.
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { acquireUploadSlot } from "@/lib/chat-attachments/in-flight";
import { MediaRejectedError } from "@/lib/media-library/rules";
import { storeUploadedAsset } from "@/lib/media-library/service";
import { ipRateLimiter } from "@/lib/rate-limit";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";
import { logError } from "@/lib/log/safe-error";

// La Biblioteca se llena a mano (pocos archivos): 60 subidas en 10 min por IP sobran.
const UPLOAD_RULES = [{ name: "biblioteca-subida", max: 60, windowMs: 10 * 60_000 }] as const;

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
  // S2 (CN-013): mismos topes que los adjuntos del chat (por IP y simultáneas por usuario).
  const limited = await ipRateLimiter.check(req, UPLOAD_RULES);
  if (limited) return limited;
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
  const slot = await acquireUploadSlot(membership.userId);
  if (!slot.ok) return Response.json({ error: "Hay demasiados archivos subiendo a la vez; espera a que terminen." }, { status: 429 });
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
    logError("[biblioteca] subida falló:", error);
    return Response.json({ error: "No se pudo guardar el archivo." }, { status: 500 });
  } finally {
    await slot.release();
  }
}
