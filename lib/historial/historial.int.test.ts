// Historial de cambios (Bloque A, 28-sep-2026) contra Postgres REAL (TEST_DATABASE_URL):
// cada cambio deja su fila en la MISMA transacción (si el cambio falla, no hay fila), con
// quién, antes → después; la subpestaña une Opciones, Goal/FAQs y change_history, filtra
// por tipo, fecha y pausas automáticas, y nunca mezcla organizaciones. Canales oculta los
// archivados (sin borrarlos).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ current: { organizationId: "org_hc", userId: "u_hc", role: "agent" } }));
vi.mock("@/lib/auth/active-organization", () => ({ requireActiveMembership: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/workflows/triggers", () => ({ onContactStageEntered: async () => undefined, findWorkflowByCommand: async () => null }));

describe.skipIf(!TEST_DATABASE_URL)("historial de cambios (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let editor: typeof import("@/lib/agente-ia/editor-store");
  let fs: typeof import("@/lib/contacts/funnel-stages");
  let pause: typeof import("@/lib/ai/runtime/pause");
  let manual: typeof import("@/lib/ai/runtime/manual");
  let opciones: typeof import("@/lib/agente-ia/opciones-store");
  let wf: typeof import("@/lib/actions/workflows");
  let settings: typeof import("@/lib/actions/agente-ia-settings");
  let editorActions: typeof import("@/lib/actions/agente-ia-editor");
  let getChangeHistory: typeof import("@/lib/actions/historial").getChangeHistory;

  const ORG = "org_hc";
  const OTRA = "org_hc_otra";
  const USER = "u_hc";
  const CONV = "conv_hc";
  const queue = { getJob: async () => undefined, add: async () => undefined };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    editor = await import("@/lib/agente-ia/editor-store");
    fs = await import("@/lib/contacts/funnel-stages");
    pause = await import("@/lib/ai/runtime/pause");
    manual = await import("@/lib/ai/runtime/manual");
    opciones = await import("@/lib/agente-ia/opciones-store");
    wf = await import("@/lib/actions/workflows");
    settings = await import("@/lib/actions/agente-ia-settings");
    editorActions = await import("@/lib/actions/agente-ia-editor");
    ({ getChangeHistory } = await import("@/lib/actions/historial"));
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.eq(s.user.id, USER));
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "hc", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "hc-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Daniel", email: "hc@example.test" });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "uno dos tres" });
    await db.insert(s.channels).values([
      { id: "ch_hc", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_hc", displayName: "WhatsApp Diluvium", aiAgentMode: "off" },
      { id: "ch_hc_arch", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_hc_arch", displayName: "Sandbox", isActive: false, isTest: true, archivedAt: new Date() },
    ]);
    await db.insert(s.contacts).values({ id: "ct_hc", organizationId: ORG, firstName: "Juan", lastName: "Pérez", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values({ id: CONV, organizationId: ORG, contactId: "ct_hc", channelId: "ch_hc", providerConversationId: "zconv_hc", lastMessageAt: new Date() });
  });

  const rows = (org = ORG) =>
    db.select().from(s.changeHistory).where(d.eq(s.changeHistory.organizationId, org)).orderBy(s.changeHistory.createdAt);

  it("Modelo 1 y 2: quién y antes → después con el nombre del modelo; el mismo modelo no deja fila", async () => {
    await editor.saveModel1(ORG, "gpt-5.6-terra", USER);
    await editor.saveBrainModel(ORG, "claude-sonnet-5", USER);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "modelos", action: "modelo_1", userId: USER, oldValue: "GPT-5.6 Luna", newValue: "GPT-5.6 Terra" });
  });

  it("etapas: renombrar + modelo, reordenar, papel y borrar; un cambio que falla no deja fila", async () => {
    const stages = await fs.listFunnelStages(ORG);
    const prospecto = stages.find((x) => x.key === "prospecto")!;
    await fs.updateFunnelStage(ORG, prospecto.id, { name: "Nuevo", modelSlot: 2 }, USER);
    await expect(fs.reorderFunnelStages(ORG, [prospecto.id], USER)).rejects.toThrow("no coincide");
    const ids = stages.map((x) => x.id);
    await fs.reorderFunnelStages(ORG, [ids[0], ids[2], ids[1], ...ids.slice(3)], USER);
    const extra = await fs.createFunnelStage(ORG, { name: "Entregado" }, USER);
    await fs.setFunnelStageRole(ORG, extra.id, "venta_cerrada", USER);
    await fs.deleteFunnelStage(ORG, prospecto.id, stages.find((x) => x.key === "interesado")!.id, USER);
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["renombrar", "modelo", "reordenar", "crear", "papel", "borrar"]);
    expect(r[0]).toMatchObject({ oldValue: "Prospecto", newValue: "Nuevo", userId: USER });
    expect(r[1]).toMatchObject({ subject: "Nuevo", oldValue: "Modelo 1", newValue: "Modelo 2" });
    expect(r[2].newValue).toBe("Inbox, Interesado, Nuevo, Cerca de compra, Compra");
    expect(r[4]).toMatchObject({ subject: "Venta cerrada", oldValue: "Compra", newValue: "Entregado" });
    expect(r[5]).toMatchObject({ subject: "Nuevo", newValue: "Borrada · 0 contactos pasaron a «Interesado»" });
  });

  it("canal: encender/apagar con quién; Canales solo muestra los NO archivados (el archivado sigue en la base)", async () => {
    await settings.setChannelAgentMode({ channelId: "ch_hc", mode: "auto" });
    await settings.setChannelAgentMode({ channelId: "ch_hc", mode: "auto" });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "canales", action: "encender", subject: "WhatsApp Diluvium", oldValue: "Apagado", newValue: "Encendido", userId: USER });
    const view = await editorActions.getAgentEditor();
    expect(view.channels.map((c) => c.displayName)).toEqual(["WhatsApp Diluvium"]);
    expect(await db.select({ id: s.channels.id }).from(s.channels).where(d.eq(s.channels.organizationId, ORG))).toHaveLength(2);
  });

  it("workflows: crear, editar (solo lo que cambió), encender, apagar y borrar", async () => {
    const input = { id: null, name: "Banco", agentDescription: "", enabled: false, triggerAgent: false, triggerKeywords: [], triggerCommand: null, triggerStage: null, steps: [{ kind: "send_text" as const, text: "Hola" }] };
    const created = await wf.saveWorkflow(input);
    if (!created.ok) throw new Error(created.error);
    await wf.saveWorkflow({ ...input, id: created.id });
    await wf.saveWorkflow({ ...input, id: created.id, name: "Datos bancarios", triggerKeywords: ["banco"] });
    await wf.toggleWorkflow({ id: created.id, enabled: true });
    await wf.toggleWorkflow({ id: created.id, enabled: false });
    await wf.deleteWorkflow({ id: created.id });
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["crear", "editar", "encender", "apagar", "borrar"]);
    expect(r[0]).toMatchObject({ subject: "Banco", newValue: "Apagado · 1 paso" });
    expect(r[1]).toMatchObject({ oldValue: "Nombre: «Banco» · Palabras clave: ninguna", newValue: "Nombre: «Datos bancarios» · Palabras clave: banco" });
    expect(r[4]).toMatchObject({ subject: "Datos bancarios", userId: USER });
  });

  it("pausas por chat: «Pausar agente» y «Activar» con quién; la automática sin autor; tope/asesor sin fila", async () => {
    const now = new Date();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: null, now, userId: USER }, { queue });
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER);
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER); // ya activo: sin fila
    await pause.pauseForHumanReply(ORG, CONV, new Date(), null, { action: "pausa_auto" });
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER);
    await pause.pauseForHumanReply(ORG, CONV, new Date(), null); // tope de respuestas: sin fila
    const r = await rows();
    expect(r.map((x) => [x.action, x.userId])).toEqual([
      ["pausar", USER],
      ["activar", USER],
      ["pausa_auto", null],
      ["activar", USER],
    ]);
    expect(r[0]).toMatchObject({ subject: "Juan Pérez", subjectId: CONV, oldValue: "Activo", newValue: "Pausado hasta «Activar»" });
  });

  it("la subpestaña une las tres fuentes, lo más nuevo arriba, con filtros; otra organización no ve nada", async () => {
    // Opciones toma la hora de Node y lo demás la de Postgres: unos ms entre cambios.
    const tick = () => new Promise((r) => setTimeout(r, 25));
    await opciones.saveBotOptions(ORG, USER, { responseDelaySeconds: 30 });
    await tick();
    await editor.saveGoal(ORG, USER, "uno dos tres cuatro");
    await tick();
    await editor.saveModel1(ORG, "gpt-5.6-terra", USER);
    await pause.pauseForHumanReply(ORG, CONV, new Date(), null, { action: "pausa_auto" });

    const all = await getChangeHistory({});
    if (!all.ok) throw new Error(all.message);
    expect(all.rows.map((x) => x.type)).toEqual(["modelos", "goal_faqs", "goal_faqs", "opciones"]);
    expect(all.rows[0]).toMatchObject({ who: "Daniel", what: "Cambió el Modelo 1", before: "GPT-5.6 Luna", after: "GPT-5.6 Terra" });
    // La primera versión es la foto del Goal anterior (sin autor) y la nueva compara contra ella.
    expect(all.rows[1]).toMatchObject({ who: "Daniel", what: "Guardó el Goal", before: "3 palabras", after: "4 palabras" });
    expect(all.rows[2]).toMatchObject({ who: "Sistema", what: "Versión del Goal guardada por el sistema", before: null, after: "3 palabras" });
    expect(all.rows[3]).toMatchObject({ what: "Cambió la opción «Tiempo de espera antes de responder»", before: "15 s", after: "30 s" });

    const withAuto = await getChangeHistory({ type: "pausas", includeAuto: true });
    expect(withAuto.ok && withAuto.rows.map((x) => [x.who, x.automatic])).toEqual([["Automático", true]]);

    const future = await getChangeHistory({ from: "2099-01-01" });
    expect(future.ok && future.rows).toEqual([]);
    expect(await getChangeHistory({ from: "2026-09-30", to: "2026-09-01" })).toEqual({ ok: false, message: "La fecha «Desde» debe ser antes de «Hasta»." });

    session.current = { organizationId: OTRA, userId: USER, role: "agent" };
    const other = await getChangeHistory({ includeAuto: true });
    expect(other.ok && other.rows).toEqual([]);
  });
});
