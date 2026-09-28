// Subida de un adjunto del chat (28-sep-2026). Ruta (no Server Action) por la
// misma razón que app/api/biblioteca/upload: el cuerpo llega en STREAMING al
// bucket (un documento de 100 MB no pasa por el límite de las acciones ni se
// junta en memoria). El navegador manda el archivo crudo como body:
//   Content-Type: <mime del archivo>   (solo informativo: el tipo real se lee de sus bytes)
//   X-File-Name: <nombre, URL-encoded>
//   X-Conversation-Id: <conversación donde se adjuntó>
// Sesión obligatoria; la organización y el usuario salen de la sesión, nunca
// del navegador. Responde el comprobante firmado que exige el envío.
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { acquireUploadSlot } from "@/lib/chat-attachments/in-flight";
import { ChatUploadRejectedError, storeChatUpload } from "@/lib/chat-attachments/upload";
import { ipRateLimiter } from "@/lib/rate-limit";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";

// 10 archivos por envío: 200 subidas en 10 min por IP dan de sobra a dos vendedores en la misma red.
const UPLOAD_RULES = [{ name: "chat-adjuntos", max: 200, windowMs: 10 * 60_000 }] as const;

export async function POST(req: Request): Promise<Response> {
  let membership;
  try {
    membership = await requireActiveMembership();
  } catch {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }
  const limited = await ipRateLimiter.check(req, UPLOAD_RULES);
  if (limited) return limited;

  let fileName: string;
  try {
    fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  } catch {
    return Response.json({ error: "Nombre de archivo inválido." }, { status: 400 });
  }
  const conversationId = req.headers.get("x-conversation-id") ?? "";
  if (!/^[\w-]{1,64}$/.test(conversationId)) return Response.json({ error: "Conversación inválida." }, { status: 400 });
  const declaredBytes = Number(req.headers.get("content-length") ?? 0);
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
  // Tope de subidas simultáneas por usuario (además del límite por IP).
  const slot = await acquireUploadSlot(membership.userId);
  if (!slot.ok) return Response.json({ error: "Hay demasiados archivos subiendo a la vez; espera a que terminen." }, { status: 429 });
  try {
    const upload = await storeChatUpload(storage, {
      organizationId: membership.organizationId,
      userId: membership.userId,
      conversationId,
      fileName,
      declaredBytes: Number.isFinite(declaredBytes) ? declaredBytes : 0,
      body: Readable.fromWeb(req.body as WebReadableStream<Uint8Array>),
    });
    return Response.json(upload, { status: 201 });
  } catch (error) {
    if (error instanceof ChatUploadRejectedError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[adjuntos] subida falló:", error);
    return Response.json({ error: "No se pudo guardar el archivo. Intenta de nuevo." }, { status: 500 });
  } finally {
    await slot.release();
  }
}
