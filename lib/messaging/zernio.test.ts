import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeZernioEvent, verifyZernioSignature, zernioAccountId, ZernioProvider, ZernioSendError } from "./zernio";

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
    const out = await p.sendText({ providerAccountId: "zacc_1", providerConversationId: "zconv_1", text: "Hola", idempotencyKey: "msg_1" });

    expect(out).toEqual({ providerInternalId: "zmsg_9", providerMessageId: undefined });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/zconv_1/messages");
    expect(init.headers.Authorization).toBe("Bearer sk_live");
    expect(init.headers["Idempotency-Key"]).toBe("msg_1");
    expect(JSON.parse(init.body)).toEqual({ accountId: "zacc_1", message: "Hola" });
  });

  it("si Zernio devuelve el wamid como messageId, se reconoce como wamid", async () => {
    const fetchImpl = (async () =>
      Response.json({ success: true, data: { messageId: "wamid.HBgABC=" } })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(p.sendText({ providerAccountId: "a", providerConversationId: "c", text: "x", idempotencyKey: "k1" })).resolves.toEqual({
      providerInternalId: "wamid.HBgABC=",
      providerMessageId: "wamid.HBgABC=",
    });
  });

  it("un error del proveedor se propaga con código y mensaje (para messages.error_code)", async () => {
    const fetchImpl = (async () =>
      Response.json({ error: { code: "WINDOW_CLOSED", message: "Fuera de la ventana de 24 h" } }, { status: 400 })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(
      p.sendText({ providerAccountId: "a", providerConversationId: "c", text: "x", idempotencyKey: "k1" }),
    ).rejects.toMatchObject({ code: "WINDOW_CLOSED", message: "Fuera de la ventana de 24 h", outcome: "rejected" });
  });

  it("resultado desconocido (5xx, 409, timeout, 2xx sin id) vs. rechazo definitivo (4xx)", async () => {
    const send = (fetchImpl: typeof fetch) =>
      new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl).sendText({
        providerAccountId: "a",
        providerConversationId: "c",
        text: "x",
        idempotencyKey: "k1",
      });
    const status = (code: number) => (async () => Response.json({}, { status: code })) as unknown as typeof fetch;
    await expect(send(status(502))).rejects.toMatchObject({ outcome: "unknown" });
    await expect(send(status(409))).rejects.toMatchObject({ outcome: "unknown" });
    await expect(send(status(429))).rejects.toMatchObject({ outcome: "rejected" });
    await expect(send(status(422))).rejects.toMatchObject({ outcome: "rejected" });
    const timeout = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(send(timeout)).rejects.toMatchObject({ outcome: "unknown", code: "network" });
    await expect(send((async () => Response.json({ ok: true })) as unknown as typeof fetch)).rejects.toMatchObject({
      outcome: "unknown",
      code: "sin_message_id",
    });
    await expect(send(status(400))).rejects.toBeInstanceOf(ZernioSendError);
  });
});

describe("sentAt inválido → malformado (no se inventa 'ahora')", () => {
  it("un message.received con sentAt ilegible se marca malformed", () => {
    const bad = {
      id: "evt_ts",
      event: "message.received",
      message: {
        id: "z1",
        conversationId: "c1",
        platform: "whatsapp",
        platformMessageId: "wamid.TS",
        direction: "incoming",
        text: "hola",
        attachments: [],
        sender: { id: "5216682410001", name: "C", phoneNumber: "5216682410001" },
        sentAt: "no-es-fecha",
      },
      conversation: { id: "c1", participantId: "5216682410001" },
      account: { id: "zacc_1", platform: "whatsapp" },
    };
    expect(normalizeZernioEvent(bad)).toMatchObject({ kind: "ignored", malformed: true });
  });
});

describe("zernioAccountId (allowlist)", () => {
  it("lee la cuenta de account.accountId/account.id o anidada, y no elige si se contradicen", () => {
    expect(zernioAccountId({ account: { id: "a1", accountId: "a1" } })).toBe("a1");
    expect(zernioAccountId({ message: { accountId: "a2" } })).toBe("a2");
    expect(zernioAccountId({ data: { accountId: "a3" } })).toBe("a3");
    expect(zernioAccountId({ account: { id: "a1" }, message: { accountId: "otro" } })).toBeUndefined();
    expect(zernioAccountId({ event: "webhook.test" })).toBeUndefined();
  });
});

describe("ZernioProvider.sendTemplate", () => {
  const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls;

  it("POST con template.elements[0] (name, language, components) e Idempotency-Key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, data: { messageId: "zmsg_t" } })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "sk", webhookSecret: SECRET }, fetchImpl);
    const out = await p.sendTemplate({
      providerAccountId: "zacc_1",
      providerConversationId: "zconv_1",
      name: "order_confirmation",
      language: "es_MX",
      bodyParams: ["Ana", "ORD-7"],
      idempotencyKey: "msg_t",
    });
    expect(out).toEqual({ providerInternalId: "zmsg_t", providerMessageId: undefined });
    const [url, init] = calls(fetchImpl)[0];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/zconv_1/messages");
    expect(init.headers["Idempotency-Key"]).toBe("msg_t");
    expect(JSON.parse(init.body)).toEqual({
      accountId: "zacc_1",
      template: {
        elements: [
          {
            name: "order_confirmation",
            language: "es_MX",
            components: [
              { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "ORD-7" }] },
            ],
          },
        ],
      },
    });
  });

  it("sin variables NO manda components", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, data: { messageId: "z" } })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "sk", webhookSecret: SECRET }, fetchImpl);
    await p.sendTemplate({ providerAccountId: "a", providerConversationId: "c", name: "bienvenida", language: "es", bodyParams: [], idempotencyKey: "k" });
    expect(JSON.parse(calls(fetchImpl)[0][1].body)).toEqual({
      accountId: "a",
      template: { elements: [{ name: "bienvenida", language: "es" }] },
    });
  });

  it("un rechazo del proveedor se propaga como sendText (outcome rejected)", async () => {
    const fetchImpl = (async () => Response.json({ error: { code: "TEMPLATE_PAUSED", message: "Plantilla pausada" } }, { status: 400 })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(
      p.sendTemplate({ providerAccountId: "a", providerConversationId: "c", name: "x", language: "es", bodyParams: [], idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "TEMPLATE_PAUSED", outcome: "rejected" });
  });
});

describe("ZernioProvider.listTemplates", () => {
  const p = (fetchImpl: typeof fetch) => new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);

  it("GET con accountId y normaliza a ProviderTemplate (body, variables, status)", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        success: true,
        templates: [
          {
            id: "111",
            name: "order_confirmation",
            status: "APPROVED",
            category: "UTILITY",
            language: "es_MX",
            components: [
              { type: "BODY", text: "Hola {{1}}, pedido {{2}}.", example: { body_text: [["Ana", "ORD-7"]] } },
            ],
          },
          { id: "222", name: "sin_body", status: "PENDING", category: "MARKETING", language: "es", components: [{ type: "HEADER", text: "x" }] },
        ],
      }),
    ) as unknown as typeof fetch;
    const out = await p(fetchImpl).listTemplates("zacc_1");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/whatsapp/templates?accountId=zacc_1");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(out).toEqual([
      {
        providerTemplateId: "111",
        name: "order_confirmation",
        language: "es_MX",
        category: "UTILITY",
        status: "APPROVED",
        bodyText: "Hola {{1}}, pedido {{2}}.",
        variables: [{ index: 1, example: "Ana" }, { index: 2, example: "ORD-7" }],
        requiresUnsupportedParams: false,
      },
      {
        providerTemplateId: "222",
        name: "sin_body",
        language: "es",
        category: "MARKETING",
        status: "PENDING",
        bodyText: null,
        variables: [],
        requiresUnsupportedParams: false,
      },
    ]);
  });

  it("marca requiresUnsupportedParams cuando la plantilla lleva encabezado de media", async () => {
    const fetchImpl = (async () =>
      Response.json({
        templates: [
          {
            id: "333",
            name: "con_media",
            language: "es_MX",
            status: "APPROVED",
            components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola {{1}}" }],
          },
        ],
      })) as unknown as typeof fetch;
    const [t] = await p(fetchImpl).listTemplates("a");
    expect(t.requiresUnsupportedParams).toBe(true);
  });

  it("marca requiresUnsupportedParams cuando el cuerpo usa variables con nombre", async () => {
    const fetchImpl = (async () =>
      Response.json({
        templates: [
          { id: "444", name: "con_nombre", language: "es_MX", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{cliente}}" }] },
        ],
      })) as unknown as typeof fetch;
    const [t] = await p(fetchImpl).listTemplates("a");
    expect(t.requiresUnsupportedParams).toBe(true);
    expect(t.variables).toEqual([]);
  });

  // Falla CERRADO: la sincronización usa la lista como censo completo, así que
  // una respuesta dudosa NUNCA debe volverse una lista parcial (borraría plantillas).
  it("lanza ante una fila sin name/language/status (no la descarta en silencio)", async () => {
    const fetchImpl = (async () =>
      Response.json({ templates: [{ name: "", status: "APPROVED", language: "es", components: [] }] })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).rejects.toMatchObject({ name: "ZernioApiError" });
  });

  it("lanza ante un cuerpo sin `templates` ni `data` (formato desconocido)", async () => {
    const fetchImpl = (async () => Response.json({ success: true, cosa: 1 })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).rejects.toMatchObject({ name: "ZernioApiError" });
  });

  it("lanza ante un 200 con JSON ilegible (no lo trata como lista vacía)", async () => {
    const fetchImpl = (async () => new Response("no-json", { status: 200 })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).rejects.toMatchObject({ name: "ZernioApiError" });
  });

  it("lanza si dice hasMore:true pero NO da nextCursor (respuesta degradada)", async () => {
    const fetchImpl = (async () =>
      Response.json({
        templates: [{ id: "x", name: "t", language: "es", status: "APPROVED", components: [] }],
        pagination: { hasMore: true },
      })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).rejects.toMatchObject({ name: "ZernioApiError" });
  });

  it("una sola página sin info de paginación se toma como censo completo", async () => {
    const fetchImpl = (async () =>
      Response.json({ templates: [{ id: "x", name: "t", language: "es", status: "APPROVED", components: [] }] })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).resolves.toHaveLength(1);
  });

  it("lanza si se agota el tope de páginas con un cursor todavía pendiente", async () => {
    // Cada página devuelve una fila y SIEMPRE un nextCursor: nunca termina → aborta.
    const fetchImpl = (async () =>
      Response.json({
        templates: [{ id: "x", name: "t", language: "es", status: "APPROVED", components: [] }],
        pagination: { hasMore: true, nextCursor: "c" },
      })) as unknown as typeof fetch;
    await expect(p(fetchImpl).listTemplates("a")).rejects.toMatchObject({ name: "ZernioApiError" });
  });
});

describe("ZernioProvider.createTemplate", () => {
  it("POST /v1/whatsapp/templates con components.body + example y devuelve status", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: "999", status: "PENDING" } })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    const out = await p.createTemplate({
      providerAccountId: "zacc_1",
      name: "promo_lluvias",
      language: "es_MX",
      category: "MARKETING",
      bodyText: "Hola {{1}}",
      bodyExample: ["Ana"],
    });
    expect(out).toEqual({ providerTemplateId: "999", status: "PENDING" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/whatsapp/templates");
    expect(JSON.parse(init.body)).toEqual({
      accountId: "zacc_1",
      name: "promo_lluvias",
      language: "es_MX",
      category: "MARKETING",
      components: [{ type: "body", text: "Hola {{1}}", example: { body_text: [["Ana"]] } }],
    });
  });

  it("un error de la API lanza ZernioApiError con el status", async () => {
    const fetchImpl = (async () => Response.json({ error: { message: "nombre duplicado" } }, { status: 409 })) as unknown as typeof fetch;
    const p = new ZernioProvider({ apiKey: "k", webhookSecret: SECRET }, fetchImpl);
    await expect(
      p.createTemplate({ providerAccountId: "a", name: "x", language: "es", category: "UTILITY", bodyText: "hola", bodyExample: [] }),
    ).rejects.toMatchObject({ name: "ZernioApiError", httpStatus: 409 });
  });
});
