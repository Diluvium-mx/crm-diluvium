"use server";

// Server Action del composer para mandar adjuntos del chat (28-sep-2026). Los
// archivos YA están en el bucket (app/api/inbox/adjuntos); aquí llegan sus
// comprobantes firmados en el orden en que se ven y el texto opcional. La
// organización y el usuario salen de la SESIÓN: un comprobante de otra
// organización, de otro usuario, de otra conversación o viejo se rechaza.
// Nada sale al cliente en esta petición: las burbujas quedan en cola y el
// worker las manda en orden (así 10 archivos no traban la pantalla).
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { messagingProvider, MessagingNotConfiguredError } from "@/lib/messaging";
import { queueChatUploads, SendRejectedError, type ChatUploadToSend } from "@/lib/messaging/send";
import { pauseAgentForManualSend } from "@/lib/ai/runtime/hooks";
import { enqueueChatUploads } from "@/lib/queue/chat-uploads";
import { objectStorage, StorageNotConfiguredError } from "@/lib/storage/s3";
import { isChatUploadKey } from "@/lib/chat-attachments/keys";
import { CHAT_CAPTION_MAX, CHAT_MAX_FILES, ChatSendPlanError, planSend } from "@/lib/chat-attachments/rules";
import { ChatUploadTokenError, verifyChatUpload } from "@/lib/chat-attachments/token";

export type SendAttachmentsResult = { ok: true; messageIds: string[] } | { ok: false; message: string };

const inputSchema = z.object({
  conversationId: z.string().min(1).max(64),
  tokens: z.array(z.string().min(1).max(4_096)).min(1).max(CHAT_MAX_FILES),
  // El tope real (1,024) lo explica planSend; aquí solo se acota la entrada.
  caption: z.string().max(CHAT_CAPTION_MAX * 8),
});

export async function sendAttachments(conversationId: string, tokens: string[], caption: string): Promise<SendAttachmentsResult> {
  const { organizationId, userId } = await requireActiveMembership();
  const parsed = inputSchema.safeParse({ conversationId, tokens, caption });
  if (!parsed.success) return { ok: false, message: `Adjunta de 1 a ${CHAT_MAX_FILES} archivos.` };
  try {
    const files: ChatUploadToSend[] = parsed.data.tokens.map((token) => {
      const u = verifyChatUpload(token, { organizationId, userId, conversationId: parsed.data.conversationId });
      if (!isChatUploadKey(organizationId, u.storageKey)) throw new ChatUploadTokenError("Adjunto inválido; vuelve a adjuntarlo.");
      return { storageKey: u.storageKey, kind: u.kind, mime: u.mime, fileName: u.fileName, bytes: u.bytes };
    });
    if (new Set(files.map((f) => f.storageKey)).size !== files.length) return { ok: false, message: "Hay un archivo repetido." };
    const plan = planSend(files, parsed.data.caption);
    // El archivo sigue en el bucket y pesa lo que se subió (la limpieza de 24 h no lo borró).
    const storage = objectStorage();
    const heads = await Promise.all(files.map((f) => storage.head(f.storageKey)));
    const missing = files.find((f, i) => heads[i]?.bytes !== f.bytes);
    if (missing) return { ok: false, message: `"${missing.fileName}" ya no está disponible; vuelve a adjuntarlo.` };

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
    if (error instanceof ChatUploadTokenError || error instanceof SendRejectedError || error instanceof ChatSendPlanError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof MessagingNotConfiguredError) return { ok: false, message: "El canal de WhatsApp no está configurado." };
    if (error instanceof StorageNotConfiguredError) return { ok: false, message: "El almacenamiento de archivos no está configurado." };
    console.error("[adjuntos] envío falló", error);
    return { ok: false, message: "No se pudieron enviar los archivos. Intenta de nuevo." };
  }
}
