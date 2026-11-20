// Costo del CRM por mes contra Postgres real (crm_cost_months): el worker guarda el mes anterior con lo que ya leyeron
// los cobros, lo vuelve a guardar los primeros días (un dato que ya no se lee no borra el anterior), después lo deja
// fijo, y nunca toca lo cargado a mano. El Dashboard suma los meses cerrados. Solo corre con TEST_DATABASE_URL
// (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("costo del CRM por mes (base real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let guardar: typeof import("./guardar-mes");
  let costo: typeof import("@/lib/dashboard/costo-crm");
  const ORG = "org_costo_mes";
  const DIA3 = new Date("2026-11-03T18:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    guardar = await import("./guardar-mes");
    costo = await import("@/lib/dashboard/costo-crm");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function fila(month: string) {
    const [row] = await db.select().from(s.crmCostMonths).where(d.and(d.eq(s.crmCostMonths.organizationId, ORG), d.eq(s.crmCostMonths.month, month)));
    return row;
  }

  beforeEach(async () => {
    await db.execute(d.sql`truncate crm_cost_months, ai_provider_billing, railway_billing, zernio_billing, meta_whatsapp_pricing, meta_whatsapp_pricing_sync, channels, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: ORG, slug: ORG, createdAt: new Date() });
    await db.insert(s.channels).values({ id: "wa", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "wa", displayName: "W" });
    // IA de octubre (y un día de noviembre que no cuenta para octubre).
    await db.insert(s.aiProviderBilling).values({
      organizationId: ORG,
      provider: "anthropic",
      days: { "2026-10-01": { todo: 10 }, "2026-10-31": { todo: 20.5 }, "2026-11-01": { todo: 3 } },
      fetchedAt: new Date("2026-11-03T17:55:00Z"),
      attemptedAt: new Date("2026-11-03T17:55:00Z"),
    });
    // Railway sigue en el periodo que empezó en octubre (5-oct → 5-nov).
    await db.insert(s.railwayBilling).values({
      organizationId: ORG,
      workspaceId: "ws",
      plan: "HOBBY",
      state: "ACTIVE",
      periodStart: new Date("2026-10-05T23:44:00Z"),
      periodEnd: new Date("2026-11-05T23:44:00Z"),
      usageUsd: 11,
      fetchedAt: DIA3,
      attemptedAt: DIA3,
    });
    // Zernio ya cerró octubre.
    await db.insert(s.zernioBilling).values({
      organizationId: ORG,
      periodStart: new Date("2026-11-01T00:00:00Z"),
      totalUsd: 0.1,
      prevTotalUsd: 1.08,
      prevPeriodStart: new Date("2026-10-01T00:00:00Z"),
      attemptedAt: DIA3,
      fetchedAt: DIA3,
    });
    // Meta reportó octubre y se leyó después de que cerró.
    await db.insert(s.metaWhatsappPricing).values([
      { organizationId: ORG, channelId: "wa", day: "2026-10-10", category: "marketing", pricingType: "regular", volume: 300, costUsd: 12.2, fetchedAt: DIA3 },
      { organizationId: ORG, channelId: "wa", day: "2026-10-20", category: "service", pricingType: "regular", volume: 2000, costUsd: 31.96, fetchedAt: DIA3 },
    ]);
    await db.insert(s.metaWhatsappPricingSync).values({ organizationId: ORG, fetchedAt: DIA3, attemptedAt: DIA3 });
  });

  it("el día 3 guarda octubre con IA, Meta, Railway (estimado) y Zernio", async () => {
    expect(await guardar.guardarMesCerrado({ now: DIA3 })).toBe(1);
    const row = await fila("2026-10");
    expect(row).toMatchObject({ iaUsd: 30.5, metaUsd: 44.16, zernioUsd: 1.08, source: "auto" });
    // Uso de 11 en ~29 de 31 días → factura estimada ≈ 11.8.
    expect(row?.railwayUsd).toBeGreaterThan(11);
    expect(row?.railwayUsd).toBeLessThan(12.5);
  });

  it("el día 6 Railway ya cambió de periodo: se queda su último estimado y lo demás se actualiza", async () => {
    await guardar.guardarMesCerrado({ now: DIA3 });
    const railwayAntes = (await fila("2026-10"))?.railwayUsd;
    const DIA6 = new Date("2026-11-06T18:00:00Z");
    await db.update(s.railwayBilling).set({ periodStart: new Date("2026-11-05T23:44:00Z"), periodEnd: new Date("2026-12-05T23:44:00Z"), usageUsd: 0.3 });
    await db.update(s.aiProviderBilling).set({ days: { "2026-10-01": { todo: 10 }, "2026-10-31": { todo: 21 } }, fetchedAt: DIA6 });
    await guardar.guardarMesCerrado({ now: DIA6 });
    expect(await fila("2026-10")).toMatchObject({ iaUsd: 31, railwayUsd: railwayAntes });
  });

  it("después del día 7 queda fijo", async () => {
    await guardar.guardarMesCerrado({ now: DIA3 });
    await db.update(s.aiProviderBilling).set({ days: { "2026-10-01": { todo: 99 } } });
    expect(await guardar.guardarMesCerrado({ now: new Date("2026-11-10T18:00:00Z") })).toBe(0);
    expect((await fila("2026-10"))?.iaUsd).toBe(30.5);
  });

  it("un mes cargado a mano no se toca", async () => {
    await db.insert(s.crmCostMonths).values({ organizationId: ORG, month: "2026-10", iaUsd: 40, metaUsd: 44.16, railwayUsd: 12.9, zernioUsd: 1.05, source: "manual" });
    expect(await guardar.guardarMesCerrado({ now: DIA3 })).toBe(0);
    expect(await fila("2026-10")).toMatchObject({ iaUsd: 40, railwayUsd: 12.9, source: "manual" });
  });

  it("el Dashboard lee solo los meses cerrados de su organización", async () => {
    await db.insert(s.organization).values({ id: "otra", name: "otra", slug: "otra", createdAt: new Date() });
    await db.insert(s.crmCostMonths).values([
      { organizationId: ORG, month: "2026-09", iaUsd: 10, metaUsd: 0, railwayUsd: 0, zernioUsd: null, source: "manual" },
      { organizationId: ORG, month: "2026-11", iaUsd: 5, metaUsd: null, railwayUsd: null, zernioUsd: null },
      { organizationId: "otra", month: "2026-10", iaUsd: 500, metaUsd: null, railwayUsd: null, zernioUsd: null },
    ]);
    const base = await costo.cargarCostoCrm(db, ORG, { now: new Date("2026-11-20T12:00:00Z") });
    expect(base.guardados.map((g) => g.month)).toEqual(["2026-09"]);
  });
});
