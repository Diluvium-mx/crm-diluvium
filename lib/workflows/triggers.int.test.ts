// Disparadores (palabra clave del cliente, etapa, comando) contra una base real.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock("@/lib/queue/workflows", () => ({
  enqueueWorkflowRun: async () => true,
  reviveWorkflowRun: async () => "added",
}));

describe.skipIf(!TEST_DATABASE_URL)("disparadores de workflows", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let t: typeof import("./triggers");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_trg";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    t = await import("./triggers");
    ({ eq } = await import("drizzle-orm"));
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u1", name: "Paty", email: "p@x.mx" });
    // Una conversación por contacto y canal: dos canales para tener dos conversaciones.
    await db.insert(s.channels).values([
      { id: "ch", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z", displayName: "D", aiAgentMode: "auto" },
      { id: "ch2", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z2", displayName: "D2", aiAgentMode: "auto" },
    ]);
    await db.insert(s.contacts).values({ id: "c1", organizationId: ORG, firstName: "Ana", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values([
      { id: "cv_old", organizationId: ORG, contactId: "c1", channelId: "ch", providerConversationId: "zo", lastMessageAt: new Date(Date.now() - 86_400_000), windowExpiresAt: new Date(Date.now() + 3_600_000) },
      { id: "cv_new", organizationId: ORG, contactId: "c1", channelId: "ch2", providerConversationId: "zn", lastMessageAt: new Date(), windowExpiresAt: new Date(Date.now() + 3_600_000) },
    ]);
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function wf(id: string, opts: Partial<typeof s.workflows.$inferInsert>) {
    await db.insert(s.workflows).values({ id, organizationId: ORG, slug: id, name: id, enabled: true, ...opts });
    await db.insert(s.workflowSteps).values({ id: `${id}_s`, organizationId: ORG, workflowId: id, position: 0, kind: "send_text", payload: { kind: "send_text", text: "hola" } });
  }
  async function inbound(id: string, body: string | null, type: "text" | "image" = "text") {
    await db.insert(s.messages).values({ id, organizationId: ORG, conversationId: "cv_new", direction: "in", source: "contact", type, body, status: "received" });
    return t.onInboundKeyword({ organizationId: ORG, conversationId: "cv_new", messageId: id });
  }
  const runs = () => db.select().from(s.workflowRuns).where(eq(s.workflowRuns.organizationId, ORG));

  it("palabra clave del cliente: dispara UN solo workflow (el primero por posición) y deja rastro", async () => {
    await wf("w_tapones", { triggerKeywords: ["tapones", "tapón"], position: 1 });
    await wf("w_tabla", { triggerKeywords: ["tabla"], position: 0 });
    const r = await inbound("m1", "¿Me mandan la TABLA y los tapones?");
    expect(r).toMatchObject({ status: "queued" });
    const all = await runs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ workflowId: "w_tabla", trigger: "keyword", conversationId: "cv_new" });
  });

  it("una imagen o un mensaje sin coincidencia no dispara; un workflow deshabilitado tampoco", async () => {
    await wf("w_tabla", { triggerKeywords: ["tabla"] });
    await wf("w_off", { triggerKeywords: ["precio"], enabled: false });
    expect(await inbound("m2", "foto", "image")).toBeNull();
    expect(await inbound("m3", "cuánto cuesta, precio por favor")).toBeNull();
    expect(await inbound("m4", "establa")).toBeNull();
    expect(await runs()).toHaveLength(0);
  });

  it("cambio de etapa humano: dispara sobre la conversación MÁS RECIENTE del contacto con el vendedor como autor", async () => {
    await wf("w_stage", { triggerStage: "cerca_compra" });
    await wf("w_other", { triggerStage: "compra" });
    const out = await t.onContactStageEntered({ organizationId: ORG, contactId: "c1", stage: "cerca_compra", userId: "u1" });
    expect(out).toHaveLength(1);
    const all = await runs();
    expect(all[0]).toMatchObject({ workflowId: "w_stage", trigger: "stage", conversationId: "cv_new", triggeredByUserId: "u1" });
  });

  it("un contacto sin conversación no dispara nada y no lanza", async () => {
    await wf("w_stage", { triggerStage: "compra" });
    await db.insert(s.contacts).values({ id: "c2", organizationId: ORG, firstName: "Sin chat", phoneE164: "+526681112299" });
    expect(await t.onContactStageEntered({ organizationId: ORG, contactId: "c2", stage: "compra", userId: null })).toEqual([]);
  });

  it("comando: solo el texto exacto '/x' en minúsculas encuentra el workflow, y nunca uno de otra organización", async () => {
    await wf("w_cmd", { triggerCommand: "/tabla" });
    expect(await t.findWorkflowByCommand(ORG, " /TABLA ")).toMatchObject({ id: "w_cmd" });
    expect(await t.findWorkflowByCommand(ORG, "/tabla por favor")).toBeNull();
    expect(await t.findWorkflowByCommand(ORG, "tabla")).toBeNull();
    expect(await t.findWorkflowByCommand("otra_org", "/tabla")).toBeNull();
  });
});
