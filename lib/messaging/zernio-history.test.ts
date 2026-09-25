import { describe, expect, it, vi } from "vitest";
import {
  historyEventFromRest,
  ZernioHistoryClient,
  ZernioHistoryError,
  type RestConversation,
} from "./zernio-history";
import { isCoexistenceHistory } from "./zernio";

const conversation: RestConversation = {
  id: "zconv_1",
  participantId: "5216682410001",
  participantName: "Ana",
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "wamid.HIST1",
    conversationId: conversation.id,
    platform: "whatsapp",
    message: "Mensaje anterior",
    senderId: "5216682410001",
    senderName: "Ana",
    direction: "incoming",
    createdAt: "2026-01-02T03:04:05Z",
    sentAt: "2026-01-02T03:00:00Z",
    attachments: [],
    metadata: { source: "coexistence_history" },
    ...overrides,
  };
}

async function collect<T>(items: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

describe("historyEventFromRest", () => {
  it("omite los mensajes que no son del historial", () => {
    expect(historyEventFromRest("zacc_1", conversation, message({ metadata: { source: "live" } }))).toEqual({
      skip: "no es historial",
    });
  });

  it("normaliza entrantes y salientes con su origen, teléfono y marca de historial", () => {
    const incoming = historyEventFromRest("zacc_1", conversation, message());
    expect(incoming).toMatchObject({
      event: {
        eventId: "history-wamid.HIST1",
        providerAccountId: "zacc_1",
        providerConversationId: "zconv_1",
        providerMessageId: "wamid.HIST1",
        direction: "in",
        source: "contact",
        contactPhone: "+5216682410001",
        history: true,
      },
    });

    const outgoing = historyEventFromRest(
      "zacc_1",
      { ...conversation, participantId: "+526682410001" },
      message({ id: "wamid.HIST2", direction: "outgoing" }),
    );
    expect(outgoing).toMatchObject({
      event: {
        eventId: "history-wamid.HIST2",
        direction: "out",
        source: "business_app",
        contactPhone: "+526682410001",
        history: true,
      },
    });
  });

  it("usa sentAt y cae a createdAt; una fecha inválida se omite", () => {
    const sent = historyEventFromRest("zacc_1", conversation, message());
    expect("event" in sent && sent.event.sentAt.toISOString()).toBe("2026-01-02T03:00:00.000Z");

    const created = historyEventFromRest("zacc_1", conversation, message({ sentAt: null }));
    expect("event" in created && created.event.sentAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");

    expect(historyEventFromRest("zacc_1", conversation, message({ sentAt: "ayer", createdAt: "también ayer" }))).toEqual({
      skip: "sin fecha válida (ayer)",
    });
  });

  it("convierte file a document y descarta adjuntos sin URL", () => {
    const parsed = historyEventFromRest(
      "zacc_1",
      conversation,
      message({
        message: null,
        attachments: [
          { id: "media_1", type: "file", url: "https://cdn.test/factura.pdf", mimeType: "application/pdf", filename: "factura.pdf" },
          { id: "media_2", type: "image", url: null, mimeType: "image/jpeg" },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      event: {
        type: "document",
        attachments: [
          {
            type: "document",
            url: "https://cdn.test/factura.pdf",
            mimeType: "application/pdf",
            fileName: "factura.pdf",
            providerMediaId: "media_1",
          },
        ],
      },
    });
  });
});

describe("ZernioHistoryClient", () => {
  it("pagina conversaciones y mensajes por cursor, y manda Authorization Bearer", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer llave_secreta");
      if (url.includes("/messages")) {
        return url.includes("cursor=m2")
          ? Response.json({ messages: [{ id: "m2" }], pagination: { hasMore: false } })
          : Response.json({ messages: [{ id: "m1" }], pagination: { hasMore: true, nextCursor: "m2" } });
      }
      return url.includes("cursor=c2")
        ? Response.json({ data: [{ id: "conv_2", participantId: "+15551234567" }], pagination: { hasMore: false } })
        : Response.json({ data: [{ id: "conv_1", participantId: "+526682410001", participantName: "Ana" }], pagination: { hasMore: true, nextCursor: "c2" } });
    }) as unknown as typeof fetch;
    const client = new ZernioHistoryClient({ apiKey: "llave_secreta", baseUrl: "https://api.test/" }, fetchImpl);

    expect((await collect(client.conversations("zacc_1"))).map((row) => row.id)).toEqual(["conv_1", "conv_2"]);
    expect((await collect(client.messages("zacc_1", "conv/1"))).map((row) => (row as { id: string }).id)).toEqual(["m1", "m2"]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.test/v1/inbox/conversations?accountId=zacc_1&platform=whatsapp&limit=100",
      "https://api.test/v1/inbox/conversations?accountId=zacc_1&platform=whatsapp&limit=100&cursor=c2",
      "https://api.test/v1/inbox/conversations/conv%2F1/messages?accountId=zacc_1&limit=100&sortOrder=asc",
      "https://api.test/v1/inbox/conversations/conv%2F1/messages?accountId=zacc_1&limit=100&sortOrder=asc&cursor=m2",
    ]);
  });

  it("pagina contactos por skip mientras hasMore y normaliza +521", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("skip=100")
        ? Response.json({ contacts: [{ name: "Bob", displayIdentifier: "+15551234567" }], pagination: { hasMore: false } })
        : Response.json({ contacts: [{ name: "Ana", platformIdentifier: "+5216682410001" }], pagination: { hasMore: true } }),
    ) as unknown as typeof fetch;
    const client = new ZernioHistoryClient({ apiKey: "k", baseUrl: "https://api.test" }, fetchImpl);

    expect(await collect(client.contacts("zacc_1"))).toEqual([
      { phoneE164: "+526682410001", name: "Ana" },
      { phoneE164: "+15551234567", name: "Bob" },
    ]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.test/v1/contacts?accountId=zacc_1&platform=whatsapp&limit=100&skip=0",
      "https://api.test/v1/contacts?accountId=zacc_1&platform=whatsapp&limit=100&skip=100",
    ]);
  });

  it("convierte respuestas no exitosas en ZernioHistoryError", async () => {
    const fetchImpl = (async () => Response.json({ error: "no autorizado" }, { status: 401 })) as unknown as typeof fetch;
    const client = new ZernioHistoryClient({ apiKey: "mala" }, fetchImpl);
    await expect(collect(client.conversations("zacc_1"))).rejects.toBeInstanceOf(ZernioHistoryError);
    await expect(collect(client.conversations("zacc_1"))).rejects.toThrow("Zernio respondió 401");
  });
});

describe("isCoexistenceHistory", () => {
  it("acepta variantes sin distinguir mayúsculas ni separadores", () => {
    expect(isCoexistenceHistory("coexistence_history")).toBe(true);
    expect(isCoexistenceHistory("Coexistence-History")).toBe(true);
    expect(isCoexistenceHistory(undefined, "coexistence history")).toBe(true);
  });

  it("rechaza fuentes vivas, valores vacíos y no strings", () => {
    expect(isCoexistenceHistory("whatsapp_business_app")).toBe(false);
    expect(isCoexistenceHistory("", null, { source: "coexistence_history" })).toBe(false);
  });
});
