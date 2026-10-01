"use server";

// Server Action del composer para mandar adjuntos del chat (28-sep-2026). Los
// archivos YA están en el bucket (app/api/inbox/adjuntos); aquí llegan sus
// comprobantes firmados en el orden en que se ven y el texto opcional. La
// organización y el usuario salen de la SESIÓN: un comprobante de otra
// organización, de otro usuario, de otra conversación o viejo se rechaza.
// Nada sale al cliente en esta petición: las burbujas quedan en cola y el
// worker las manda en orden (así 10 archivos no traban la pantalla).
// Multimedia (30-sep-2026): en la misma lista pueden venir archivos de la
// Biblioteca (por su id); no se suben, ya están en el bucket.
import { z } from "zod";
import { logError } from "@/lib/log/safe-error";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import { queueChatUploads, SendRejectedError, type ChatUploadToSend } from "@/lib/messaging/send";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { enqueueChatUploads } from "@/lib/queue/chat-uploads";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";
import { isChatUploadKey } from "@/lib/chat-attachments/keys";
import { MultimediaError, multimediaToSend } from "@/lib/chat-attachments/multimedia";
import { roleAllows } from "@/lib/auth/permissions";
import { CHAT_CAPTION_MAX, CHAT_MAX_FILES, ChatSendPlanError, planSend } from "@/lib/chat-attachments/rules";
import { ChatUploadTokenError, verifyChatUpload } from "@/lib/chat-attachments/token";

export type SendAttachmentsResult = { ok: true; messageIds: string[] } | { ok: false; message: string };

/** Un archivo de la vista previa, en su orden: subido (comprobante) o de la Biblioteca (Multimedia). */
export type ChatSendItem = { token: string } | { assetId: string };

const inputSchema = z.object({
  conversationId: z.string().min(1).max(64),
  items: z
    .array(z.union([z.object({ token: z.string().min(1).max(4_096) }).strict(), z.object({ assetId: z.string().min(1).max(200) }).strict()]))
    .min(1)
    .max(CHAT_MAX_FILES),
  // El tope real (1,024) lo explica planSend; aquí solo se acota la entrada.
  caption: z.string().max(CHAT_CAPTION_MAX * 8),
  // Uno por cada vista previa armada: el id de las burbujas de la Biblioteca sale de aquí.
  sendId: z.string().regex(/^[\w-]{8,64}$/),
});

export async function sendAttachments(conversationId: string, items: ChatSendItem[], caption: string, sendId: string): Promise<SendAttachmentsResult> {
  const { organizationId, userId, role } = await requireActiveMembership();
  const parsed = inputSchema.safeParse({ conversationId, items, caption, sendId });
  if (!parsed.success) return { ok: false, message: `Adjunta de 1 a ${CHAT_MAX_FILES} archivos.` };
  try {
    const files: ChatUploadToSend[] = [];
    for (const item of parsed.data.items) {
      if ("assetId" in item) {
        if (!roleAllows(role, "mediaAsset", "read")) return { ok: false, message: "No tienes permiso para usar la Biblioteca." };
        files.push(await multimediaToSend(organizationId, item.assetId, parsed.data.sendId));
        continue;
      }
      const u = verifyChatUpload(item.token, { organizationId, userId, conversationId: parsed.data.conversationId });
      if (!isChatUploadKey(organizationId, u.storageKey)) throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
      files.push({ storageKey: u.storageKey, kind: u.kind, mime: u.mime, fileName: u.fileName, bytes: u.bytes });
    }
    if (new Set(files.map((f) => f.storageKey)).size !== files.length) return { ok: false, message: "Hay un archivo repetido." };
    const plan = planSend(files, parsed.data.caption);
    // El archivo sigue en el bucket y pesa lo que se subió (la limpieza de 24 h no lo borró);
    // el de la Biblioteca, que sigue ahí (lo sirve el mismo bucket que a los workflows).
    const storage = objectStorage();
    const heads = await Promise.all(files.map((f) => storage.head(f.storageKey)));
    const missing = files.find((f, i) => (f.messageId ? !heads[i] : heads[i]?.bytes !== f.bytes));
    if (missing) {
      return {
        ok: false,
        message: missing.messageId
          ? `"${missing.fileName}" ya no está en la Biblioteca; quítalo y vuelve a elegirlo.`
          : `"${missing.fileName}" ya no está disponible; vuelve a adjuntarlo.`,
      };
    }

    const messageIds = await queueChatUploads(messagingProvider(), {
      organizationId,
      conversationId: parsed.data.conversationId,
      sentByUserId: userId,
      files: plan.map((p) => p.file),
      captions: plan.map((p) => p.caption),
    });
    await enqueueChatUploads({ organizationId, conversationId: parsed.data.conversationId, messageIds });
    // Igual que un texto del vendedor: pausa al Agente IA según sus Opciones.
    await pauseAgentForManualSend(organizationId, parsed.data.conversationId);
    return { ok: true, messageIds };
  } catch (error) {
    if (error instanceof ChatUploadTokenError || error instanceof SendRejectedError || error instanceof ChatSendPlanError || error instanceof MultimediaError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof MessagingNotConfiguredError) return { ok: false, message: "El canal de WhatsApp no está configurado." };
    if (error instanceof StorageNotConfiguredError) return { ok: false, message: "El almacenamiento de archivos no está configurado." };
    logError("[adjuntos] envío falló", error);
    return { ok: false, message: "No se pudieron enviar los archivos. Intenta de nuevo." };
  }
}
