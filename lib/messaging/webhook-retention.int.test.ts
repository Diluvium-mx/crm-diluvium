// Retención de webhook_events contra Postgres REAL (14-oct-2026, auditoría F1): procesados a los
// 7 días, cuarentena a los 30, por tandas; pendientes y dead-letter no son de esta regla.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("retención de webhook_events (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let retention: typeof import("./webhook-retention");
  let sql: typeof import("drizzle-orm").sql;

  const NOW = new Date("2026-10-14T18:00:00Z");
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  const event = (id: string, extra: Partial<typeof import("@/lib/db/schema").webhookEvents.$inferInsert>) => ({
    id,
    provider: "zernio" as const,
    event: "message.received",
    payload: { event: "message.received" },
    receivedAt: daysAgo(40),
    ...extra,
  });

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    retention = await import("./webhook-retention");
    ({ sql } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    await db.execute(sql`truncate webhook_events cascade`);
    await db.insert(s.webhookEvents).values([
      event("proc_8d", { processedAt: daysAgo(8) }),
      event("proc_6d", { processedAt: daysAgo(6) }),
      event("cuarentena_31d", { quarantinedAt: daysAgo(31) }),
      event("cuarentena_10d", { quarantinedAt: daysAgo(10) }),
      event("pendiente_viejo", {}),
      event("dead_viejo", { deadLetteredAt: daysAgo(20), attempts: 20 }),
    ]);
  });

  const ids = async () =>
    (await db.select({ id: s.webhookEvents.id }).from(s.webhookEvents)).map((r) => r.id).sort();

  it("borra procesados de más de 7 días y cuarentena de más de 30; lo demás se queda", async () => {
    expect(await retention.purgeExpiredProcessed(NOW)).toBe(1);
    expect(await retention.purgeExpiredQuarantine(NOW)).toBe(1);
    expect(await ids()).toEqual(["cuarentena_10d", "dead_viejo", "pendiente_viejo", "proc_6d"]);
  });

  it("borra por tandas", async () => {
    await db.insert(s.webhookEvents).values([event("proc_9d", { processedAt: daysAgo(9) }), event("proc_30d", { processedAt: daysAgo(30) })]);
    expect(await retention.purgeExpiredProcessed(NOW, 2)).toBe(2);
    expect(await retention.purgeExpiredProcessed(NOW, 2)).toBe(1);
    expect(await retention.purgeExpiredProcessed(NOW, 2)).toBe(0);
  });
});
