// Mensajes de anuncios de clic a WhatsApp con el formato EXACTO que Zernio
// confirmó por escrito (24-sep-2026): evento "plano" (sin id, sin message{},
// sin sentAt) con la ficha en `referral` (raíz) y en `metadata.referral`.
import { describe, expect, it } from "vitest";
import example from "./__fixtures__/zernio-ctwa-received.json";
import real from "./__fixtures__/zernio-message-received.json";
import listing from "./__fixtures__/zernio-conversations-ctwa.json";
import { normalizeZernioEvent, zernioEventId, ZernioProvider } from "./zernio";

const RECEIVED_AT = new Date("2026-09-24T18:00:05.000Z");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("formato plano del ejemplo de Zernio", () => {
  it("entra como mensaje entrante con su ficha completa", () => {
    const event = normalizeZernioEvent(clone(example), { receivedAt: RECEIVED_AT });
    expect(event.kind).toBe("message");
    if (event.kind !== "message") return;
    expect(event.direction).toBe("in");
    expect(event.providerMessageId).toBe(example.platformMessageId);
    expect(event.providerInternalId).toBe(example.messageId);
    expect(event.providerConversationId).toBe(example.conversationId);
    expect(event.providerAccountId).toBe("zacc_ctwa");
    expect(event.contactPhone).toBe("+5215512345678");
    expect(event.contactName).toBe("Juan");
    expect(event.body).toBe("Hola, quiero más información");
    expect(event.type).toBe("text");
    // Sin sentAt en el evento: la hora que trae el id de Zernio (ObjectId), no "ahora".
    expect(event.sentAt.toISOString()).toBe(new Date(parseInt(example.messageId.slice(0, 8), 16) * 1000).toISOString());
    expect(event.sentAtFromReceipt).toBe(true);
    // La ficha ORIGINAL completa (todos los campos, tal cual).
    expect(event.referral).toEqual(example.referral);
  });

  it("id del evento derivado del wamid (estable entre reintentos) o del encabezado", () => {
    expect(zernioEventId(example)).toBe(`message.received-${example.platformMessageId}`);
    const headers = new Headers({ "x-zernio-event-id": "evt_hdr_1" });
    expect(zernioEventId(example, headers)).toBe("evt_hdr_1");
    // Un id en el cuerpo manda sobre todo lo demás.
    expect(zernioEventId({ ...example, id: "evt_body" }, headers)).toBe("evt_body");
  });

  it("readEnvelope ya no rechaza el formato plano (antes: 400 y mensaje perdido)", () => {
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    const envelope = provider.readEnvelope(JSON.stringify(example));
    expect(envelope).toEqual({
      eventId: `message.received-${example.platformMessageId}`,
      event: "message.received",
      providerAccountId: "zacc_ctwa",
    });
  });

  it("sin wamid ni id, el sobre sí es inválido (no se inventa identidad)", () => {
    const broken = clone(example) as Record<string, unknown>;
    delete broken.platformMessageId;
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    expect(() => provider.readEnvelope(JSON.stringify(broken))).toThrow();
    expect(normalizeZernioEvent(broken).kind).toBe("ignored");
  });

  it("id de Zernio que no es ObjectId: hora de recepción del webhook", () => {
    const event = normalizeZernioEvent({ ...clone(example), messageId: "zmsg-sin-hora" }, { receivedAt: RECEIVED_AT });
    expect(event.kind === "message" && event.sentAt).toEqual(RECEIVED_AT);
  });

  it("sin hora en ninguna parte y sin hora de recepción → malformado (dead-letter, no se pierde)", () => {
    const event = normalizeZernioEvent({ ...clone(example), messageId: "zmsg-sin-hora" });
    expect(event).toMatchObject({ kind: "ignored", malformed: true });
  });
});

describe("ficha en la raíz con respaldo en metadata.referral (formato anidado real)", () => {
  const ficha = { source_id: "120250108412580604", source_type: "ad", headline: "Protege tu casa", ctwa_clid: "ARAk1" };

  it("solo en la raíz", () => {
    const payload = { ...clone(real), referral: ficha };
    const event = normalizeZernioEvent(payload);
    expect(event.kind === "message" && event.referral).toEqual(ficha);
  });

  it("solo en metadata.referral", () => {
    const payload = { ...clone(real), metadata: { referral: ficha } };
    const event = normalizeZernioEvent(payload);
    expect(event.kind === "message" && event.referral).toEqual(ficha);
  });

  it("en ambas: gana la raíz (Zernio manda la misma)", () => {
    const payload = { ...clone(real), referral: ficha, metadata: { referral: { ...ficha, headline: "otra" } } };
    const event = normalizeZernioEvent(payload);
    expect(event.kind === "message" && event.referral).toEqual(ficha);
  });

  it("sin ctwa_clid y ficha incompleta: el mensaje entra igual con lo que traiga", () => {
    const payload = { ...clone(real), referral: { source_type: "ad" } };
    const event = normalizeZernioEvent(payload);
    expect(event.kind).toBe("message");
    expect(event.kind === "message" && event.referral).toEqual({ source_type: "ad" });
  });

  it("ficha vacía o que no es objeto se ignora (no hay anuncio que atribuir)", () => {
    for (const referral of [{}, null, "x", 3]) {
      const event = normalizeZernioEvent({ ...clone(real), referral });
      expect(event.kind === "message" && event.referral).toBeUndefined();
    }
  });

  it("un eco saliente nunca se atribuye a un anuncio", () => {
    const payload = clone(real) as Record<string, unknown> & { message: Record<string, unknown> };
    payload.event = "message.sent";
    payload.message.direction = "outgoing";
    payload.referral = ficha;
    const event = normalizeZernioEvent(payload);
    expect(event.kind === "message" && event.referral).toBeUndefined();
  });

  it("el mensaje anidado real sigue igual (sentAt del mensaje, no la de recepción)", () => {
    const event = normalizeZernioEvent(clone(real), { receivedAt: RECEIVED_AT });
    expect(event.kind === "message" && event.sentAt.toISOString()).toBe("2026-09-22T19:29:09.000Z");
    expect(event.kind === "message" && event.sentAtFromReceipt).toBeUndefined();
  });
});

describe("ZernioProvider.conversationAdClick (respaldo, forma documentada por Zernio)", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("lista las conversaciones de la cuenta y lee metadata.ctwa_* del ejemplo oficial", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return json(listing);
    }) as typeof fetch;
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, fetchImpl);
    const click = await provider.conversationAdClick("zacc_1", "6ab7aa11bb22cc33dd44ee55");
    // El GET de UNA conversación no trae los ctwa_* de WhatsApp (solo meta_ad_*): se usa el listado.
    expect(calls).toEqual(["https://zernio.com/api/v1/inbox/conversations?accountId=zacc_1&limit=100"]);
    expect(click?.referral).toEqual({
      source_id: "120000000000000000",
      source_url: "https://fb.me/...",
      headline: "Chat with us on WhatsApp",
      source_type: "ad",
      ctwa_clid: "AbCdEfGhIjKlMn0pQrStUvWxYz",
    });
    expect(click?.capturedAt?.toISOString()).toBe("2027-01-01T08:18:44.991Z");
  });

  it("conversación sin metadata (no llegó por anuncio) → sin clic", async () => {
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (async () => json(listing)) as typeof fetch);
    expect(await provider.conversationAdClick("zacc_1", "6ab7aa11bb22cc33dd44ee66")).toBeNull();
  });

  it("recorre páginas con el cursor y se detiene al tope (no la encontró → sin clic)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return json({ data: [{ id: "otra" }], pagination: { hasMore: true, nextCursor: `c${calls.length}` } });
    }) as typeof fetch;
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, fetchImpl);
    expect(await provider.conversationAdClick("zacc_1", "6ab7aa11bb22cc33dd44ee55")).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("cursor=c1");
  });

  it("formato desconocido o error de Zernio → lanza (el respaldo lo anota y reintenta)", async () => {
    const odd = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (async () => json({ conversations: [] })) as typeof fetch);
    await expect(odd.conversationAdClick("zacc_1", "x")).rejects.toThrow(/formato/);
    const down = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (async () => json({ error: "boom" }, 503)) as typeof fetch);
    await expect(down.conversationAdClick("zacc_1", "x")).rejects.toThrow();
  });
});

describe("hora de un mensaje plano sin sentAt ni timestamp", () => {
  it("usa la hora del ObjectId de Zernio antes que la de recepción (entrega tardía)", async () => {
    const { objectIdTime } = await import("./zernio");
    const lateReceipt = new Date("2026-09-22T23:00:00Z"); // Zernio reintentó horas después
    const payload = { ...clone(example), messageId: "6ab2d7068c2cf65b5c4aeb43" };
    const event = normalizeZernioEvent(payload, { receivedAt: lateReceipt });
    expect(event.kind === "message" && event.sentAt.toISOString()).toBe("2026-09-22T19:29:10.000Z");
    // Inverosímil (posterior a la recepción o de hace semanas) → se ignora.
    expect(objectIdTime("6ab2d7068c2cf65b5c4aeb43", new Date("2026-09-01T00:00:00Z"))).toBeNull();
    expect(objectIdTime("no-es-objectid")).toBeNull();
  });
});
