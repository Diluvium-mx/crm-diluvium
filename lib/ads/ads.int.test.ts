// Anuncios de clic a WhatsApp contra Postgres REAL: la ingesta con ficha, sin
// ficha (respaldo), duplicados, cliente existente, reentrada por otro anuncio,
// dos clientes del mismo anuncio, media caducada y la red de seguridad. Solo
// corre con TEST_DATABASE_URL apuntando a una base DESECHABLE con migraciones.
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const ORG = "org_ads";
const ACCOUNT = "zacc_ads";
const AD_VIDEO = "120250108412580604"; // AC - Video 9 (real)
const AD_IMAGE = "120251044855190604"; // AC - IMG 14 (real)
const AD_OTHER = "120241916275220604"; // Video 5 (real)

describe.skipIf(!TEST_DATABASE_URL)("anuncios de Meta (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ingest: typeof import("@/lib/messaging/ingest");
  let attribution: typeof import("./attribution");
  let media: typeof import("./media");
  let metaCache: typeof import("./meta-cache");
  let queries: typeof import("./queries");
  let d: typeof import("drizzle-orm");
  let provider: import("@/lib/messaging/provider").MessagingProvider;
  let hooksLog: { clicks: import("./attribution").RecordedClick[]; fallbacks: import("./attribution").FallbackJob[] };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ingest = await import("@/lib/messaging/ingest");
    attribution = await import("./attribution");
    media = await import("./media");
    metaCache = await import("./meta-cache");
    queries = await import("./queries");
    d = await import("drizzle-orm");
    const { ZernioProvider } = await import("@/lib/messaging/zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    await db.execute(
      d.sql`truncate ad_clicks, meta_ads, webhook_events, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "diluvium", createdAt: new Date() });
    await db.insert(s.channels).values({
      id: "ch_ads",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: ACCOUNT,
      displayName: "Diluvium",
    });
    hooksLog = { clicks: [], fallbacks: [] };
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const hooks = () => ({
    onAdClick: (c: import("./attribution").RecordedClick) => void hooksLog.clicks.push(c),
    onAdFallbackCandidate: (j: import("./attribution").FallbackJob) => void hooksLog.fallbacks.push(j),
  });

  /** Evento con el formato EXACTO que confirmó Zernio (plano; ficha en raíz y en metadata). */
  function adEvent(opts: {
    phone: string;
    conv?: string;
    text?: string;
    referral?: Record<string, unknown> | null;
    sentAt?: string;
    wamid?: string;
    name?: string;
  }) {
    const wamid = opts.wamid ?? `wamid.${randomUUID()}`;
    const payload: Record<string, unknown> = {
      event: "message.received",
      platform: "whatsapp",
      messageId: `zmsg_${randomUUID().slice(0, 8)}`,
      conversationId: opts.conv ?? `zconv_${opts.phone}`,
      platformMessageId: wamid,
      text: opts.text ?? "Hola, quiero más información",
      sender: { id: opts.phone, name: opts.name ?? "Cliente", phoneNumber: `+${opts.phone}` },
      conversation: { id: opts.conv ?? `zconv_${opts.phone}`, participantId: opts.phone, status: "active" },
      account: { id: ACCOUNT, platform: "whatsapp" },
    };
    if (opts.sentAt) payload.timestamp = opts.sentAt;
    if (opts.referral) {
      payload.referral = opts.referral;
      payload.metadata = { referral: opts.referral };
    }
    return payload;
  }

  async function deliver(payload: Record<string, unknown>, eventId?: string) {
    const env = provider.readEnvelope(JSON.stringify(payload));
    const id = `zernio_${eventId ?? env.eventId}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: env.event, payload, organizationId: ORG }).onConflictDoNothing();
    return ingest.processWebhookEvent(provider, id, hooks());
  }

  const videoFicha = (clid: string | null = "ARAk-video") => ({
    source_url: "https://fb.me/video9",
    source_type: "ad",
    source_id: AD_VIDEO,
    headline: "Protege tu Casa 🏠",
    body: "Bloquea hasta 50 cm de agua",
    media_type: "video",
    video_url: "https://video.xx.fbcdn.net/v/ad.mp4?oe=caduca",
    thumbnail_url: "https://scontent.xx.fbcdn.net/v/thumb.jpg?oe=caduca",
    ...(clid ? { ctwa_clid: clid } : {}),
  });
  const imageFicha = (clid: string) => ({
    source_url: "https://fb.me/img14",
    source_type: "ad",
    source_id: AD_IMAGE,
    headline: "⭐️⭐️⭐️⭐️⭐️",
    body: "Ya viste cómo protege",
    media_type: "image",
    image_url: "https://scontent.xx.fbcdn.net/v/img14.jpg?oe=caduca",
    ctwa_clid: clid,
  });

  it("anuncio con video: mensaje, contacto, clic, conversación y cola de nombres", async () => {
    const outcome = await deliver(adEvent({ phone: "5216681000001", referral: videoFicha(), sentAt: "2026-09-24T18:00:00Z" }));
    expect(outcome).toBe("entrante guardado");
    const [contact] = await db.select().from(s.contacts);
    const [conv] = await db.select().from(s.conversations);
    const [msg] = await db.select().from(s.messages);
    const [click] = await db.select().from(s.adClicks);
    expect(msg.body).toBe("Hola, quiero más información");
    expect(msg.adReferral).toEqual(videoFicha());
    expect(click).toMatchObject({
      contactId: contact.id,
      conversationId: conv.id,
      messageId: msg.id,
      origin: "webhook",
      adId: AD_VIDEO,
      ctwaClid: "ARAk-video",
      headline: "Protege tu Casa 🏠",
      raw: videoFicha(),
    });
    expect(click.media.map((m) => m.role)).toEqual(["video", "thumbnail"]);
    expect(conv.adReferral).toEqual(videoFicha());
    expect(conv.adEntryAt?.toISOString()).toBe("2026-09-24T18:00:00.000Z");
    expect(await db.select().from(s.metaAds)).toHaveLength(1);
    expect(hooksLog.clicks).toEqual([{ clickId: click.id, organizationId: ORG, adId: AD_VIDEO, hasMedia: true }]);
    expect(hooksLog.fallbacks).toEqual([]);
  });

  it("sin ctwa_clid y con ficha incompleta: el mensaje entra y el clic queda con lo que haya", async () => {
    await deliver(adEvent({ phone: "5216681000002", referral: videoFicha(null), sentAt: "2026-09-24T18:00:00Z" }));
    await deliver(adEvent({ phone: "5216681000003", referral: { source_type: "ad" }, sentAt: "2026-09-24T18:01:00Z" }));
    const clicks = await db.select().from(s.adClicks).orderBy(s.adClicks.clickedAt);
    expect(clicks.map((c) => [c.adId, c.ctwaClid])).toEqual([
      [AD_VIDEO, null],
      [null, null],
    ]);
    expect(await db.select().from(s.messages)).toHaveLength(2);
    // Solo el anuncio con id entra a la cola de nombres de Meta.
    expect((await db.select().from(s.metaAds)).map((a) => a.adId)).toEqual([AD_VIDEO]);
  });

  it("segundo mensaje sin ficha: sin clic nuevo ni respaldo; la atribución sigue en la conversación", async () => {
    await deliver(adEvent({ phone: "5216681000004", referral: imageFicha("c-4"), sentAt: "2026-09-24T18:00:00Z" }));
    await deliver(adEvent({ phone: "5216681000004", text: "¿Precio?", sentAt: "2026-09-24T18:02:00Z" }));
    expect(await db.select().from(s.adClicks)).toHaveLength(1);
    expect(hooksLog.fallbacks).toEqual([]);
    const [contact] = await db.select().from(s.contacts);
    const attributionOfContact = await queries.contactAdAttribution(ORG, contact.id);
    expect(attributionOfContact?.first.adId).toBe(AD_IMAGE);
  });

  it("evento duplicado (mismo evento o mismo wamid): un solo mensaje y un solo clic", async () => {
    const e = adEvent({ phone: "5216681000005", referral: imageFicha("c-5"), sentAt: "2026-09-24T18:00:00Z", wamid: "wamid.dup5" });
    await deliver(e);
    await deliver(e); // reintento de Zernio (mismo id derivado)
    await deliver({ ...e, messageId: "otro" }, "otro_evento_mismo_wamid");
    expect(await db.select().from(s.messages)).toHaveLength(1);
    expect(await db.select().from(s.adClicks)).toHaveLength(1);
    expect(hooksLog.clicks).toHaveLength(1);
  });

  it("cliente que ya existía (importado): se empareja, no se duplica", async () => {
    await db.insert(s.contacts).values({ id: "c_ghl", organizationId: ORG, firstName: "De GHL", phoneE164: "+526681000006", stage: "interesado" });
    await deliver(adEvent({ phone: "5216681000006", referral: imageFicha("c-6"), sentAt: "2026-09-24T18:00:00Z" }));
    expect((await db.select().from(s.contacts)).map((c) => c.id)).toEqual(["c_ghl"]);
    const [click] = await db.select().from(s.adClicks);
    expect(click.contactId).toBe("c_ghl");
  });

  it("el mismo cliente vuelve por OTRO anuncio: dos clics, la entrada se mueve", async () => {
    await deliver(adEvent({ phone: "5216681000007", referral: imageFicha("c-7a"), sentAt: "2026-09-20T10:00:00Z" }));
    await deliver(adEvent({ phone: "5216681000007", referral: { ...videoFicha("c-7b"), source_id: AD_OTHER }, sentAt: "2026-09-24T18:00:00Z" }));
    const clicks = await db.select().from(s.adClicks).orderBy(s.adClicks.clickedAt);
    expect(clicks.map((c) => c.adId)).toEqual([AD_IMAGE, AD_OTHER]);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.adEntryAt?.toISOString()).toBe("2026-09-24T18:00:00.000Z");
    // La conversación conserva el anuncio que la ORIGINÓ.
    expect((conv.adReferral as Record<string, unknown>).source_id).toBe(AD_IMAGE);
    const [contact] = await db.select().from(s.contacts);
    const a = await queries.contactAdAttribution(ORG, contact.id);
    expect(a?.first.adId).toBe(AD_IMAGE);
    expect(a?.others.map((o) => o.adId)).toEqual([AD_OTHER]);
  });

  it("dos clientes del mismo anuncio: dos contactos, un anuncio, conteos correctos", async () => {
    await deliver(adEvent({ phone: "5216681000008", referral: imageFicha("c-8"), sentAt: "2026-09-24T18:00:00Z" }));
    await deliver(adEvent({ phone: "5216681000009", referral: imageFicha("c-9"), sentAt: "2026-09-24T18:05:00Z" }));
    await db.update(s.contacts).set({ stage: "compra" }).where(d.eq(s.contacts.phoneE164, "+526681000009"));
    expect(await db.select().from(s.metaAds)).toHaveLength(1);
    const list = await queries.listAds(ORG);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: AD_IMAGE, clients: 2, bought: 1 });
    const detail = await queries.getAd(ORG, AD_IMAGE);
    expect(detail?.clients).toBe(2);
    expect(detail?.bought).toBe(1);
  });

  it("sin ficha (primer mensaje): respaldo con el primer clic de la conversación de Zernio", async () => {
    await deliver(adEvent({ phone: "5216681000010", conv: "zconv_fb", sentAt: "2026-09-24T18:00:00Z" }));
    expect(await db.select().from(s.adClicks)).toHaveLength(0);
    expect(hooksLog.fallbacks).toHaveLength(1);
    const job = hooksLog.fallbacks[0];
    expect(job).toMatchObject({ organizationId: ORG, providerAccountId: ACCOUNT, providerConversationId: "zconv_fb", looksLikeAd: false });

    const fakeProvider = {
      conversationAdClick: async () => ({
        referral: { source_id: AD_IMAGE, source_type: "ad", headline: "IMG 14", ctwa_clid: "c-fb" },
        capturedAt: new Date("2026-09-24T17:59:59Z"),
      }),
    };
    const r = await attribution.attributeFromProviderConversation(fakeProvider, job);
    expect(r.result).toBe("atribuido");
    const [click] = await db.select().from(s.adClicks);
    expect(click).toMatchObject({ origin: "zernio_conversation", adId: AD_IMAGE, ctwaClid: "c-fb", messageId: job.messageId });
    const [conv] = await db.select().from(s.conversations);
    expect(conv.adEntryAt?.toISOString()).toBe("2026-09-24T18:00:00.000Z");
    expect((conv.adReferral as Record<string, unknown>).source_id).toBe(AD_IMAGE);
    const [msg] = await db.select().from(s.messages);
    expect((msg.metadata as Record<string, { resultado: string }>).anuncioRespaldo.resultado).toBe("atribuido");
    // Idempotente: repetir el job no duplica.
    expect((await attribution.attributeFromProviderConversation(fakeProvider, job)).result).toBe("ya_registrado");
    expect(await db.select().from(s.adClicks)).toHaveLength(1);
  });

  it("respaldo: Zernio sin clic, o un clic viejo que no es de este mensaje → registro, sin atribuir", async () => {
    await deliver(adEvent({ phone: "5216681000011", conv: "zconv_old", sentAt: "2026-09-24T18:00:00Z" }));
    const job = hooksLog.fallbacks[0];
    expect((await attribution.attributeFromProviderConversation({ conversationAdClick: async () => null }, job)).result).toBe("sin_datos");
    const old = { conversationAdClick: async () => ({ referral: { source_id: AD_IMAGE }, capturedAt: new Date("2026-09-01T00:00:00Z") }) };
    expect((await attribution.attributeFromProviderConversation(old, job)).result).toBe("fuera_de_tiempo");
    expect(await db.select().from(s.adClicks)).toHaveLength(0);
    const [msg] = await db.select().from(s.messages);
    expect((msg.metadata as Record<string, { resultado: string }>).anuncioRespaldo.resultado).toBe("fuera_de_tiempo");
  });

  it("si registrar el clic falla, el mensaje ENTRA igual y la red de seguridad lo registra después", async () => {
    await db.execute(d.sql`alter table ad_clicks rename to ad_clicks_fuera`);
    try {
      const outcome = await deliver(adEvent({ phone: "5216681000012", referral: imageFicha("c-12"), sentAt: "2026-09-24T18:00:00Z" }));
      expect(outcome).toBe("entrante guardado");
    } finally {
      await db.execute(d.sql`alter table ad_clicks_fuera rename to ad_clicks`);
    }
    expect(await db.select().from(s.messages)).toHaveLength(1);
    expect(await db.select().from(s.adClicks)).toHaveLength(0);
    // El barrido lo encuentra (se simula la antigüedad de 1 min) y lo registra.
    await db.execute(d.sql`update messages set created_at = created_at - interval '2 minutes'`);
    const pending = await attribution.messagesWithUnrecordedReferral();
    expect(pending).toHaveLength(1);
    const click = await attribution.recordClickFromMessage(ORG, pending[0].id);
    expect(click?.adId).toBe(AD_IMAGE);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.adEntryAt?.toISOString()).toBe("2026-09-24T18:00:00.000Z");
    expect(await attribution.messagesWithUnrecordedReferral()).toHaveLength(0);
  });

  describe("media del anuncio al bucket", () => {
    function memoryStorage() {
      const objects = new Map<string, { bytes: Buffer; contentType: string }>();
      return {
        objects,
        storage: {
          async putStream(key: string, body: Readable, contentType: string) {
            const chunks: Buffer[] = [];
            for await (const c of body) chunks.push(Buffer.from(c as Uint8Array));
            objects.set(key, { bytes: Buffer.concat(chunks), contentType });
          },
          async exists(key: string) {
            return objects.has(key);
          },
          async signedGetUrl(key: string) {
            return `https://bucket.test/${key}`;
          },
          async getBytes(key: string) {
            return new Uint8Array(objects.get(key)?.bytes ?? []);
          },
        } as unknown as import("@/lib/storage/s3").ObjectStorage,
      };
    }

    it("copia video y miniatura; el segundo clic del mismo anuncio reusa la copia", async () => {
      await deliver(adEvent({ phone: "5216681000013", referral: videoFicha("c-13"), sentAt: new Date().toISOString() }));
      await deliver(adEvent({ phone: "5216681000014", referral: videoFicha("c-14"), sentAt: new Date().toISOString() }));
      const { objects, storage } = memoryStorage();
      let downloads = 0;
      const fetchImpl = (async (url: URL | string) => {
        downloads++;
        const video = String(url).includes(".mp4");
        return new Response(video ? "VIDEO" : "JPG", { status: 200, headers: { "content-type": video ? "video/mp4" : "image/jpeg" } });
      }) as typeof fetch;
      const [c1, c2] = await db.select().from(s.adClicks).orderBy(s.adClicks.createdAt);
      await media.downloadClickMedia(storage, c1.id, fetchImpl);
      await media.downloadClickMedia(storage, c2.id, fetchImpl);
      expect(downloads).toBe(2); // solo las del primer clic
      const [r1, r2] = await db.select().from(s.adClicks).orderBy(s.adClicks.createdAt);
      expect(r1.media.every((m) => m.storageKey)).toBe(true);
      expect(r2.media.map((m) => m.storageKey)).toEqual(r1.media.map((m) => m.storageKey));
      expect(objects.get(r1.media[0].storageKey!)?.contentType).toBe("video/mp4");
    });

    it("media que ya caducó (403): se reintenta sin frenar y se abandona; la tarjeta usa el creativo", async () => {
      await deliver(adEvent({ phone: "5216681000015", referral: imageFicha("c-15"), sentAt: new Date().toISOString() }));
      const { storage } = memoryStorage();
      const expired = (async () => new Response("URL signature expired", { status: 403 })) as typeof fetch;
      const [click] = await db.select().from(s.adClicks);
      // Dos intentos fallidos lanzan (BullMQ reintenta con espera)…
      for (let i = 0; i < 2; i++) await expect(media.downloadClickMedia(storage, click.id, expired)).rejects.toThrow();
      // …al tercer 4xx se abandona: ya no lanza ni se reintenta.
      await expect(media.downloadClickMedia(storage, click.id, expired)).resolves.toEqual({ stored: 0, pending: 0 });
      const [after] = await db.select().from(s.adClicks);
      expect(after.media[0]).toMatchObject({ attempts: 3, givenUpAt: expect.any(String) });
      await expect(media.downloadClickMedia(storage, click.id, expired)).resolves.toEqual({ stored: 0, pending: 0 });
      // El mensaje y el clic siguen intactos.
      expect(await db.select().from(s.messages)).toHaveLength(1);

      // Nombres y creativo desde la API de Marketing (stub de Meta).
      const graph = (async (url: URL | string) => {
        const u = String(url);
        if (u.includes(`/${AD_IMAGE}?`)) {
          return Response.json({
            id: AD_IMAGE,
            name: "AC - IMG 14",
            effective_status: "ACTIVE",
            account_id: "1058203117932599",
            adset: { id: "1", name: "🔴LR / Mensajes / 09.MAR.26" },
            campaign: { id: "2", name: "🔴LR / Mensajes / 09.MAR.26" },
            creative: { id: "1586953986127289" },
          });
        }
        return Response.json({
          id: "1586953986127289",
          title: "⭐️⭐️⭐️⭐️⭐️",
          body: "Ya viste cómo protege",
          object_type: "SHARE",
          image_url: "https://scontent.xx.fbcdn.net/creative.png",
          thumbnail_url: "https://scontent.xx.fbcdn.net/creative-thumb.jpg",
          effective_object_story_id: "114715000320568_1483425617140200",
        });
      }) as typeof fetch;
      expect(await metaCache.refreshMetaAd(ORG, AD_IMAGE, { config: { token: "t", fetchImpl: graph } })).toBe("actualizado");
      const okFetch = (async () => new Response("PNG", { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
      await media.downloadCreativeMedia(storage, ORG, AD_IMAGE, okFetch);
      const card = (await queries.adCardsForMessages(ORG, [(await db.select().from(s.messages))[0].id])).values().next().value;
      expect(card).toMatchObject({ name: "AC - IMG 14", href: `/anuncios/${AD_IMAGE}` });
      expect(card?.thumbnailUrl).toMatch(/^\/api\/ads\/media\/ad\//);
    });
  });

  it("Meta caída: se guarda el error con espera y los nombres quedan como estaban", async () => {
    await deliver(adEvent({ phone: "5216681000016", referral: imageFicha("c-16"), sentAt: "2026-09-24T18:00:00Z" }));
    const down = (async () => Response.json({ error: { message: "Service temporarily unavailable", code: 2 } }, { status: 503 })) as typeof fetch;
    const r = await metaCache.refreshMetaAd(ORG, AD_IMAGE, { config: { token: "t", fetchImpl: down } });
    expect(typeof r === "object" && r.retryInMs).toBeGreaterThan(0);
    const [ad] = await db.select().from(s.metaAds);
    expect(ad.fetchError).toContain("503");
    expect(ad.fetchAttempts).toBe(1);
    expect(ad.nextFetchAt).not.toBeNull();
    // La lista muestra lo que haya (el titular de la ficha).
    const list = await queries.listAds(ORG);
    expect(list[0].name).toBe("⭐️⭐️⭐️⭐️⭐️");
  });
});
