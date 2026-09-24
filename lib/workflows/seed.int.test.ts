// Seed de workflows predeterminados contra una base real (TEST_DATABASE_URL).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("seedDefaultWorkflows", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let seed: typeof import("./seed");
  let defaults: typeof import("./defaults");
  let eq: typeof import("drizzle-orm").eq;
  const org = "org_seed_test";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    seed = await import("./seed");
    defaults = await import("./defaults");
    ({ eq } = await import("drizzle-orm"));
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, media_assets, organization cascade`);
    await db.insert(s.organization).values({ id: org, name: "Test", slug: "test", createdAt: new Date() });
  });
  afterAll(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, media_assets, organization cascade`);
  });

  it("crea todos los predeterminados apagados, con sus pasos, y es idempotente", async () => {
    const first = await seed.seedDefaultWorkflows(db, org);
    expect(first.created).toHaveLength(defaults.DEFAULT_WORKFLOWS.length);
    const rows = await db.select().from(s.workflows).where(eq(s.workflows.organizationId, org));
    expect(rows).toHaveLength(defaults.DEFAULT_WORKFLOWS.length);
    expect(rows.every((r) => r.enabled === false && r.isSystem)).toBe(true);
    const steps = await db.select().from(s.workflowSteps).where(eq(s.workflowSteps.organizationId, org));
    expect(steps.length).toBe(defaults.DEFAULT_WORKFLOWS.reduce((n, w) => n + w.steps.length, 0));
    const second = await seed.seedDefaultWorkflows(db, org);
    expect(second.created).toEqual([]);
  });

  it("no pisa un workflow existente ni su comando", async () => {
    await db.insert(s.workflows).values({
      id: "w1",
      organizationId: org,
      slug: "mio",
      name: "Mío",
      triggerCommand: "/tabla",
      enabled: true,
    });
    await seed.seedDefaultWorkflows(db, org);
    const [tabla] = await db.select().from(s.workflows).where(eq(s.workflows.slug, "tabla_tamanos_estandar"));
    expect(tabla.triggerCommand).toBeNull();
    const [mine] = await db.select().from(s.workflows).where(eq(s.workflows.id, "w1"));
    expect(mine.enabled).toBe(true);
  });
});
