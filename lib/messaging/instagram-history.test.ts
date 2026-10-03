// Mensajes de Instagram de la API de Zernio → eventos del historial (forma verificada con la
// cuenta real el 2-oct-2026: id = mid de Meta, isStoryMention / noRenderableContent en la raíz).
import { describe, expect, it } from "vitest";
import { INSTAGRAM_HISTORY_MEDIA_MAX_AGE_DAYS, instagramHistoryEventFromRest, OLD_INSTAGRAM_MEDIA_REASON, type RestConversation } from "./zernio-history";
import type { NormalizedMessageEvent } from "./provider";

const NOW = new Date("2026-10-02T20:00:00Z");
const conversation: RestConversation = { id: "1784140000000001", participantId: "1784140000000001", participantName: "Ana López", participantUsername: "ana.lopez" };
const base = {
  id: "aWdfMID1",
  conversationId: "1784140000000001",
  accountId: "zacc_ig",
  platform: "instagram",
  message: "Hola, ¿cuánto cuesta?",
  senderId: "1784140000000001",
  senderName: "Ana López",
  direction: "incoming",
  createdAt: "2026-10-01T18:00:00.000Z",
  sentAt: "2026-10-01T18:00:00.000Z",
  attachments: [],
  isStoryMention: false,
  noRenderableContent: false,
  sentVia: null,
};
const event = (raw: Record<string, unknown>) => {
  const out = instagramHistoryEventFromRest("zacc_ig", conversation, { ...base, ...raw }, NOW);
  if ("skip" in out) throw new Error(out.skip);
  return out.event as NormalizedMessageEvent;
};

describe("instagramHistoryEventFromRest", () => {
  it("un mensaje del cliente: historial de Instagram, identificado por su id y @usuario, sin teléfono", () => {
    expect(event({})).toMatchObject({
      platform: "instagram",
      history: true,
      direction: "in",
      source: "contact",
      providerMessageId: "aWdfMID1",
      providerConversationId: "1784140000000001",
      contactPhone: null,
      contactInstagramId: "1784140000000001",
      contactUsername: "ana.lopez",
      contactName: "Ana López",
      type: "text",
      body: "Hola, ¿cuánto cuesta?",
    });
  });

  it("lo saliente es del negocio (desde la app de Instagram o la herramienta de antes)", () => {
    expect(event({ direction: "outgoing", senderName: "Diluvium" })).toMatchObject({ direction: "out", source: "business_app", contactName: "Ana López" });
  });

  it("una mención en historia sin texto lleva su etiqueta y el adjunto con la ruta de Zernio (no la de Meta, que caduca)", () => {
    const e = event({
      message: "",
      isStoryMention: true,
      attachments: [{ type: "share", originalType: "story_mention", url: "https://lookaside.fbsbx.com/x", refreshUrl: "https://zernio.com/api/v1/inbox/conversations/c/messages/m/attachments/0" }],
    });
    expect(e.body).toBe("📎 Te mencionó en su historia");
    expect(e.attachments[0]).toMatchObject({ url: expect.stringContaining("zernio.com/api"), type: "unknown" });
    expect(e.attachments[0].unavailable).toBeUndefined();
    expect(e.metadata).toMatchObject({ isStoryMention: true });
  });

  it("un adjunto de más de 2 semanas no se copia (se ve en la app)", () => {
    const old = new Date(NOW.getTime() - (INSTAGRAM_HISTORY_MEDIA_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    const e = event({ sentAt: old, createdAt: old, attachments: [{ type: "image", url: "https://cdn/x.jpg", refreshUrl: "https://zernio.com/api/r" }] });
    expect(e.attachments[0].unavailable).toBe(OLD_INSTAGRAM_MEDIA_REASON);
  });

  it("un mensaje que Meta no deja ver se explica", () => {
    expect(event({ message: "", noRenderableContent: true }).body).toContain("Instagram no deja ver este mensaje");
  });

  it("sin fecha o de otra red: se omite", () => {
    expect(instagramHistoryEventFromRest("zacc_ig", conversation, { ...base, sentAt: null, createdAt: null }, NOW)).toMatchObject({ skip: expect.stringContaining("sin fecha") });
    expect(instagramHistoryEventFromRest("zacc_ig", conversation, { ...base, platform: "whatsapp" }, NOW)).toMatchObject({ skip: "plataforma whatsapp" });
  });
});
