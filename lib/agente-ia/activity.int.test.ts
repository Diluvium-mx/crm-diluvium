// Lector del estado en vivo del agente contra Postgres REAL: aislamiento por
// organización, corridas abiertas y Redis caído. Sin Redis (REDIS_URL borrada):
// el lector real de la cola falla y debe devolver "nada", nunca lanzar.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.REDIS_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("estado en vivo del Agente IA (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let store: typeof import("./activity-store");
  const ORG = "org_act";
  const OTHER = "org_act_otra";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    store = await import("./activity-store");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "A", slug: "act-a", createdAt: new Date() },
      { id: OTHER, name: "B", slug: "act-b", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values({ id: "ch_act", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z_act", displayName: "D", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: "c_act", organizationId: ORG, firstName: "Ana", phoneE164: "+526681000001" });
    await db.insert(s.conversations).values({ id: "cv_act", organizationId: ORG, contactId: "c_act", channelId: "ch_act" });
    await db.insert(s.workflows).values({ id: "wf_act", organizationId: ORG, slug: "tabla", name: "Tabla", enabled: true });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("una conversación de otra organización devuelve nada (y no consulta la cola)", async () => {
    let asked = 0;
    const read = async () => {
      asked++;
      return { state: "active", attemptsMade: 0 };
    };
    expect(await store.loadAgentActivity(OTHER, "cv_act", read)).toBeNull();
    expect(await store.loadAgentActivity(ORG, "cv_no_existe", read)).toBeNull();
    expect(asked).toBe(0);
    expect(await store.loadAgentActivity(ORG, "cv_act", read)).toBe("escribiendo");
  });

  it("corrida del agente en la base → enviando; de un vendedor → nada; pausado → nada", async () => {
    const none = async () => null;
    await db.insert(s.workflowRuns).values({ id: "r1", organizationId: ORG, workflowId: "wf_act", conversationId: "cv_act", contactId: "c_act", trigger: "agent", status: "running" });
    expect(await store.loadAgentActivity(ORG, "cv_act", none)).toBe("enviando");
    await db.update(s.workflowRuns).set({ status: "done" });
    expect(await store.loadAgentActivity(ORG, "cv_act", none)).toBeNull();
    await db.insert(s.workflowRuns).values({ id: "r2", organizationId: ORG, workflowId: "wf_act", conversationId: "cv_act", contactId: "c_act", trigger: "command", status: "queued", triggeredByUserId: null });
    expect(await store.loadAgentActivity(ORG, "cv_act", none)).toBeNull();
    await db.update(s.conversations).set({ agentState: "pausado_humano" });
    expect(await store.loadAgentActivity(ORG, "cv_act", async () => ({ state: "active", attemptsMade: 0 }))).toBeNull();
  });

  it("Redis caído (lector real sin REDIS_URL) → nada, sin lanzar", async () => {
    await expect(store.loadAgentActivity(ORG, "cv_act")).resolves.toBeNull();
    const failing = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(store.loadAgentActivity(ORG, "cv_act", failing)).resolves.toBeNull();
  });
});
