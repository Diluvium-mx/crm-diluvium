// Marca de Meta y cobro de Meta contra Postgres REAL (docs/meta-whatsapp.md): el aviso de estado guarda la marca,
// el relleno usa los avisos que quedan en webhook_events, la lectura de Zernio guarda lo que reporta Meta, la sección
// del Dashboard reparte por origen y el correo usa lo reportado solo con el mes completo. Sin red.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("marca y cobro de Meta (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let ingest: typeof import("@/lib/messaging/ingest");
  let provider: import("@/lib/messaging/provider").MessagingProvider;
  let backfill: typeof import("./backfill");
  let sync: typeof import("./sync");
  let dash: typeof import("@/lib/dashboard/meta-whatsapp");
  let cargar: typeof import("@/lib/costos/cargar");

  const ORG = "org_meta";
  const OTRA = "org_meta_otra";
  const CH = "ch_meta";
  const now = new Date("2026-11-04T18:00:00Z");
  const CONFIG = { apiKey: "sk-secreto", baseUrl: "https://zernio.com/api" };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    ingest = await import("@/lib/messaging/ingest");
    const { ZernioProvider } = await import("@/lib/messaging/zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    backfill = await import("./backfill");
    sync = await import("./sync");
    dash = await import("@/lib/dashboard/meta-whatsapp");
    cargar = await import("@/lib/costos/cargar");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });
  beforeEach(async () => {
    await db.execute(
      d.sql`truncate meta_whatsapp_pricing, meta_whatsapp_pricing_sync, webhook_events, workflow_runs, workflows, messages, conversations, channels, contacts, organization cascade`,
    );
    for (const org of [ORG, OTRA]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
      await db.insert(s.channels).values({ id: org === ORG ? CH : `${CH}_otra`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `acc_${org}`, displayName: "N" });
      await db.insert(s.contacts).values({ id: `ct_${org}`, organizationId: org, firstName: "Cliente" });
      await db.insert(s.conversations).values({ id: `cv_${org}`, organizationId: org, contactId: `ct_${org}`, channelId: org === ORG ? CH : `${CH}_otra` });
    }
  });

  const out = (id: string, extra: Partial<typeof s.messages.$inferInsert> = {}) =>
    db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: `cv_${ORG}`,
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "hola",
      status: "sent",
      providerMessageId: `wamid.${id}`,
      createdAt: new Date("2026-11-04T10:00:00Z"),
      ...extra,
    });

  const statusPayload = (wamid: string, event: string, extra: Record<string, unknown>) => ({
    id: `evt_${wamid}_${event}`,
    event,
    message: { id: `z_${wamid}`, platformMessageId: wamid },
    account: { id: `acc_${ORG}`, platform: "whatsapp" },
    timestamp: "2026-11-04T10:00:05.000Z",
    ...extra,
  });

  const deliver = async (payload: { id: string; event: string }) => {
    const id = `zernio_${payload.id}`;
    await db.insert(s.webhookEvents).values({ id, provider: "zernio", event: payload.event, payload });
    return ingest.processWebhookEvent(provider, id);
  };

  const markOf = async (id: string) => {
    const [m] = await db
      .select({ b: s.messages.metaBillable, c: s.messages.metaCategory, t: s.messages.metaPricingType, w: s.messages.metaWindowExpiresAt, status: s.messages.status })
      .from(s.messages)
      .where(d.eq(s.messages.id, id));
    return m;
  };

  it("el aviso de entregado guarda la marca; el de leído sin marca no la borra", async () => {
    await out("m1");
    await deliver(
      statusPayload("wamid.m1", "message.delivered", {
        pricing: { billable: true, category: "service", type: "regular" },
        billingConversation: { id: "bc", expiresAt: "2026-11-05T10:00:00Z", originType: "service" },
      }),
    );
    await deliver(statusPayload("wamid.m1", "message.read", { pricing: null, billingConversation: null }));
    expect(await markOf("m1")).toEqual({ b: true, c: "service", t: "regular", w: new Date("2026-11-05T10:00:00Z"), status: "read" });
  });

  it("relleno: marca con los avisos guardados, sin pisar una marca viva ni cruzar organizaciones", async () => {
    await out("m2");
    await out("m3", { metaBillable: false, metaCategory: "service", metaPricingType: "free_entry_point" });
    // El mismo wamid en otra organización: el aviso es de ORG y no la toca.
    await db.insert(s.messages).values({ id: "m4", organizationId: OTRA, conversationId: `cv_${OTRA}`, direction: "out", source: "crm", type: "text", status: "sent", providerMessageId: "wamid.otra" });
    const ev = (wamid: string, org: string, pricing: Record<string, unknown>) =>
      db.insert(s.webhookEvents).values({
        id: `zernio_bf_${wamid}`,
        provider: "zernio",
        event: "message.delivered",
        organizationId: org,
        receivedAt: new Date("2026-11-04T10:00:10Z"),
        processedAt: new Date("2026-11-04T10:00:11Z"),
        payload: statusPayload(wamid, "message.delivered", { pricing }),
      });
    await ev("wamid.m2", ORG, { billable: true, category: "marketing", type: "regular" });
    await ev("wamid.m3", ORG, { billable: true, category: "service", type: "regular" });
    await ev("wamid.otra", ORG, { billable: true, category: "marketing", type: "regular" });
    const r = await backfill.backfillMetaMarks({ now });
    // El aviso de m3 ni se revisa (ya tiene marca); el de la otra organización no marca nada.
    expect(r).toEqual({ events: 2, marked: 1 });
    expect(await markOf("m2")).toMatchObject({ b: true, c: "marketing" });
    expect(await markOf("m3")).toMatchObject({ b: false, t: "free_entry_point" });
    expect(await markOf("m4")).toMatchObject({ b: null, c: null });
  });

  it("lectura de Zernio: guarda lo de Meta, actualiza sin duplicar y si falla conserva lo anterior", async () => {
    await db.insert(s.channels).values({ id: "ch_prueba", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_prueba", displayName: "P", isTest: true });
    const read = vi.fn<(config: unknown, accountId: string) => Promise<import("./read").MetaPricingPoint[]>>(async () => [
      { day: "2026-10-31", category: "service", pricingType: "regular", volume: 100, costUsd: 1.15 },
      { day: "2026-11-01", category: "marketing", pricingType: "regular", volume: 10, costUsd: 0.407 },
    ]);
    await sync.syncMetaWhatsappPricing({ config: CONFIG, read, now });
    expect(read.mock.calls.map((c) => c[1]).sort()).toEqual([`acc_${ORG}`, `acc_${OTRA}`]);
    await sync.syncMetaWhatsappPricing({ config: CONFIG, read, now });
    const rows = await db.select().from(s.metaWhatsappPricing).where(d.eq(s.metaWhatsappPricing.organizationId, ORG));
    expect(rows).toHaveLength(2);

    const fail = vi.fn(async () => {
      throw new Error("Zernio respondió 500: sk-secreto");
    });
    await expect(sync.syncMetaWhatsappPricing({ config: CONFIG, read: fail, now })).resolves.toEqual({ ok: false, errors: 2 });
    const [st] = await db.select().from(s.metaWhatsappPricingSync).where(d.eq(s.metaWhatsappPricingSync.organizationId, ORG));
    expect(st.lastError).toContain("[llave oculta]");
    expect(st.fetchedAt).toEqual(now);
    expect(await db.select().from(s.metaWhatsappPricing).where(d.eq(s.metaWhatsappPricing.organizationId, ORG))).toHaveLength(2);
    expect(await sync.syncMetaWhatsappPricing({ config: null, read })).toBeNull();
  });

  it("sección del Dashboard: monto de Meta por tipo y quién lo gastó según la marca", async () => {
    await db.insert(s.metaWhatsappPricing).values([
      { organizationId: ORG, channelId: CH, day: "2026-11-04", category: "service", pricingType: "regular", volume: 4, costUsd: 0.046, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-11-04", category: "marketing", pricingType: "regular", volume: 1, costUsd: 0.0407, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-11-04", category: "service", pricingType: "free_entry_point", volume: 30, costUsd: 0, fetchedAt: now },
    ]);
    await db.insert(s.metaWhatsappPricingSync).values({ organizationId: ORG, attemptedAt: now, fetchedAt: now });
    await db.insert(s.workflows).values({ id: "wf_p2", organizationId: ORG, slug: "precio_2", name: "Precio 2" });
    const cobrado = { metaBillable: true, metaCategory: "service", metaPricingType: "regular" };
    await out("a1", cobrado);
    await out("a2", cobrado);
    await out("a3", cobrado);
    await out("w1", cobrado);
    await out("v1", { ...cobrado, source: "crm" });
    await out("v2", { ...cobrado, source: "crm" });
    await out("s1", { metaBillable: true, metaCategory: "marketing", metaPricingType: "regular", type: "template", templateName: "seg_medidas", metadata: { seguimiento: { id: "x" } } });
    await out("g1", { metaBillable: false, metaCategory: "service", metaPricingType: "free_entry_point" });
    await out("cel", { source: "business_app" });
    await db.insert(s.workflowRuns).values({ id: "run1", organizationId: ORG, workflowId: "wf_p2", conversationId: `cv_${ORG}`, contactId: `ct_${ORG}`, trigger: "command", messageIds: ["w1"] });

    const h = await dash.metaWhatsappHistory(db, ORG, { desde: "2026-11-01", hasta: "2026-11-30" }, { now });
    expect(h.totalUsd).toBe(0.09);
    expect(h.charged).toBe(5);
    expect(h.free).toBe(30);
    expect(h.byCategory).toEqual([
      { label: "Mensajes normales", total: 0.05 },
      { label: "Plantillas de marketing", total: 0.04 },
    ]);
    // Normales a 0.0115 (0.046 / 4) y marketing a 0.0407.
    expect(h.byOrigin).toEqual([
      { label: "Seguimientos", total: 0.04 },
      { label: "Ángela (Agente IA)", total: 0.03 },
      { label: "Vendedores desde el CRM", total: 0.02 },
      { label: "Automatizaciones", total: 0.01 },
    ]);
    expect(h.topItems).toEqual([
      { label: "seg_medidas (plantilla)", total: 0.04 },
      { label: "«Precio 2» (automatización)", total: 0.01 },
    ]);
    expect(h.markedCharged).toBe(7);
    // El del celular, sin anuncio ni mensaje del cliente en 24 h: desde el CRM habría sido una plantilla (0.0407).
    expect(h.celular).toMatchObject({ mensajes: 1, plantillas: 1, normales: 0, ahorroUsd: 0.04, cobradosMeta: 0 });
    expect(h.celularPorMes).toMatchObject([{ mes: "2026-11", mensajes: 1, ahorroUsd: 0.04 }]);
    expect(h.marksSince).toBe("4-nov");
    expect(h.series.at(-1)).toEqual({ dia: "2026-11-04", total: 0.09 });
    expect(h.series).toHaveLength(4);

    // La otra organización no ve nada de esto.
    const otra = await dash.metaWhatsappHistory(db, OTRA, { desde: "2026-11-01", hasta: "2026-11-30" }, { now });
    // Nunca se ha leído Meta para ella: «sin dato», no US$0.
    expect(otra).toMatchObject({ totalUsd: null, charged: 0, byOrigin: [], celular: { mensajes: 0, ahorroUsd: 0 } });
    expect(await dash.metaWhatsappSummary(db, OTRA, { now })).toBeNull();
    expect(await dash.metaWhatsappSummary(db, ORG, { now })).toMatchObject({ monthLabel: "noviembre", totalUsd: 0.09, charged: 5, prevTotalUsd: null });
  });

  it("celular y WhatsApp Web: cuánto habría costado cada mensaje desde el CRM", async () => {
    const ahorro = await import("./ahorro-celular");
    const t = (iso: string) => new Date(iso);
    // Un contacto por chat (un contacto tiene un solo chat por número).
    const conv = async (id: string, channelId = CH) => {
      await db.insert(s.contacts).values({ id: `ct_${id}`, organizationId: ORG, firstName: "Cliente" });
      await db.insert(s.conversations).values({ id, organizationId: ORG, contactId: `ct_${id}`, channelId });
    };
    const msg = (id: string, conversationId: string, at: string, extra: Partial<typeof s.messages.$inferInsert> = {}) =>
      db.insert(s.messages).values({ id, organizationId: ORG, conversationId, direction: "out", source: "business_app", type: "text", status: "read", createdAt: t(at), ...extra });
    const entrante = (id: string, conversationId: string, at: string, extra: Partial<typeof s.messages.$inferInsert> = {}) =>
      msg(id, conversationId, at, { direction: "in", source: "contact", ...extra });
    // Meta: los 1,000 gratis del mes se acaban el 2-nov; normales a 0.012 y marketing a 0.04.
    await db.insert(s.metaWhatsappPricing).values([
      { organizationId: ORG, channelId: CH, day: "2026-11-01", category: "service", pricingType: "free_customer_service", volume: 600, costUsd: 0, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-11-02", category: "service", pricingType: "free_customer_service", volume: 500, costUsd: 0, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-11-03", category: "service", pricingType: "regular", volume: 100, costUsd: 1.2, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-11-03", category: "marketing", pricingType: "regular", volume: 10, costUsd: 0.4, fetchedAt: now },
    ]);
    // 1) Llegó por anuncio y se le contestó en 24 h: a las 30 h sigue gratis (72 h).
    await conv("c_anuncio");
    await entrante("i1", "c_anuncio", "2026-11-03T10:00:00Z", { adReferral: { source_id: "x" } });
    await msg("o1", "c_anuncio", "2026-11-03T10:05:00Z", { source: "ai_agent" });
    await msg("p1", "c_anuncio", "2026-11-04T16:00:00Z");
    // 2) Sin anuncio, el cliente escribió hace 2 h: el 1-nov aún había gratis; el 4-nov ya era mensaje normal (×2).
    await conv("c_abierto");
    await entrante("i2", "c_abierto", "2026-11-01T08:00:00Z");
    await msg("p2", "c_abierto", "2026-11-01T10:00:00Z");
    await entrante("i3", "c_abierto", "2026-11-04T08:00:00Z");
    await msg("p3", "c_abierto", "2026-11-04T10:00:00Z");
    await msg("p4", "c_abierto", "2026-11-04T10:01:00Z");
    // 3) Chat cerrado (sin mensaje del cliente en 24 h): dos mensajes el mismo día = una plantilla.
    await conv("c_cerrado");
    await entrante("i4", "c_cerrado", "2026-11-01T08:00:00Z");
    await msg("p5", "c_cerrado", "2026-11-04T18:00:00Z");
    await msg("p6", "c_cerrado", "2026-11-04T18:02:00Z");
    // 4) La marca de Meta dice que el tiempo gratis del anuncio sigue (aunque el CRM no lo vea).
    await conv("c_marca");
    await msg("o2", "c_marca", "2026-11-04T09:00:00Z", { source: "ai_agent", metaBillable: false, metaPricingType: "free_entry_point", metaWindowExpiresAt: t("2026-11-08T09:00:00Z") });
    await msg("p7", "c_marca", "2026-11-04T20:00:00Z");
    // 5) Meta lo marcó como cobrado: no es ahorro.
    await conv("c_cobrado");
    await entrante("i5", "c_cobrado", "2026-11-04T07:00:00Z");
    await msg("p8", "c_cobrado", "2026-11-04T08:00:00Z", { metaBillable: true, metaCategory: "service", metaPricingType: "regular" });
    // No cuentan: canal de prueba, importado del celular, otra organización.
    await db.insert(s.channels).values({ id: "ch_p", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_p", displayName: "P", isTest: true });
    await conv("c_prueba", "ch_p");
    await msg("x1", "c_prueba", "2026-11-04T12:00:00Z");
    await msg("x2", "c_cerrado", "2026-11-04T12:00:00Z", { importedAt: now });
    await db.insert(s.messages).values({ id: "x3", organizationId: OTRA, conversationId: `cv_${OTRA}`, direction: "out", source: "business_app", type: "text", status: "read", createdAt: t("2026-11-04T12:00:00Z") });

    const r = await ahorro.cargarAhorroCelular(db, ORG, "2026-11-01", "2026-11-30");
    // Ahorro: 2 normales × 0.012 + 1 plantilla × 0.04 = 0.064.
    expect(r.total).toEqual({ mensajes: 8, gratisAnuncio: 2, gratisMil: 1, normales: 2, plantillas: 1, ahorroUsd: 0.06, cobradosMeta: 1 });
    expect(r.porMes).toEqual([{ mes: "2026-11", ...r.total }]);
  });

  it("correo del mes: usa lo que reportó Meta solo si se leyó después de que cerró el mes", async () => {
    const OCT = { clave: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", nombre: "octubre" };
    await db.insert(s.metaWhatsappPricing).values([
      { organizationId: ORG, channelId: CH, day: "2026-10-31", category: "service", pricingType: "regular", volume: 2571, costUsd: 29.47, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-10-31", category: "marketing", pricingType: "regular", volume: 345, costUsd: 14.04, fetchedAt: now },
      { organizationId: ORG, channelId: CH, day: "2026-10-31", category: "service", pricingType: "free_entry_point", volume: 14994, costUsd: 0, fetchedAt: now },
    ]);
    await db.insert(s.metaWhatsappPricingSync).values({ organizationId: ORG, attemptedAt: now, fetchedAt: new Date("2026-10-31T23:00:00Z") });
    expect(await cargar.cargarMetaReportado(db, ORG, OCT)).toBeNull();
    await db.update(s.metaWhatsappPricingSync).set({ fetchedAt: new Date("2026-11-01T01:00:00Z") });
    expect(await cargar.cargarMetaReportado(db, ORG, OCT)).toEqual({ usd: 43.51, mensajes: 2916 });
    expect(await cargar.cargarMetaReportado(db, OTRA, OCT)).toBeNull();
  });
});
