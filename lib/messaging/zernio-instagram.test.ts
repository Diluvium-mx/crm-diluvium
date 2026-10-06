// Instagram por Zernio (docs/instagram.md): forma de los webhooks según
// docs.zernio.com/webhooks/inbox (message.received / message.sent) y del envío según
// docs.zernio.com/messages/send-inbox-message (messageIds, partialFailure, messageTag).
import { describe, expect, it, vi } from "vitest";
import { normalizeZernioEvent, ZernioProvider, ZernioSendError } from "./zernio";
import type { NormalizedMessageEvent } from "./provider";

const IGSID = "17841400000000001"; // numérico, 17 dígitos: NO es un teléfono

function igReceived(overrides: { message?: Record<string, unknown>; metadata?: Record<string, unknown> | null; event?: string } = {}) {
  return {
    id: "evt_ig_1",
    event: overrides.event ?? "message.received",
    timestamp: "2026-10-02T18:00:01.000Z",
    message: {
      id: "6ab0000000000000000000a1",
      conversationId: "6ab0000000000000000000c1",
      platform: "instagram",
      platformMessageId: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAElEOjE3",
      direction: "incoming",
      text: "Hola, ¿cuánto cuesta la compuerta?",
      attachments: [],
      sender: { id: IGSID, name: "Ana López", username: "ana.lopez", picture: "https://cdn.example/ana.jpg", instagramProfile: { isFollower: true } },
      sentAt: "2026-10-02T18:00:00.123Z",
      isRead: false,
      sentVia: null,
      ...overrides.message,
    },
    conversation: {
      id: "6ab0000000000000000000c1",
      platformConversationId: IGSID,
      participantId: IGSID,
      participantName: "Ana López",
      participantUsername: "ana.lopez",
      status: "active",
    },
    account: { id: "zacc_ig", accountId: "zacc_ig", profileId: "prof_1", platform: "instagram", username: "diluvium" },
    metadata: overrides.metadata ?? null,
  };
}

const msg = (payload: unknown) => normalizeZernioEvent(payload) as NormalizedMessageEvent;

describe("normalizeZernioEvent · Instagram", () => {
  it("un DM entrante: el cliente se identifica por su id de Instagram y su @usuario, nunca por teléfono", () => {
    const e = msg(igReceived());
    expect(e).toMatchObject({
      kind: "message",
      platform: "instagram",
      providerAccountId: "zacc_ig",
      providerConversationId: "6ab0000000000000000000c1",
      direction: "in",
      source: "contact",
      providerMessageId: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAElEOjE3",
      contactPhone: null,
      contactInstagramId: IGSID,
      contactUsername: "ana.lopez",
      contactName: "Ana López",
      type: "text",
      body: "Hola, ¿cuánto cuesta la compuerta?",
    });
    expect(e.contactBsuid).toBeUndefined();
    expect(e.sentAt.toISOString()).toBe("2026-10-02T18:00:00.123Z");
  });

  it("eco desde la app de Instagram (sentVia null) = un vendedor: business_app", () => {
    const e = msg(igReceived({ event: "message.sent", message: { direction: "outgoing", sender: { id: "zacc_ig", name: "Diluvium", username: "diluvium" }, sentVia: null } }));
    expect(e).toMatchObject({ direction: "out", source: "business_app", contactInstagramId: IGSID, contactUsername: "ana.lopez", contactName: "Ana López" });
  });

  it("eco de la API (el CRM) u otro origen = other_api; sin sentVia tampoco cuenta como la app", () => {
    const api = msg(igReceived({ event: "message.sent", message: { direction: "outgoing", sender: { id: "zacc_ig" }, sentVia: "api" } }));
    expect(api.source).toBe("other_api");
    const missing = igReceived({ event: "message.sent", message: { direction: "outgoing", sender: { id: "zacc_ig" } } });
    delete (missing.message as Record<string, unknown>).sentVia;
    expect(msg(missing).source).toBe("other_api");
  });

  it("una mención en su historia (share sin texto) llega con una etiqueta legible y su archivo", () => {
    const e = msg(
      igReceived({
        message: { text: null, attachments: [{ type: "share", originalType: "story_mention", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }] },
        metadata: { isStoryMention: true },
      }),
    );
    expect(e.body).toBe("📎 Te mencionó en su historia");
    expect(e.type).toBe("text");
    expect(e.attachments).toHaveLength(1);
    expect(e.attachments[0]).toMatchObject({ type: "unknown", url: expect.stringContaining("lookaside") });
  });

  it("un reel compartido llega como video (Zernio lo normaliza) con su etiqueta", () => {
    const e = msg(igReceived({ message: { text: null, attachments: [{ type: "video", originalType: "ig_reel", url: "https://cdn.example/reel.mp4" }] } }));
    expect(e.type).toBe("video");
    expect(e.body).toBe("📎 Compartió un reel");
  });

  it("un mensaje que Meta no deja ver se explica en vez de quedar vacío", () => {
    const e = msg(igReceived({ message: { text: null, attachments: [] }, metadata: { noRenderableContent: true } }));
    expect(e.body).toContain("Instagram no deja ver este mensaje");
  });

  // Dead-letters reales del 3 y 4-oct-2026: un adjunto sin url tumbaba todo el evento.
  it("una foto o video temporal (adjunto sin url) se guarda con su etiqueta, sin archivo", () => {
    const e = msg(igReceived({ message: { text: null, attachments: [{ type: "ephemeral" }] } }));
    expect(e.kind).toBe("message");
    expect(e.attachments).toEqual([]);
    expect(e.type).toBe("text");
    expect(e.body).toContain("foto o video temporal");
  });

  it("una tarjeta compartida sin url con noRenderableContent se explica; sin la marca, como publicación", () => {
    const card = { type: "template", payload: { generic: { elements: [] } } };
    const withheld = msg(igReceived({ message: { text: null, attachments: [card] }, metadata: { noRenderableContent: true } }));
    expect(withheld.kind).toBe("message");
    expect(withheld.attachments).toEqual([]);
    expect(withheld.body).toContain("Instagram no deja ver este mensaje");
    expect(msg(igReceived({ message: { text: null, attachments: [card] } })).body).toContain("Compartió una publicación");
  });

  it("un adjunto sin url junto a otro con url: solo se descarga el que trae archivo", () => {
    const e = msg(igReceived({ message: { text: null, attachments: [{ type: "ephemeral" }, { type: "image", url: "https://cdn.example/f.jpg" }] } }));
    expect(e.attachments).toHaveLength(1);
    expect(e.attachments[0]).toMatchObject({ type: "image", url: "https://cdn.example/f.jpg" });
  });

  it("acepta reacciones y ediciones de Instagram", () => {
    const reaction = normalizeZernioEvent({
      id: "evt_r",
      event: "reaction.received",
      reaction: { emoji: "❤️", action: "added", platformMessageId: "aWdfMID", sender: { id: IGSID }, reactedAt: "2026-10-02T18:01:00Z" },
      conversation: { id: "6ab0000000000000000000c1", participantId: IGSID },
      account: { id: "zacc_ig", platform: "instagram" },
      timestamp: "2026-10-02T18:01:00Z",
    });
    expect(reaction).toMatchObject({ kind: "reaction", side: "contact", emoji: "❤️" });
  });
});

function okResponse(data: Record<string, unknown>) {
  return Response.json({ success: true, data });
}

function provider(responses: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      key: new Headers(init?.headers).get("Idempotency-Key"),
    });
    const next = responses.shift();
    if (!next) throw new Error("sin respuesta preparada");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { p: new ZernioProvider({ apiKey: "sk_test", webhookSecret: "whsec" }, fetchImpl), calls };
}

const target = { providerAccountId: "zacc_ig", providerConversationId: "6ab0000000000000000000c1", platform: "instagram" as const };

describe("ZernioProvider · envío a Instagram", () => {
  it("un texto corto: un POST; el id de Meta es el providerMessageId (lo trae su eco)", async () => {
    const { p, calls } = provider([okResponse({ messageId: "aWdfMID1", conversationId: IGSID })]);
    const out = await p.sendText({ ...target, text: "Claro, ¿qué medida tiene?", idempotencyKey: "msg_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ accountId: "zacc_ig", message: "Claro, ¿qué medida tiene?" });
    expect(calls[0].key).toBe("msg_1");
    expect(out).toEqual({ providerInternalId: "aWdfMID1", providerMessageId: "aWdfMID1" });
  });

  it("de 24 h a 7 días: manda la etiqueta HUMAN_AGENT en cada parte", async () => {
    const { p, calls } = provider([okResponse({ messageId: "aWdfMID1" })]);
    await p.sendText({ ...target, humanAgentTag: true, text: "Hola de nuevo", idempotencyKey: "msg_2" });
    expect(calls[0].body).toMatchObject({ messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" });
  });

  it("un texto de más de 1,000 bytes sale en partes con claves -p2…; los otros ids quedan como partes", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `La compuerta número ${i + 1} protege la entrada contra el agua.`).join(" ");
    const { p, calls } = provider([okResponse({ messageId: "MID_A" }), okResponse({ messageId: "MID_B" }), okResponse({ messageId: "MID_C" })]);
    const out = await p.sendText({ ...target, humanAgentTag: true, text: long, idempotencyKey: "msg_3" });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.map((c) => c.key)).toEqual(["msg_3", "msg_3-p2", "msg_3-p3"].slice(0, calls.length));
    expect(calls.every((c) => new TextEncoder().encode(String(c.body.message)).length <= 1000)).toBe(true);
    expect(calls.every((c) => c.body.messageTag === "HUMAN_AGENT")).toBe(true);
    expect(out.providerMessageId).toBe("MID_A");
    expect(out.extraProviderMessageIds).toEqual(["MID_B", "MID_C"].slice(0, calls.length - 1));
    expect(out.warning).toBeUndefined();
  });

  it("si una parte posterior no sale, el mensaje cuenta como enviado con aviso", async () => {
    const long = "palabra ".repeat(300);
    const { p } = provider([okResponse({ messageId: "MID_A" }), Response.json({ error: { message: "Meta rechazó" } }, { status: 400 })]);
    const out = await p.sendText({ ...target, text: long, idempotencyKey: "msg_4" });
    expect(out.providerMessageId).toBe("MID_A");
    expect(out.warning).toMatch(/parte 2 de \d+ del texto no salió/);
  });

  it("si una parte posterior da 429, se repite TODO el envío (lo ya salido no se duplica por su clave)", async () => {
    const long = "palabra ".repeat(300);
    const { p } = provider([okResponse({ messageId: "MID_A" }), Response.json({ error: { message: "lento" } }, { status: 429 })]);
    await expect(p.sendText({ ...target, text: long, idempotencyKey: "msg_5" })).rejects.toMatchObject({ outcome: "rate_limited" });
  });

  it("si la PRIMERA parte falla, el envío falla como siempre", async () => {
    const { p } = provider([Response.json({ error: { message: "fuera de ventana" } }, { status: 400 })]);
    await expect(p.sendText({ ...target, text: "hola", idempotencyKey: "msg_6" })).rejects.toBeInstanceOf(ZernioSendError);
  });

  it("archivo con pie: un POST; Zernio devuelve los dos ids (archivo y texto)", async () => {
    const { p, calls } = provider([okResponse({ messageId: "MID_FILE", messageIds: ["MID_FILE", "MID_TEXT"] })]);
    const out = await p.sendMedia({ ...target, url: "https://bucket.example/a.jpg", kind: "image", caption: "Esta es la tabla", idempotencyKey: "msg_7" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ attachmentUrl: "https://bucket.example/a.jpg", attachmentType: "image", message: "Esta es la tabla" });
    expect(out).toMatchObject({ providerMessageId: "MID_FILE", extraProviderMessageIds: ["MID_TEXT"] });
  });

  it("archivo con pie rechazado por Meta (partialFailure): salió el archivo, con aviso", async () => {
    const { p } = provider([okResponse({ messageId: "MID_FILE", partialFailure: { part: "text", error: "too long" } })]);
    const out = await p.sendMedia({ ...target, url: "https://bucket.example/a.jpg", kind: "image", caption: "x", idempotencyKey: "msg_8" });
    expect(out.warning).toMatch(/Salió el archivo, pero Instagram rechazó el texto/);
  });

  it("un pie de más de 1,000 bytes: el archivo solo y el texto en partes después", async () => {
    const caption = "ñ".repeat(800); // 1,600 bytes
    const { p, calls } = provider([okResponse({ messageId: "MID_FILE" }), okResponse({ messageId: "MID_T1" }), okResponse({ messageId: "MID_T2" })]);
    const out = await p.sendMedia({ ...target, url: "https://bucket.example/v.mp4", kind: "video", caption, idempotencyKey: "msg_9" });
    expect(calls[0].body.message).toBeUndefined();
    expect(calls.slice(1).map((c) => c.key)).toEqual(["msg_9-p2", "msg_9-p3"]);
    expect(out.extraProviderMessageIds).toEqual(["MID_T1", "MID_T2"]);
  });

  it("WhatsApp no cambia: el pie va en el mismo mensaje y sin partes", async () => {
    const { p, calls } = provider([okResponse({ messageId: "wamid.X" })]);
    const out = await p.sendMedia({ providerAccountId: "zacc_wa", providerConversationId: "zconv", url: "https://bucket.example/a.jpg", kind: "image", caption: "ñ".repeat(800), idempotencyKey: "msg_10" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.message).toBe("ñ".repeat(800));
    expect(out.extraProviderMessageIds).toBeUndefined();
  });
});
