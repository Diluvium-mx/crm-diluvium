import { beforeAll, describe, expect, it } from "vitest";
import { chatUploadKey, chatUploadMessageId, isChatUploadKey, safeFileName } from "./keys";
import { CHAT_UPLOAD_MAX_AGE_MS, ChatUploadTokenError, signChatUpload, verifyChatUpload, type ChatUpload } from "./token";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "secreto-solo-para-tests-de-adjuntos-0123456789";
});

const NOW = Date.UTC(2026, 8, 28, 18, 0, 0);
const upload: ChatUpload = {
  storageKey: chatUploadKey("org_a", "u1", "Factura Enero.xml", new Date(NOW)),
  organizationId: "org_a",
  userId: "vend_1",
  conversationId: "conv_1",
  uploadedAt: NOW,
  kind: "document",
  mime: "text/plain",
  fileName: "Factura Enero.xml",
  bytes: 1234,
};
const expectOk = { organizationId: "org_a", userId: "vend_1", conversationId: "conv_1", now: NOW + 60_000 };

describe("comprobante de subida", () => {
  it("vale para la misma organización, usuario y conversación, hace poco", () => {
    expect(verifyChatUpload(signChatUpload(upload), expectOk)).toEqual(upload);
  });
  it("otra organización, otro usuario u otra conversación: rechazado", () => {
    const t = signChatUpload(upload);
    expect(() => verifyChatUpload(t, { ...expectOk, organizationId: "org_b" })).toThrow(ChatUploadTokenError);
    expect(() => verifyChatUpload(t, { ...expectOk, userId: "vend_2" })).toThrow(ChatUploadTokenError);
    expect(() => verifyChatUpload(t, { ...expectOk, conversationId: "conv_2" })).toThrow(ChatUploadTokenError);
  });
  it("de hace más de 6 h: rechazado", () => {
    const t = signChatUpload(upload);
    expect(() => verifyChatUpload(t, { ...expectOk, now: NOW + CHAT_UPLOAD_MAX_AGE_MS + 1 })).toThrow("6 horas");
  });
  it("alterado (otra llave, otro tamaño) o inventado: rechazado", () => {
    const [body, sig] = signChatUpload(upload).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), k: "org_b/chat/x" })).toString("base64url");
    expect(() => verifyChatUpload(`${forged}.${sig}`, expectOk)).toThrow(ChatUploadTokenError);
    expect(() => verifyChatUpload("abc.def", expectOk)).toThrow(ChatUploadTokenError);
    expect(() => verifyChatUpload("sin-punto", expectOk)).toThrow(ChatUploadTokenError);
  });
});

describe("llaves del bucket", () => {
  it("carpeta propia por organización y día, nombre seguro", () => {
    expect(upload.storageKey).toBe("org/org_a/chat/2026-09-28/u1-Factura_Enero.xml");
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("Cotización Señor.pdf")).toBe("Cotizacion_Senor.pdf");
  });
  it("isChatUploadKey solo acepta adjuntos del chat de ESA organización", () => {
    expect(isChatUploadKey("org_a", upload.storageKey)).toBe(true);
    expect(isChatUploadKey("org_b", upload.storageKey)).toBe(false);
    expect(isChatUploadKey("org_a", "org/org_a/library/x-tabla.png")).toBe(false);
    expect(isChatUploadKey("org_a", "org/org_a/chat/2026-09-28/../../library/x")).toBe(false);
  });
  it("id de mensaje determinista por archivo (no se manda dos veces)", () => {
    expect(chatUploadMessageId(upload.storageKey)).toBe(chatUploadMessageId(upload.storageKey));
    expect(chatUploadMessageId(upload.storageKey)).not.toBe(chatUploadMessageId(`${upload.storageKey}2`));
    expect(chatUploadMessageId(upload.storageKey)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-b[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
