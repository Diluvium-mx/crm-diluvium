import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeZernioEvent, verifyZernioSignature, ZernioProvider, ZernioSendError } from "./zernio";

const SECRET = "whsec_test";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

// Forma de message.received según el adaptador oficial de Zernio (src/types.ts).
function received(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    event: "message.received",
    timestamp: "2026-09-18T20:00:00.000Z",
    message: {
      id: "zmsg_1",
      conversationId: "zconv_1",
      platform: "whatsapp",
      platformMessageId: "wamid.HBgM1",
      direction: "incoming",
      text: "Hola, ¿tienen disponible?",
      attachments: [],
      sender: { id: "5216682419000", name: "Cliente Uno", phoneNumber: "5216682419000" },
      sentAt: "2026-09-18T19:59:58.000Z",
      isRead: false,
    },
    conversation: {
      id: "zconv_1",
      platformConversationId: "5216682419000",
      participantId: "5216682419000",
      participantName: "Cliente Uno",
      status: "active",
    },
    account: { id: "zacc_1", platform: "whatsapp", username: "diluvium" },
    ...overrides,
  };
}

function echo(source: string) {
  const base = received();
  return {
    ...base,
    id: "evt_2",
    event: "message.sent",
    message: {
      ...base.message,
      id: "zmsg_2",
      platformMessageId: "wamid.OUT2",
      direction: "outgoing",
      text: "Sí, le mando la factura",
      sender: { id: "zacc_1", name: "Diluvium" },
      source,
    },
  };
}

describe("verifyZernioSignature", () => {
  const body = JSON.stringify(received());

  it("acepta la firma HMAC-SHA256 hex del body crudo", () => {
    expect(verifyZernioSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rechaza firma ausente, con otro secret, no hex o de otro body", () => {
    expect(verifyZernioSignature(body, null, SECRET)).toBe(false);
    expect(verifyZernioSignature(body, sign(body, "otro"), SECRET)).toBe(false);
    expect(verifyZernioSignature(body, "zz-no-hex", SECRET)).toBe(false);
    expect(verifyZernioSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyZernioSignature(body, sign(body).slice(0, 10), SECRET)).toBe(false);
  });

  it("sin secret configurado rechaza todo (nunca acepta por omisión)", () => {
    expect(verifyZernioSignature(body, sign(body, ""), "")).toBe(false);
  });

  it("el proveedor lee X-Zernio-Signature y el alias legado X-Late-Signature", () => {
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET });
    expect(p.verifyWebhook(body, new Headers({ "x-zernio-signature": sign(body) }))).toBe(true);
    expect(p.verifyWebhook(body, new Headers({ "x-late-signature": sign(body) }))).toBe(true);
    expect(p.verifyWebhook(body, new Headers())).toBe(false);
  });
});

describe("normalizeZernioEvent", () => {
  it("mensaje entrante del contacto", () => {
    const e = normalizeZernioEvent(received());
    expect(e).toMatchObject({
      kind: "message",
      eventId: "evt_1",
      providerAccountId: "zacc_1",
      providerConversationId: "zconv_1",
      direction: "in",
      source: "contact",
      providerMessageId: "wamid.HBgM1",
      providerInternalId: "zmsg_1",
      contactPhone: "+5216682419000",
      contactName: "Cliente Uno",
      type: "text",
      body: "Hola, ¿tienen disponible?",
    });
    expect(e.kind === "message" && e.sentAt.toISOString()).toBe("2026-09-18T19:59:58.000Z");
  });

  it("coexistencia: lo enviado desde la app del celular es eco saliente de business_app", () => {
    const e = normalizeZernioEvent(echo("whatsapp_business_app"));
    expect(e).toMatchObject({
      kind: "message",
      direction: "out",
      source: "business_app",
      providerMessageId: "wamid.OUT2",
      // En un saliente el sender es el negocio: el contacto sale del participante.
      contactPhone: "+5216682419000",
    });
  });

  it("tolera variantes de escritura del source (whatsappbusinessapp, mayúsculas)", () => {
    expect(normalizeZernioEvent(echo("whatsappbusinessapp"))).toMatchObject({ source: "business_app" });
    expect(normalizeZernioEvent(echo("WhatsApp-Business-App"))).toMatchObject({ source: "business_app" });
  });

  it("cloud_api (API, dashboard, difusiones) y fuentes desconocidas NO se asumen humanas", () => {
    expect(normalizeZernioEvent(echo("cloud_api"))).toMatchObject({ direction: "out", source: "other_api" });
    expect(normalizeZernioEvent(echo("otra_cosa"))).toMatchObject({ direction: "out", source: "other_api" });
  });

  it("adjuntos: file → document (p. ej. el XML de factura mandado desde la app)", () => {
    const base = received();
    const e = normalizeZernioEvent({
      ...base,
      message: {
        ...base.message,
        text: null,
        attachments: [
          { type: "file", url: "https://cdn.zernio/x.xml", payload: { mimeType: "application/xml", filename: "F-123.xml" } },
        ],
      },
    });
    expect(e).toMatchObject({
      type: "document",
      body: null,
      attachments: [{ type: "document", url: "https://cdn.zernio/x.xml", mimeType: "application/xml", fileName: "F-123.xml" }],
    });
  });

  it("conserva la atribución de anuncio Click-to-WhatsApp", () => {
    const e = normalizeZernioEvent(received({ metadata: { referral: { ctwa_clid: "abc", source_id: "ad_9" } } }));
    expect(e).toMatchObject({ referral: { ctwa_clid: "abc", source_id: "ad_9" } });
  });

  it("estados: delivered/read/failed con id del mensaje", () => {
    const delivered = normalizeZernioEvent({
      id: "evt_3",
      event: "message.delivered",
      timestamp: "2026-09-18T20:01:00.000Z",
      message: { id: "zmsg_2", platformMessageId: "wamid.OUT2" },
      account: { id: "zacc_1", platform: "whatsapp" },
    });
    expect(delivered).toMatchObject({
      kind: "status",
      status: "delivered",
      providerAccountId: "zacc_1",
      providerMessageId: "wamid.OUT2",
      providerInternalId: "zmsg_2",
    });

    const failed = normalizeZernioEvent({
      id: "evt_4",
      event: "message.failed",
      message: { id: "zmsg_5", error: { code: 131047, message: "Re-engagement message" } },
    });
    expect(failed).toMatchObject({ kind: "status", status: "failed", providerInternalId: "zmsg_5", errorCode: "131047", errorMessage: "Re-engagement message" });
  });

  it("nunca lanza con formatos desconocidos: devuelve ignored (el crudo queda guardado)", () => {
    expect(normalizeZernioEvent({ id: "evt_5", event: "post.published" })).toMatchObject({ kind: "ignored", eventId: "evt_5" });
    expect(normalizeZernioEvent({ id: "evt_6", event: "message.received", message: {} })).toMatchObject({ kind: "ignored", eventId: "evt_6" });
    expect(normalizeZernioEvent({ id: "evt_7", event: "message.read" })).toMatchObject({ kind: "ignored", reason: expect.stringContaining("sin id") });
    expect(normalizeZernioEvent(null)).toMatchObject({ kind: "ignored" });
    expect(normalizeZernioEvent(received({ account: { id: "a", platform: "instagram" } }))).toMatchObject({ kind: "ignored" });
  });
});

describe("ZernioProvider.sendText", () => {
  it("POST a /v1/inbox/conversations/{id}/messages con Bearer y devuelve el messageId", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true, data: { messageId: "zmsg_9" } }),
    ) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "sk_live", webhookSecret: SECRET }, fetchImpl);
    const out = await p.sendText({ providerAccountId: "zacc_1", providerConversationId: "zconv_1", text: "Hola" });

    expect(out).toEqual({ providerInternalId: "zmsg_9", providerMessageId: undefined });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/zconv_1/messages");
    expect(init.headers.Authorization).toBe("Bearer sk_live");
    expect(JSON.parse(init.body)).toEqual({ accountId: "zacc_1", message: "Hola" });
  });

  it("si Zernio devuelve el wamid como messageId, se reconoce como wamid", async () => {
    const fetchImpl = (async () =>
      Response.json({ success: true, data: { messageId: "wamid.HBgABC=" } })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(p.sendText({ providerAccountId: "a", providerConversationId: "c", text: "x" })).resolves.toEqual({
      providerInternalId: "wamid.HBgABC=",
      providerMessageId: "wamid.HBgABC=",
    });
  });

  it("un error del proveedor se propaga con código y mensaje (para messages.error_code)", async () => {
    const fetchImpl = (async () =>
      Response.json({ error: { code: "WINDOW_CLOSED", message: "Fuera de la ventana de 24 h" } }, { status: 400 })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(
      p.sendText({ providerAccountId: "a", providerConversationId: "c", text: "x" }),
    ).rejects.toMatchObject(new ZernioSendError(400, "WINDOW_CLOSED", "Fuera de la ventana de 24 h"));
  });
});
