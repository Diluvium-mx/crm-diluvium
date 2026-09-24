// Mensajes de anuncios de clic a WhatsApp con el formato EXACTO que Zernio
// confirmó por escrito (24-sep-2026): evento "plano" (sin id, sin message{},
// sin sentAt) con la ficha en `referral` (raíz) y en `metadata.referral`.
import { describe, expect, it } from "vitest";
import example from "./__fixtures__/zernio-ctwa-received.json";
import real from "./__fixtures__/zernio-message-received.json";
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
    // Sin sentAt en el evento: hora de recepción del webhook (nunca "ahora").
    expect(event.sentAt).toEqual(RECEIVED_AT);
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

  it("sin hora en ninguna parte y sin hora de recepción → malformado (dead-letter, no se pierde)", () => {
    const event = normalizeZernioEvent(clone(example));
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

describe("ZernioProvider.conversationAdClick (respaldo)", () => {
  it("GET con accountId y lee el clic de metadata.ctwa_*", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          data: {
            id: "zconv_9",
            metadata: {
              ctwa_clid: "ARAkZ",
              ctwa_source_id: "120251044855190604",
              ctwa_source_url: "https://fb.me/x",
              ctwa_headline: "IMG 14",
              ctwa_source_type: "ad",
              ctwa_captured_at: "2026-09-24T18:00:00.000Z",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, fetchImpl);
    const click = await provider.conversationAdClick("zacc_1", "zconv_9");
    expect(calls[0]).toBe("https://zernio.com/api/v1/inbox/conversations/zconv_9?accountId=zacc_1");
    expect(click?.referral).toEqual({
      source_id: "120251044855190604",
      source_url: "https://fb.me/x",
      headline: "IMG 14",
      source_type: "ad",
      ctwa_clid: "ARAkZ",
    });
    expect(click?.capturedAt?.toISOString()).toBe("2026-09-24T18:00:00.000Z");
  });

  it("id inexistente: Zernio responde 200 con datos vacíos → sin clic (no se confía en un 404)", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: { id: "sim-no-existe", accountId: "zacc_1", participants: [] } }), { status: 200 })) as typeof fetch;
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, fetchImpl);
    expect(await provider.conversationAdClick("zacc_1", "sim-no-existe")).toBeNull();
  });

  it("rechaza ids con formato raro (no arma rutas con '..' o '/')", async () => {
    const provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" }, (async () => new Response("{}")) as typeof fetch);
    await expect(provider.conversationAdClick("zacc_1", "../v1/otra")).rejects.toThrow();
  });

  it("un error de Zernio lanza (el job se reintenta)", async () => {
    const provider = new ZernioProvider(
      { apiKey: "k", webhookSecret: "s" },
      (async () => new Response(JSON.stringify({ error: "boom" }), { status: 503 })) as typeof fetch,
    );
    await expect(provider.conversationAdClick("zacc_1", "zconv_9")).rejects.toThrow();
  });
});
