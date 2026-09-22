// Pruebas de estrés de la ingesta contra Postgres REAL: cientos de números
// distintos en paralelo, México en sus tres formatos (521 / 52 / +52), otros
// países, clientes sin teléfono (BSUID), duplicados, todos los tipos de mensaje
// y reacciones/ediciones/borrados. Los payloads salen de uno REAL de producción
// (anonimizado): lib/messaging/__fixtures__/zernio-message-received.json.
// Solo corren con TEST_DATABASE_URL apuntando a una base DESECHABLE.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "./__fixtures__/zernio-message-received.json";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type Ingest = typeof import("./ingest");
type Payload = Record<string, unknown> & { id: string; event: string };

const ORG = "org_stress";
const ACCOUNT = fixture.account.accountId;

describe.skipIf(!TEST_DATABASE_URL)("ingesta bajo carga (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ingest: Ingest;
  let dz: typeof import("drizzle-orm");
  let provider: import("./provider").MessagingProvider;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("./ingest");
    dz = await import("drizzle-orm");
    const { ZernioProvider } = await import("./zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    await db.execute(
      dz.sql`truncate webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Stress", slug: "stress", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_stress",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: ACCOUNT,
      displayName: "Diluvium",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;

  /**
   * Clona el payload real. `phone` = como lo manda Zernio (sin "+", o con él);
   * null = cliente con nombre de usuario (sin teléfono, solo BSUID).
   */
  function inbound(opts: {
    phone: string | null;
    bsuid?: string;
    conversationId?: string;
    wamid?: string;
    eventId?: string;
    text?: string | null;
    attachments?: unknown[];
    metadata?: Record<string, unknown>;
    sentAt?: string;
    name?: string;
  }): Payload {
    seq++;
    const p = structuredClone(fixture) as unknown as Payload & {
      message: Record<string, unknown> & { sender: Record<string, unknown> };
      conversation: Record<string, unknown>;
    };
    const identity = opts.phone ?? opts.bsuid ?? `sin-id-${seq}`;
    const conversationId = opts.conversationId ?? `zconv_${identity}`;
    p.id = opts.eventId ?? `evt_${seq}_${randomUUID()}`;
    p.message.id = `zmsg_${seq}`;
    p.message.platformMessageId = opts.wamid ?? `wamid.${seq}.${randomUUID()}`;
    p.message.conversationId = conversationId;
    p.message.text = opts.text === undefined ? `hola ${seq}` : opts.text;
    p.message.attachments = opts.attachments ?? [];
    p.message.sentAt = opts.sentAt ?? new Date(Date.UTC(2026, 8, 22, 12, 0, seq % 60)).toISOString();
    p.message.sender = {
      id: opts.phone ? opts.phone.replace(/^\+/, "") : (opts.bsuid ?? `x${seq}`),
      name: opts.name ?? "Cliente Prueba",
      phoneNumber: opts.phone ? `+${opts.phone.replace(/^\+/, "")}` : null,
      ...(opts.bsuid ? { businessScopedUserId: opts.bsuid } : {}),
    };
    p.conversation.id = conversationId;
    p.conversation.participantId = opts.phone ? opts.phone.replace(/^\+/, "") : (opts.bsuid ?? `x${seq}`);
    if (opts.metadata) p.metadata = opts.metadata;
    return p;
  }

  async function deliver(payload: Payload): Promise<string> {
    const id = `zernio_${payload.id}`;
    await db
      .insert(s.webhookEvents)
      .values({ id, provider: "zernio", event: payload.event, payload })
      .onConflictDoNothing({ target: s.webhookEvents.id });
    return ingest.processWebhookEvent(provider, id);
  }

  const count = async (table: Schema["contacts"] | Schema["conversations"] | Schema["messages"] | Schema["webhookEvents"]) =>
    (await db.select({ n: dz.count() }).from(table))[0].n;

  // Números válidos según libphonenumber-js/max.
  const OTHER_COUNTRIES: { country: string; code: string; make: (i: number) => string; national: (i: number) => string }[] = [
    { country: "US", code: "1", make: (i) => `1415555${String(1000 + i)}`, national: (i) => `415555${1000 + i}` },
    { country: "ES", code: "34", make: (i) => `346123${String(10000 + i).slice(1)}`, national: (i) => `6123${String(10000 + i).slice(1)}` },
    { country: "CO", code: "57", make: (i) => `573001${String(10000 + i)}`, national: (i) => `3001${10000 + i}` },
    { country: "GT", code: "502", make: (i) => `5025512${String(1000 + i)}`, national: (i) => `5512${1000 + i}` },
    { country: "AR", code: "54", make: (i) => `549112345${String(1000 + i)}`, national: (i) => `9112345${1000 + i}` },
  ];

  it("300 números distintos en paralelo: 0 perdidos, 0 duplicados, 0 +521, partes correctas por país", async () => {
    const payloads: Payload[] = [];
    // 200 de México repartidos en los tres formatos del wa_id.
    for (let i = 0; i < 200; i++) {
      const ten = `668${String(1000000 + i)}`;
      const phone = i % 3 === 0 ? `521${ten}` : i % 3 === 1 ? `52${ten}` : `+52${ten}`;
      payloads.push(inbound({ phone }));
    }
    // 100 de otros países (20 por país).
    for (const c of OTHER_COUNTRIES) for (let i = 0; i < 20; i++) payloads.push(inbound({ phone: c.make(i) }));

    await Promise.all(payloads.map(deliver));

    expect(await count(s.contacts)).toBe(300);
    expect(await count(s.conversations)).toBe(300);
    expect(await count(s.messages)).toBe(300);
    const pending = await db.select().from(s.webhookEvents).where(dz.isNull(s.webhookEvents.processedAt));
    expect(pending).toHaveLength(0);

    const all = await db.select().from(s.contacts);
    expect(all.filter((c) => c.phoneE164?.startsWith("+521"))).toHaveLength(0);
    expect(new Set(all.map((c) => c.phoneE164)).size).toBe(300);

    const mx = all.filter((c) => c.phoneCountryIso === "MX");
    expect(mx).toHaveLength(200);
    for (const c of mx) {
      expect(c.phoneE164).toMatch(/^\+52\d{10}$/);
      expect(c.phoneCountryCode).toBe("52");
      expect(c.phoneNational).toBe(c.phoneE164?.slice(3));
      expect(c.country).toBe("Mexico");
      expect(c.stage).toBe("inbox");
      expect(c.source).toBe("whatsapp");
      expect(c.sourceChannel).toBe("whatsapp");
      expect(c.firstName).toBe("Cliente Prueba");
    }
    for (const country of OTHER_COUNTRIES) {
      const rows = all.filter((c) => c.phoneCountryIso === country.country);
      expect(rows, country.country).toHaveLength(20);
      const first = rows.find((c) => c.phoneE164 === `+${country.make(0)}`);
      expect(first?.phoneCountryCode).toBe(country.code);
      expect(first?.phoneNational).toBe(country.national(0));
    }
  }, 60_000);

  it("el mismo número de México en los tres formatos, en paralelo → 1 contacto +52, 1 conversación, 3 mensajes", async () => {
    // Uno de los 20 ya existía importado de GHL: se reusa, no se duplica.
    await db.insert(s.contacts).values({
      id: "c_ghl",
      organizationId: ORG,
      firstName: "Importado",
      phoneE164: "+526681112000",
      source: "ghl_import",
    });
    const payloads: Payload[] = [];
    for (let i = 0; i < 20; i++) {
      const ten = `668111${String(2000 + i)}`;
      // Cada formato con su propia conversación de Zernio (peor caso).
      payloads.push(inbound({ phone: `521${ten}`, conversationId: `zc_a_${i}` }));
      payloads.push(inbound({ phone: `52${ten}`, conversationId: `zc_b_${i}` }));
      payloads.push(inbound({ phone: `+52${ten}`, conversationId: `zc_c_${i}` }));
    }
    // Todo en paralelo: cada conversación de proveedor distinta debe caer en la
    // MISMA conversación del CRM (índice único canal + contacto). Un choque
    // transitorio lo reintenta BullMQ; aquí se reintenta a mano y se exige que
    // al final no falte ni sobre nada.
    await Promise.all(payloads.map(deliver).map((p) => p.catch((error: unknown) => error)));
    const pending = await db.select().from(s.webhookEvents).where(dz.isNull(s.webhookEvents.processedAt));
    for (const row of pending) await ingest.processWebhookEvent(provider, row.id);

    const all = await db.select().from(s.contacts);
    expect(all).toHaveLength(20);
    expect(all.filter((c) => c.phoneE164?.startsWith("+521"))).toHaveLength(0);
    expect(all.find((c) => c.phoneE164 === "+526681112000")?.id).toBe("c_ghl");
    expect(await count(s.conversations)).toBe(20);
    expect(await count(s.messages)).toBe(60);
  }, 60_000);

  it("eventos duplicados: el mismo evento 5 veces y el mismo wamid con otro id → 1 mensaje", async () => {
    const original = inbound({ phone: "526680009999", wamid: "wamid.dup" });
    const sameEvent = Array.from({ length: 5 }, () => structuredClone(original));
    const sameWamid = inbound({ phone: "526680009999", wamid: "wamid.dup" });
    await Promise.all([...sameEvent, sameWamid].map(deliver));

    expect(await count(s.messages)).toBe(1);
    expect(await count(s.webhookEvents)).toBe(2);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.unreadCount).toBe(1);
  });

  it("todos los tipos de mensaje y el referral de Click-to-WhatsApp se guardan completos", async () => {
    const sentAt = "2026-09-22T15:30:00.000Z";
    const file = (type: string, mimeType: string, filename?: string) => ({
      type,
      url: `https://zernio.com/api/v1/whatsapp/media/${type}-${seq}`,
      payload: { id: `media-${type}`, mimeType, sha256: "c2hh", ...(filename ? { filename } : {}) },
    });
    const referral = { source_url: "https://fb.me/ad", source_id: "ad_123", source_type: "ad", ctwa_clid: "clid_1" };
    const cases: { expected: string; payload: Payload; metaKey?: string }[] = [
      { expected: "text", payload: inbound({ phone: "526680000001", text: "hola" }) },
      { expected: "image", payload: inbound({ phone: "526680000002", text: null, attachments: [file("image", "image/jpeg")] }) },
      { expected: "audio", payload: inbound({ phone: "526680000003", text: null, attachments: [file("audio", "audio/ogg")] }) },
      { expected: "video", payload: inbound({ phone: "526680000004", text: null, attachments: [file("video", "video/mp4")] }) },
      { expected: "document", payload: inbound({ phone: "526680000005", text: null, attachments: [file("file", "application/pdf", "F-1.pdf")] }) },
      { expected: "sticker", payload: inbound({ phone: "526680000006", text: null, attachments: [file("sticker", "image/webp")] }) },
      {
        expected: "location",
        metaKey: "location",
        payload: inbound({ phone: "526680000007", text: "📍 Oficina", metadata: { location: { latitude: 25.79, longitude: -108.99, name: "Oficina" } } }),
      },
      {
        expected: "contact",
        metaKey: "contacts",
        payload: inbound({ phone: "526680000008", text: "👤 Ana", metadata: { contacts: [{ name: { formatted_name: "Ana" }, phones: [{ wa_id: "5215512345678" }] }] } }),
      },
      { expected: "text", metaKey: "quotedMessageId", payload: inbound({ phone: "526680000009", text: "sí", metadata: { quotedMessageId: "wamid.previo" } }) },
      {
        expected: "text",
        metaKey: "order",
        payload: inbound({ phone: "526680000010", text: "pedido", metadata: { order: { catalog_id: "cat", product_items: [{ product_retailer_id: "sku", quantity: 2 }] } } }),
      },
      { expected: "text", metaKey: "referral", payload: inbound({ phone: "526680000011", text: "vi su anuncio", metadata: { referral } }) },
    ];
    for (const c of cases) (c.payload.message as Record<string, unknown>).sentAt = sentAt;
    await Promise.all(cases.map((c) => deliver(c.payload)));

    const rows = await db.select().from(s.messages);
    expect(rows).toHaveLength(cases.length);
    for (const c of cases) {
      const message = (c.payload.message as { platformMessageId: string }).platformMessageId;
      const row = rows.find((r) => r.providerMessageId === message);
      expect(row?.type, c.expected).toBe(c.expected);
      expect(row?.sentAt?.toISOString()).toBe(sentAt);
      if (c.metaKey) expect(row?.metadata?.[c.metaKey], c.metaKey).toEqual((c.payload.metadata as Record<string, unknown>)[c.metaKey]);
    }
    const document = rows.find((r) => r.type === "document");
    expect(document?.attachments[0]).toMatchObject({ type: "document", mimeType: "application/pdf", fileName: "F-1.pdf" });
    const withAd = rows.find((r) => r.adReferral);
    expect(withAd?.adReferral).toEqual(referral);
    const convs = await db.select().from(s.conversations).where(dz.isNotNull(s.conversations.adReferral));
    expect(convs).toHaveLength(1);
  });

  it("cliente sin teléfono (BSUID): se guarda; después, con teléfono, es el MISMO contacto", async () => {
    const bsuid = "MX.1000000000000123";
    // phoneNumber null (la doc lo declara "string,null") y ausente.
    const nullPhone = inbound({ phone: null, bsuid, conversationId: "zc_bsuid" });
    const absent = inbound({ phone: null, bsuid, conversationId: "zc_bsuid" });
    delete (absent.message as { sender: Record<string, unknown> }).sender.phoneNumber;
    await deliver(nullPhone);
    await deliver(absent);

    let contacts = await db.select().from(s.contacts);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].phoneE164).toBeNull();
    expect(contacts[0].waBsuid).toBe(bsuid);
    expect(await count(s.messages)).toBe(2);

    // Más tarde el cliente manda teléfono + BSUID, en otra conversación de Zernio.
    await deliver(inbound({ phone: "5216687770001", bsuid, conversationId: "zc_otro" }));
    contacts = await db.select().from(s.contacts);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].phoneE164).toBe("+526687770001");
    expect(contacts[0].phoneNational).toBe("6687770001");
    expect(await count(s.conversations)).toBe(1);
    expect(await count(s.messages)).toBe(3);
  });

  it("20 mensajes del mismo BSUID en paralelo → 1 contacto; y un contacto con teléfono aprende su BSUID", async () => {
    const bsuid = "MX.1000000000000777";
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => deliver(inbound({ phone: null, bsuid, conversationId: `zc_par_${i}` }))),
    );
    let contacts = await db.select().from(s.contacts);
    expect(contacts).toHaveLength(1);
    expect(await count(s.messages)).toBe(20);

    await deliver(inbound({ phone: "526685550001", bsuid: "MX.1000000000000888" }));
    await deliver(inbound({ phone: null, bsuid: "MX.1000000000000888", conversationId: "zc_sin_tel" }));
    contacts = await db.select().from(s.contacts);
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.waBsuid === "MX.1000000000000888")?.phoneE164).toBe("+526685550001");
  });

  it("reacciones, edición y borrado sobre un mensaje guardado", async () => {
    const msg = inbound({ phone: "526680004444", wamid: "wamid.base", text: "precio?" });
    await deliver(msg);
    const reaction = (action: "added" | "removed", emoji: string, fromBusiness = false): Payload => ({
      id: `evt_r_${randomUUID()}`,
      event: "reaction.received",
      reaction: {
        emoji,
        action,
        platformMessageId: "wamid.base",
        sender: fromBusiness ? { id: ACCOUNT } : { id: "526680004444", phoneNumber: "+526680004444" },
        reactedAt: "2026-09-22T16:00:00.000Z",
      },
      conversation: { id: "zconv_526680004444", participantId: "526680004444" },
      account: { id: ACCOUNT, accountId: ACCOUNT, platform: "whatsapp" },
      timestamp: "2026-09-22T16:00:01.000Z",
    });
    const read = async () => (await db.select().from(s.messages).where(dz.eq(s.messages.providerMessageId, "wamid.base")))[0];

    await deliver(reaction("added", "👍"));
    expect((await read()).reactions).toEqual({ contact: "👍" });
    await deliver(reaction("added", "❤️", true));
    expect((await read()).reactions).toEqual({ contact: "👍", business: "❤️" });
    await deliver(reaction("removed", ""));
    expect((await read()).reactions).toEqual({ business: "❤️" });

    const change = (event: "message.edited" | "message.deleted"): Payload => ({
      id: `evt_c_${randomUUID()}`,
      event,
      message: { ...(msg.message as Record<string, unknown>), text: "¿precio con envío?" },
      ...(event === "message.edited"
        ? { editHistory: [{ text: "precio?" }], editCount: 1, editedAt: "2026-09-22T16:05:00.000Z" }
        : { deletedAt: "2026-09-22T16:10:00.000Z" }),
      conversation: msg.conversation,
      account: msg.account,
      timestamp: "2026-09-22T16:10:01.000Z",
    });
    await deliver(change("message.edited"));
    let row = await read();
    expect(row.body).toBe("¿precio con envío?");
    expect(row.editedAt?.toISOString()).toBe("2026-09-22T16:05:00.000Z");
    expect(row.metadata?.editHistory).toEqual([{ text: "precio?" }]);

    await deliver(change("message.deleted"));
    row = await read();
    expect(row.deletedAt?.toISOString()).toBe("2026-09-22T16:10:00.000Z");
    expect(row.body).toBe("¿precio con envío?"); // se conserva

    // Reacción a un mensaje que el CRM no tiene: se reintenta (no se pierde en silencio).
    const orphan = reaction("added", "🔥");
    (orphan.reaction as { platformMessageId: string }).platformMessageId = "wamid.no-existe";
    await expect(deliver(orphan)).rejects.toBeInstanceOf(ingest.RetryableIngestError);
  });

  it("sin teléfono, sin BSUID y sin conversación conocida → dead-letter en la BD, nunca procesado en silencio", async () => {
    const lost = inbound({ phone: null, conversationId: "zc_nadie" });
    const sender = (lost.message as { sender: Record<string, unknown> }).sender;
    sender.id = "usuario-raro";
    (lost.conversation as Record<string, unknown>).participantId = "usuario-raro";
    await expect(deliver(lost)).rejects.toBeInstanceOf(ingest.DeadLetterIngestError);

    const [row] = await db.select().from(s.webhookEvents);
    expect(row.processedAt).toBeNull();
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.lastError).toMatch(/sin teléfono, BSUID ni conversación/);
    expect(await count(s.contacts)).toBe(0);
  });
});
