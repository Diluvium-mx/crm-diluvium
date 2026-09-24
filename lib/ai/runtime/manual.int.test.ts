// Acciones manuales del agente (bandeja) y conciliación de planes contra Postgres
// REAL. Solo con TEST_DATABASE_URL (base desechable). Desde el 23-sep-2026 no hay
// borradores que aprobar: el agente siempre contesta y solo lo pausa un vendedor.
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
      aiAgentMode: "auto",
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

  it("barrido: un plan atorado en 'enviando' se concilia con el hilo (nada salió → obsoleto; salió → enviado)", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    const mk = async (id: string) =>
      db.insert(s.aiAgentDrafts).values({ id, organizationId: ORG, conversationId: "cv_m", bubbles: ["x"], status: "enviando", resolvedAt: old });
    // Sin saliente del agente → obsoleto (el barrido de huérfanos vuelve a atender el entrante).
    await mk("d_sin");
    expect(await reconcileStuckDrafts(new Date())).toBe(1);
    expect((await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_sin")))[0].status).toBe("obsoleto");
    // Con su saliente → enviado.
    await db.insert(s.messages).values({
      id: "m_ag",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "x",
      status: "sent",
      sentAt: new Date(old.getTime() + 1_000),
      createdAt: new Date(old.getTime() + 1_000),
    });
    await mk("d_ok");
    await reconcileStuckDrafts(new Date());
    expect((await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_ok")))[0].status).toBe("enviado");
  });

  it("barrido: con un saliente del agente aún en camino espera; si falló, cierra el plan y avisa (sin reenviar)", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    await db.insert(s.aiAgentDrafts).values({ id: "d_q", organizationId: ORG, conversationId: "cv_m", bubbles: ["x"], status: "enviando", resolvedAt: old });
    await db.insert(s.messages).values({
      id: "m_q",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "x",
      status: "queued",
      sentAt: new Date(old.getTime() + 1_000),
      createdAt: new Date(old.getTime() + 1_000),
    });
    await reconcileStuckDrafts(new Date());
    const status = async () => (await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_q")))[0].status;
    expect(await status()).toBe("enviando");
    await db.update(s.messages).set({ status: "failed", errorCode: "send_unconfirmed" }).where(eq(s.messages.id, "m_q"));
    await reconcileStuckDrafts(new Date());
    expect(await status()).toBe("enviado");
    const avisos = await db.select().from(s.aiAgentNotices);
    expect(avisos.map((n) => n.kind)).toEqual(["envio"]);
    expect((await conv()).agentState).toBe("pausado_humano"); // el barrido no cambia el estado
  });

  it("barrido: una respuesta ANTERIOR del agente (segundos antes del plan) no cuenta como burbuja del plan", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    // Respuesta previa del agente 3 s antes del plan; el plan de 2 burbujas se guardó y el
    // worker se reinició antes de mandar la 1ª. Nada del plan salió: queda obsoleto (el
    // entrante se vuelve a atender) y NO se inventa un "salieron 1 de 2".
    await db.insert(s.messages).values({
      id: "m_prev",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "respuesta anterior",
      status: "delivered",
      sentAt: new Date(old.getTime() - 3_000),
      createdAt: new Date(old.getTime() - 3_000),
    });
    await db.insert(s.aiAgentDrafts).values({
      id: "d_plan",
      organizationId: ORG,
      conversationId: "cv_m",
      bubbles: ["Sí incluye el envío", "¿Para cuántas entradas?"],
      status: "enviando",
      resolvedAt: old,
    });
    expect(await reconcileStuckDrafts(new Date())).toBe(1);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_plan"));
    expect(d.status).toBe("obsoleto");
    expect(await db.select().from(s.aiAgentNotices)).toEqual([]);
  });

  it("barrido: una burbuja cuyo eco trae una hora ANTERIOR al plan (otro reloj) sí cuenta como enviada", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    // Plan guardado con el reloj de la app ADELANTADO: resolved_at sale de Postgres igual.
    const id = await state.savePlan({ organizationId: ORG, conversationId: "cv_m", bubbles: ["Son $5,500"], triggerMessageId: null, now: new Date(Date.now() + 5_000) });
    // La burbuja se guarda tras el plan; el eco de Zernio le pone a sent_at la hora del
    // proveedor, que puede quedar ANTES del plan.
    await db.insert(s.messages).values({
      id: "m_eco",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "Son $5,500",
      status: "delivered",
      sentAt: new Date(Date.now() - 800),
    });
    expect(await reconcileStuckDrafts(new Date(Date.now() + 11 * 60_000))).toBe(1);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("enviado"); // nunca "obsoleto": el entrante se contestaría dos veces
    expect(await db.select().from(s.aiAgentNotices)).toEqual([]);
  });

  it("un plan AUTO ('enviando') toma resolved_at del reloj de Postgres, no del de la app", async () => {
    const appAhead = new Date(Date.now() + 60_000);
    const id = await state.savePlan({ organizationId: ORG, conversationId: "cv_m", bubbles: ["a", "b"], triggerMessageId: null, now: appAhead });
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("enviando");
    expect(d.resolvedAt!.getTime()).toBeLessThan(appAhead.getTime() - 30_000);
  });

  it("los avisos se leen en el hilo, solo de la organización", async () => {
    const { addNotice } = await import("./notices");
    expect(await addNotice({ organizationId: "org_otra", conversationId: "cv_m", kind: "pasar_a_humano", body: "x" })).toBe(false);
    expect(await addNotice({ organizationId: ORG, conversationId: "cv_m", kind: "pasar_a_humano", body: "Pidió un vendedor" })).toBe(true);
    expect((await manual.loadConversationAgent(ORG, "cv_m"))!.notices.map((n) => n.body)).toEqual(["Pidió un vendedor"]);
    expect(await manual.loadConversationAgent("org_otra", "cv_m")).toBeNull();
  });
});
