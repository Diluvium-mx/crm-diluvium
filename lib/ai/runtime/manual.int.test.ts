// Acciones manuales del agente (bandeja) contra Postgres REAL: reactivar y
// enviar/descartar borradores. Solo con TEST_DATABASE_URL (base desechable).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("acciones manuales del agente (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let manual: typeof import("./manual");
  let state: typeof import("./state");
  const ORG = "org_m";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    manual = await import("./manual");
    state = await import("./state");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org", createdAt: new Date() },
      { id: "org_otra", name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u1", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_m",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_m",
      displayName: "Diluvium",
      aiAgentMode: "borrador",
    });
    await db.insert(s.contacts).values({ id: "ct_m", organizationId: ORG, firstName: "C" });
    await db.insert(s.conversations).values({
      id: "cv_m",
      organizationId: ORG,
      contactId: "ct_m",
      channelId: "ch_m",
      agentState: "pausado_humano",
      agentStateChangedAt: new Date(Date.now() - 3_600_000),
    });
  });

  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, "cv_m")))[0];

  async function draft(status: "pendiente" | "obsoleto" = "pendiente") {
    const id = `d_${crypto.randomUUID()}`;
    await db.insert(s.aiAgentDrafts).values({
      id,
      organizationId: ORG,
      conversationId: "cv_m",
      bubbles: ["Hola", "¿Cuánto mide?"],
      status,
    });
    return id;
  }

  it("reactivar: vuelve a activo, limpia la pausa y mueve el corte a ahora", async () => {
    const now = new Date();
    expect(await manual.reactivateAgentInConversation(ORG, "cv_m", now)).toBe(true);
    const c = await conv();
    expect(c.agentState).toBe("activo");
    expect(c.agentPausedUntil).toBeNull();
    expect(c.agentStateChangedAt?.getTime()).toBe(now.getTime());
    expect(await manual.reactivateAgentInConversation(ORG, "cv_m", now)).toBe(false); // ya activo
  });

  it("reactivar no toca conversaciones de otra organización", async () => {
    expect(await manual.reactivateAgentInConversation("org_otra", "cv_m", new Date())).toBe(false);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("enviar borrador: manda sus burbujas con pausa y queda 'enviado'; un 2º clic no reenvía", async () => {
    const id = await draft();
    const sent: string[] = [];
    const sleeps: number[] = [];
    const send = async (p: { text: string; sentByUserId: string }) => {
      expect(p.sentByUserId).toBe("u1");
      sent.push(p.text);
    };
    const opts = { organizationId: ORG, draftId: id, userId: "u1", now: new Date(), sendBubble: send, sleep: async (ms: number) => void sleeps.push(ms) };
    expect(await manual.approveDraft(opts)).toEqual({ sent: 2 });
    expect(sent).toEqual(["Hola", "¿Cuánto mide?"]);
    expect(sleeps).toEqual([1_500]);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d).toMatchObject({ status: "enviado", resolvedByUserId: "u1" });
    expect((await conv()).lastAgentReplyAt).not.toBeNull();
    await expect(manual.approveDraft(opts)).rejects.toBeInstanceOf(manual.DraftNotAvailableError);
    expect(sent).toHaveLength(2);
  });

  it("si la primera burbuja falla, el borrador vuelve a 'pendiente' para reintentar", async () => {
    const id = await draft();
    await expect(
      manual.approveDraft({
        organizationId: ORG,
        draftId: id,
        userId: "u1",
        now: new Date(),
        sendBubble: async () => {
          throw new Error("ventana cerrada");
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("ventana cerrada");
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("pendiente");
  });

  it("no se puede enviar un borrador obsoleto ni de otra organización; descartar lo cierra", async () => {
    const old = await draft("obsoleto");
    const base = { userId: "u1", now: new Date(), sendBubble: async () => undefined, sleep: async () => undefined };
    await expect(manual.approveDraft({ ...base, organizationId: ORG, draftId: old })).rejects.toBeInstanceOf(
      manual.DraftNotAvailableError,
    );
    const id = await draft();
    await expect(manual.approveDraft({ ...base, organizationId: "org_otra", draftId: id })).rejects.toBeInstanceOf(
      manual.DraftNotAvailableError,
    );
    await manual.discardDraft({ organizationId: ORG, draftId: id, userId: "u1", now: new Date() });
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("descartado");
  });

  it("canal apagado: el borrador pendiente ya no sale y apagar lo deja obsoleto", async () => {
    const id = await draft();
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_m"));
    const sent: string[] = [];
    const base = { userId: "u1", now: new Date(), sleep: async () => undefined };
    await expect(
      manual.approveDraft({ ...base, organizationId: ORG, draftId: id, sendBubble: async (p) => void sent.push(p.text) }),
    ).rejects.toBeInstanceOf(manual.DraftNotAvailableError);
    expect(sent).toEqual([]);
    // Lo que hace setChannelAgentMode(off): los pendientes del canal quedan obsoletos (solo de esa org).
    expect(await state.obsoleteChannelDrafts("org_otra", "ch_m", new Date())).toBe(0);
    expect(await state.obsoleteChannelDrafts(ORG, "ch_m", new Date())).toBe(1);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("obsoleto");
  });
});
