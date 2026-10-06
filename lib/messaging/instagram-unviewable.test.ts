import { describe, expect, it } from "vitest";
import { normalizeZernioEvent } from "./zernio";
import { INSTAGRAM_EPHEMERAL, INSTAGRAM_WITHHELD, instagramUnviewableCard } from "./instagram-unviewable";

describe("instagramUnviewableCard", () => {
  it("la foto o video temporal y lo que Meta no deja ver se muestran como tarjeta", () => {
    expect(instagramUnviewableCard(INSTAGRAM_EPHEMERAL)).toBe(
      "El cliente mandó una foto o video temporal. Instagram no deja verlo aquí: ábrelo en la app de Instagram.",
    );
    expect(instagramUnviewableCard(INSTAGRAM_WITHHELD)).toContain("Instagram no deja ver aquí");
  });

  it("un mensaje normal o una publicación compartida siguen siendo burbuja", () => {
    expect(instagramUnviewableCard("Hola, ¿cuánto cuesta?")).toBeNull();
    expect(instagramUnviewableCard("📎 Compartió una publicación")).toBeNull();
    expect(instagramUnviewableCard(null)).toBeNull();
  });

  it("el texto que guarda la ingesta es justo el que reconoce la tarjeta", () => {
    const event = normalizeZernioEvent({
      event: "message.received",
      message: {
        id: "6ab0000000000000000000a1",
        conversationId: "6ab0000000000000000000c1",
        platform: "instagram",
        platformMessageId: "mid_1",
        direction: "incoming",
        text: null,
        attachments: [{ type: "ephemeral" }],
        sender: { id: "17841400000000001" },
        sentAt: "2026-10-03T20:57:52.594Z",
      },
      conversation: { id: "6ab0000000000000000000c1", participantId: "17841400000000001" },
      account: { id: "zacc_ig", accountId: "zacc_ig", platform: "instagram" },
    }) as { body: string | null };
    expect(instagramUnviewableCard(event.body)).not.toBeNull();
  });
});
