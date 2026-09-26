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

  it("convierte file a document y conserva como NO disponible un adjunto sin URL (media vieja del historial)", () => {
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
          { type: "image", url: "", mimeType: "image/jpeg", providerMediaId: "media_2" },
        ],
      },
    });
    if (!("event" in parsed)) throw new Error("se esperaba evento");
    expect(parsed.event.attachments[0].unavailable).toBeUndefined();
    expect(parsed.event.attachments[1].unavailable).toMatch(/no trae este archivo/);
  });
});

// Reloj y espera falsos: el ritmo real (1.3 s por petición) no corre en las pruebas.
function fakeTime() {
  let t = 1_000_000;
  const waits: number[] = [];
  return {
    waits,
    pacing: {
      now: () => t,
      sleep: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
    },
  };
}

function client(fetchImpl: typeof fetch, pacing: Record<string, unknown> = {}) {
  const time = fakeTime();
  const c = new ZernioHistoryClient({ apiKey: "llave_secreta", baseUrl: "https://api.test/", pacing: { ...time.pacing, ...pacing } }, fetchImpl);
  return { c, waits: time.waits };
}

function urls(fetchImpl: typeof fetch): string[] {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
}

describe("ZernioHistoryClient", () => {
  it("pagina conversaciones (activas y archivadas, ascendente) y mensajes por cursor, con Authorization Bearer", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer llave_secreta");
      if (url.includes("/messages")) {
        return url.includes("cursor=m2")
          ? Response.json({ messages: [{ id: "m2" }], pagination: { hasMore: false } })
          : Response.json({ messages: [{ id: "m1" }], pagination: { hasMore: true, nextCursor: "m2" } });
      }
      if (url.includes("status=archived")) {
        // conv_2 también sale en archivadas: no se repite; conv_3 solo está archivada.
        return Response.json({ data: [{ id: "conv_2" }, { id: "conv_3", participantId: "5216682410003" }], pagination: { hasMore: false } });
      }
      return url.includes("cursor=c2")
        ? Response.json({ data: [{ id: "conv_2", participantId: "+15551234567", isGroup: true }], pagination: { hasMore: false } })
        : Response.json({ data: [{ id: "conv_1", participantId: "+526682410001", participantName: "Ana" }], pagination: { hasMore: true, nextCursor: "c2" } });
    }) as unknown as typeof fetch;
    const { c } = client(fetchImpl);

    const conversations = await collect(c.conversations("zacc_1"));
    expect(conversations.map((row) => [row.id, row.isGroup])).toEqual([
      ["conv_1", false],
      ["conv_2", true],
      ["conv_3", false],
    ]);
    expect((await collect(c.messages("zacc_1", "conv/1"))).map((row) => (row as { id: string }).id)).toEqual(["m1", "m2"]);
    expect(urls(fetchImpl)).toEqual([
      "https://api.test/v1/inbox/conversations?accountId=zacc_1&platform=whatsapp&limit=100&sortOrder=asc",
      "https://api.test/v1/inbox/conversations?accountId=zacc_1&platform=whatsapp&limit=100&sortOrder=asc&cursor=c2",
      "https://api.test/v1/inbox/conversations?accountId=zacc_1&platform=whatsapp&limit=100&sortOrder=asc&status=archived",
      "https://api.test/v1/inbox/conversations/conv%2F1/messages?accountId=zacc_1&limit=100&sortOrder=asc",
      "https://api.test/v1/inbox/conversations/conv%2F1/messages?accountId=zacc_1&limit=100&sortOrder=asc&cursor=m2",
    ]);
    expect(c.stats.requests).toBe(5);
  });

  it("pagina contactos de 200 en 200 por skip mientras hasMore, normaliza +521 y no repite teléfono", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("skip=200")
        ? Response.json({ contacts: [{ name: "Bob", displayIdentifier: "+15551234567" }, { name: "Ana otra vez", platformIdentifier: "5216682410001" }], pagination: { hasMore: false } })
        : Response.json({ contacts: [{ name: "Ana", platformIdentifier: "+5216682410001" }, { name: "", platformIdentifier: "+5216682410002" }], pagination: { hasMore: true } }),
    ) as unknown as typeof fetch;
    const { c } = client(fetchImpl);

    expect(await collect(c.contacts("zacc_1"))).toEqual([
      { phoneE164: "+526682410001", name: "Ana" },
      { phoneE164: "+15551234567", name: "Bob" },
    ]);
    expect(urls(fetchImpl)).toEqual([
      "https://api.test/v1/contacts?accountId=zacc_1&platform=whatsapp&limit=200&skip=0",
      "https://api.test/v1/contacts?accountId=zacc_1&platform=whatsapp&limit=200&skip=200",
    ]);
  });

  it("va a su propio ritmo: espera el intervalo mínimo entre peticiones", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ messages: [{ id: "m" }], pagination: { hasMore: false } })) as unknown as typeof fetch;
    const { c, waits } = client(fetchImpl, { minIntervalMs: 1_300 });
    await collect(c.messages("zacc_1", "a"));
    await collect(c.messages("zacc_1", "b"));
    await collect(c.messages("zacc_1", "c"));
    expect(waits).toEqual([1_300, 1_300]);
  });

  it("con pocas peticiones restantes en la ventana espera al reinicio (reserva para el CRM en vivo)", async () => {
    const time = fakeTime();
    const resetAt = Math.floor((1_000_000 + 40_000) / 1000); // Unix en segundos
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { messages: [], pagination: { hasMore: false } },
        { headers: { "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "8", "X-RateLimit-Reset": String(resetAt) } },
      ),
    ) as unknown as typeof fetch;
    const c = new ZernioHistoryClient({ apiKey: "k", baseUrl: "https://api.test", pacing: { ...time.pacing, minIntervalMs: 100, reserve: 10 } }, fetchImpl);
    await collect(c.messages("zacc_1", "a"));
    await collect(c.messages("zacc_1", "b"));
    // La 2.ª petición espera hasta el reinicio (+250 ms), no solo los 100 ms del ritmo.
    expect(time.waits[0]).toBe(40_000 - 0 + 250);
  });

  it("429: espera lo que dice Retry-After y repite la MISMA petición", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return Response.json({ error: "Rate limit exceeded", details: { retryAfterSeconds: 7 } }, { status: 429, headers: { "Retry-After": "7" } });
      return Response.json({ messages: [{ id: "m1" }], pagination: { hasMore: false } });
    }) as unknown as typeof fetch;
    const { c, waits } = client(fetchImpl, { minIntervalMs: 0 });
    expect((await collect(c.messages("zacc_1", "a"))).length).toBe(1);
    expect(urls(fetchImpl)[0]).toBe(urls(fetchImpl)[1]);
    expect(waits).toContain(7_250);
    expect(c.stats).toMatchObject({ requests: 2, throttled: 1, retries: 0 });
  });

  it("si Zernio pide esperar más de 5 min se detiene con un error reanudable (no se queda colgado un día)", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "Rate limit" }, { status: 429, headers: { "Retry-After": "86400" } })) as unknown as typeof fetch;
    const { c, waits } = client(fetchImpl, { minIntervalMs: 0 });
    const error = await collect(c.messages("zacc_1", "a")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZernioHistoryError);
    expect((error as ZernioHistoryError).retryable).toBe(true);
    expect(waits).toEqual([]);
  });

  it("5xx y red caída: reintenta con espera creciente y sigue", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("bad gateway", { status: 502 });
      if (calls === 2) throw new TypeError("fetch failed");
      return Response.json({ messages: [{ id: "m1" }], pagination: { hasMore: false } });
    }) as unknown as typeof fetch;
    const { c, waits } = client(fetchImpl, { minIntervalMs: 0 });
    expect((await collect(c.messages("zacc_1", "a"))).length).toBe(1);
    expect(waits).toEqual([2_000, 4_000]);
    expect(c.stats.retries).toBe(2);
  });

  it("5xx sin fin: se rinde con un error reanudable tras maxAttempts", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const { c, waits } = client(fetchImpl, { minIntervalMs: 0, maxAttempts: 4 });
    const error = await collect(c.messages("zacc_1", "a")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZernioHistoryError);
    expect((error as ZernioHistoryError).retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([2_000, 4_000, 8_000]);
  });

  it("401/403/404 no se reintentan", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "no autorizado" }, { status: 401 })) as unknown as typeof fetch;
    const { c } = client(fetchImpl);
    const error = await collect(c.conversations("zacc_1")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZernioHistoryError);
    expect((error as Error).message).toContain("Zernio respondió 401");
    expect((error as ZernioHistoryError).retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("un listado incompleto (meta.accountsFailed) se repite; nunca se toma como la lista completa", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("status=archived")) return Response.json({ data: [], pagination: { hasMore: false } });
      calls++;
      return calls === 1
        ? Response.json({ data: [], pagination: { hasMore: false }, meta: { accountsFailed: 1, failedAccounts: [{ accountId: "zacc_1" }] } })
        : Response.json({ data: [{ id: "conv_1" }], pagination: { hasMore: false }, meta: { accountsFailed: 0, failedAccounts: [] } });
    }) as unknown as typeof fetch;
    const { c } = client(fetchImpl, { minIntervalMs: 0 });
    expect((await collect(c.conversations("zacc_1"))).map((r) => r.id)).toEqual(["conv_1"]);
    expect(c.stats.retries).toBe(1);
  });

  it("un cursor repetido o hasMore sin cursor detienen la corrida (no se salta ni se cicla)", async () => {
    const loop = vi.fn(async () => Response.json({ messages: [{ id: "m" }], pagination: { hasMore: true, nextCursor: "igual" } })) as unknown as typeof fetch;
    await expect(collect(client(loop).c.messages("zacc_1", "a"))).rejects.toThrow(/repitió un cursor/);
    const lost = vi.fn(async () => Response.json({ messages: [{ id: "m" }], pagination: { hasMore: true } })) as unknown as typeof fetch;
    await expect(collect(client(lost).c.messages("zacc_1", "a"))).rejects.toThrow(/no dio cursor/);
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
