// Hasta cuándo es gratis un chat por el anuncio (G2) contra Postgres REAL: la marca de Meta primero; sin marca, las 72 h
// del CRM; nada si no llegó por anuncio o ya se acabó. Nunca mira otra organización.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("freeUntilOf (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let gratis: typeof import("./gratis");
  const ORG = "org_g2";
  const OTRA = "org_g2_otra";
  const t = (iso: string) => new Date(iso);
  const now = t("2026-11-11T18:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    gratis = await import("./gratis");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });
  beforeEach(async () => {
    await db.execute(d.sql`truncate messages, conversations, channels, contacts, organization cascade`);
    for (const org of [ORG, OTRA]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
      await db.insert(s.channels).values({ id: `ch_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `acc_${org}`, displayName: "N" });
    }
  });

  const chat = async (id: string, adEntryAt: Date | null = null, org = ORG) => {
    await db.insert(s.contacts).values({ id: `ct_${id}`, organizationId: org, firstName: "Cliente" });
    await db.insert(s.conversations).values({ id, organizationId: org, contactId: `ct_${id}`, channelId: `ch_${org}`, adEntryAt });
  };
  const out = (id: string, conversationId: string, at: string, extra: Partial<typeof s.messages.$inferInsert> = {}, org = ORG) =>
    db.insert(s.messages).values({ id, organizationId: org, conversationId, direction: "out", source: "ai_agent", type: "text", status: "read", createdAt: t(at), sentAt: t(at), ...extra });

  it("con marca de Meta vigente: la expiración que dio Meta (aunque pase de las 72 h)", async () => {
    await chat("c1", t("2026-11-09T10:00:00Z"));
    await out("m1", "c1", "2026-11-09T10:05:00Z", { metaBillable: false, metaPricingType: "free_entry_point", metaWindowExpiresAt: t("2026-11-14T10:05:00Z") });
    expect(await gratis.freeUntilOf(ORG, "c1", t("2026-11-09T10:00:00Z"), now)).toEqual(t("2026-11-14T10:05:00Z"));
  });

  it("sin marca: 72 h desde la primera respuesta al anuncio; ya pasadas o sin anuncio, nada", async () => {
    await chat("c2", t("2026-11-10T09:00:00Z"));
    await out("m2", "c2", "2026-11-10T09:30:00Z");
    expect(await gratis.freeUntilOf(ORG, "c2", t("2026-11-10T09:00:00Z"), now)).toEqual(t("2026-11-13T09:30:00Z"));
    await chat("c3", t("2026-11-01T09:00:00Z"));
    await out("m3", "c3", "2026-11-01T09:30:00Z");
    expect(await gratis.freeUntilOf(ORG, "c3", t("2026-11-01T09:00:00Z"), now)).toBeNull();
    await chat("c4");
    expect(await gratis.freeUntilOf(ORG, "c4", null, now)).toBeNull();
  });

  it("una marca vencida no cuenta y la de otra organización tampoco", async () => {
    await chat("c5");
    await out("m5", "c5", "2026-11-05T10:00:00Z", { metaPricingType: "free_entry_point", metaWindowExpiresAt: t("2026-11-08T10:00:00Z") });
    expect(await gratis.freeUntilOf(ORG, "c5", null, now)).toBeNull();
    await chat("c6", null, OTRA);
    await out("m6", "c6", "2026-11-11T10:00:00Z", { metaPricingType: "free_entry_point", metaWindowExpiresAt: t("2026-11-14T10:00:00Z") }, OTRA);
    expect(await gratis.freeUntilOf(ORG, "c6", null, now)).toBeNull();
  });
});
