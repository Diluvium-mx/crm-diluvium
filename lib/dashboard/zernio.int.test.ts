// Conteo de mensajes que cobra Zernio (2-nov-2026) contra Postgres REAL: solo lo que el CRM manda por
// Zernio en el mes, de la organización. Solo corre con TEST_DATABASE_URL apuntando a una base DESECHABLE
// con las migraciones aplicadas; borra sus datos al empezar. Nunca apuntarlo a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("countZernioSent (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  type Schema = typeof import("@/lib/db/schema");
  let db: Db;
  let s: Schema;
  let z: typeof import("./zernio");
  const ORG_A = "org_zer_a";
  const ORG_B = "org_zer_b";
  const NOV = new Date("2026-11-01T00:00:00Z");
  const DIC = new Date("2026-12-01T00:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    z = await import("./zernio");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    for (const org of [ORG_A, ORG_B]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org.replace(/_/g, "-"), createdAt: new Date() });
      await db.insert(s.channels).values({
        id: `ch_${org}`,
        organizationId: org,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: `zacc_${org}`,
        displayName: "Diluvium",
      });
      await db.insert(s.contacts).values({ id: `c_${org}`, organizationId: org, firstName: "Cliente" });
      await db.insert(s.conversations).values({ id: `conv_${org}`, organizationId: org, contactId: `c_${org}`, channelId: `ch_${org}` });
    }
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  type Opts = {
    org?: string;
    at?: string;
    direction?: "in" | "out";
    source?: "contact" | "crm" | "business_app" | "other_api" | "ai_agent";
    status?: "queued" | "sent" | "delivered" | "read" | "failed" | "received";
    importedAt?: Date | null;
  };
  async function message(o: Opts = {}) {
    seq++;
    const org = o.org ?? ORG_A;
    await db.insert(s.messages).values({
      id: `m_zer_${seq}`,
      organizationId: org,
      conversationId: `conv_${org}`,
      direction: o.direction ?? "out",
      source: o.source ?? "ai_agent",
      type: "text",
      body: "hola",
      status: o.status ?? "delivered",
      importedAt: o.importedAt ?? null,
      createdAt: new Date(o.at ?? "2026-11-02T12:00:00Z"),
    });
  }

  it("cuenta lo que manda el CRM (vendedor y Agente IA) en el mes, sin fallidos, entrantes, ecos ni importados", async () => {
    await message({ source: "ai_agent", status: "read" });
    await message({ source: "ai_agent", status: "sent" });
    await message({ source: "crm", status: "delivered" });
    await message({ source: "crm", status: "queued" });
    // No cuentan:
    await message({ source: "ai_agent", status: "failed" });
    await message({ direction: "in", source: "contact", status: "received" });
    await message({ source: "business_app", status: "sent" });
    await message({ source: "other_api", status: "read" });
    await message({ source: "crm", status: "read", importedAt: new Date("2026-11-02T13:00:00Z") });
    await message({ at: "2026-10-31T23:59:59Z" });
    await message({ at: "2026-12-01T00:00:00Z" });
    await message({ org: ORG_B });

    expect(await z.countZernioSent(db, ORG_A, NOV, DIC)).toBe(4);
    expect(await z.countZernioSent(db, ORG_B, NOV, DIC)).toBe(1);
  });

  it("el resumen de la tarjeta usa el periodo de la lectura de Zernio", async () => {
    await message();
    await message({ source: "crm" });
    await db.insert(s.zernioBilling).values({
      organizationId: ORG_A,
      periodStart: NOV,
      periodEnd: DIC,
      totalUsd: 0,
      messagesUsd: 0,
      accountsUsd: 0,
      attemptedAt: new Date("2026-11-03T00:00:00Z"),
      fetchedAt: new Date("2026-11-03T00:00:00Z"),
    });
    const summary = await z.zernioSummary(db, ORG_A, { now: new Date("2026-11-03T00:00:00Z") });
    expect(summary).toMatchObject({ sentCount: 2, freePct: 0.02, estimatedBillUsd: 0 });
  });
});
