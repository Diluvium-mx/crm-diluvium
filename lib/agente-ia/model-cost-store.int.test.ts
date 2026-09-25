// Costo aproximado del selector contra Postgres REAL: totales del cerebro de los
// últimos 30 días, solo de la organización y solo con uso reportado; y los precios
// sobrescritos. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("costo aproximado por modelo (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let store: typeof import("./model-cost-store");
  const ORG = "org_costo";
  const OTRA = "org_costo_otra";
  const NOW = new Date("2026-09-25T02:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    store = await import("./model-cost-store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate ai_model_prices, ai_usage, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "A", slug: "costo-a", createdAt: new Date() },
      { id: OTRA, name: "B", slug: "costo-b", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values([
      { id: "ch_a", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z_a", displayName: "A" },
      { id: "ch_b", organizationId: OTRA, type: "whatsapp", provider: "zernio", providerAccountId: "z_b", displayName: "B" },
    ]);
    await db.insert(s.contacts).values([
      { id: "c1", organizationId: ORG, firstName: "Uno" },
      { id: "c2", organizationId: ORG, firstName: "Dos" },
      { id: "c3", organizationId: OTRA, firstName: "Tres" },
    ]);
    await db.insert(s.conversations).values([
      { id: "cv1", organizationId: ORG, contactId: "c1", channelId: "ch_a" },
      { id: "cv2", organizationId: ORG, contactId: "c2", channelId: "ch_a" },
      { id: "cv3", organizationId: OTRA, contactId: "c3", channelId: "ch_b" },
    ]);
    const row = (
      id: string,
      conversationId: string,
      at: Date,
      over: Partial<typeof s.aiUsage.$inferInsert> = {},
    ): typeof s.aiUsage.$inferInsert => ({
      id,
      organizationId: ORG,
      conversationId,
      stage: "cerebro",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 600,
      cacheWriteTokens: 50,
      latencyMs: 1,
      outcome: "sent",
      createdAt: at,
      ...over,
    });
    await db.insert(s.aiUsage).values([
      row("u1", "cv1", daysAgo(1)),
      row("u2", "cv1", daysAgo(2)),
      row("u3", "cv2", daysAgo(29)),
      // Fuera: más de 30 días, el filtro, un error sin tokens y otra organización.
      row("u4", "cv2", daysAgo(31)),
      row("u5", "cv1", daysAgo(1), { stage: "filtro", modelId: "gpt-5.6-luna", provider: "openai" }),
      row("u6", "cv1", daysAgo(1), { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outcome: "error" }),
      row("u7", "cv3", daysAgo(1), { organizationId: OTRA }),
    ]);
  });

  it("suma solo respuestas del cerebro con uso, de los últimos 30 días y de la organización", async () => {
    expect(await store.brainUsageTotals(ORG, NOW)).toEqual({
      responses: 3,
      conversations: 2,
      inputTokens: 3_000,
      cacheReadTokens: 1_800,
      cacheWriteTokens: 150,
      outputTokens: 300,
    });
    expect((await store.brainUsageTotals(OTRA, NOW)).responses).toBe(1);
  });

  it("sin uso: ceros", async () => {
    expect(await store.brainUsageTotals("org_sin_uso", NOW)).toEqual({
      responses: 0,
      conversations: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
  });

  it("precios sobrescritos solo de la organización", async () => {
    await db.insert(s.aiModelPrices).values([
      { organizationId: ORG, modelId: "claude-sonnet-5", inputPerMTok: 1.5, outputPerMTok: 7 },
      { organizationId: OTRA, modelId: "gpt-5.6-terra", inputPerMTok: 9, outputPerMTok: 9 },
    ]);
    expect(await store.priceOverrides(ORG)).toEqual({
      "claude-sonnet-5": { inputPerMTok: 1.5, outputPerMTok: 7, cacheReadPerMTok: null, cacheWritePerMTok: null },
    });
  });
});
