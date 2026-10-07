// Historial de cambios (Bloque A, 28-sep-2026) contra Postgres REAL (TEST_DATABASE_URL):
// cada cambio deja su fila en la MISMA transacción (si el cambio falla, no hay fila), con
// quién, antes → después; la subpestaña une Opciones, Goal/FAQs y change_history, filtra
// por tipo, fecha y pausas automáticas, y nunca mezcla organizaciones. Canales oculta los
// archivados (sin borrarlos). Bloque E: regla de etapa, nombre del agente, tallas, mensajes
// rápidos, vendedores (solo owner/admin), pausas por tope/asesor/vuelta sola y "Ver cambios".
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
// lib/auth (lo usa lib/team/store para el hash de la contraseña) exige APP_URL al importarse.
process.env.APP_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "secreto-de-pruebas-historial-0123456789";

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
  let getChangeDiff: typeof import("@/lib/actions/historial").getChangeDiff;
  let snippetsActions: typeof import("@/lib/actions/snippets");
  let qualification: typeof import("@/lib/contacts/qualification");
  let team: typeof import("@/lib/team/store");

  const ORG = "org_hc";
  const OTRA = "org_hc_otra";
  const USER = "u_hc";
  const CONV = "conv_hc";
  const VEND = "u_hc_vend";
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
    ({ getChangeHistory, getChangeDiff } = await import("@/lib/actions/historial"));
    snippetsActions = await import("@/lib/actions/snippets");
    qualification = await import("@/lib/contacts/qualification");
    team = await import("@/lib/team/store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTRA]));
    await db.delete(s.user).where(d.inArray(s.user.id, [USER, VEND]));
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

  it("S3 (0053): el Historial conserva el nombre del autor de ESE momento aunque luego se renombre", async () => {
    await editor.saveModel1(ORG, "gpt-5.6-terra", USER);
    await db.insert(s.aiConfigChanges).values({ id: "acc_hc", organizationId: ORG, userId: USER, field: "pausa_humano", oldValue: "no", newValue: "si" });
    expect((await rows())[0].authorName).toBe("Daniel");
    await db.update(s.user).set({ name: "Daniel Ruiz" }).where(d.eq(s.user.id, USER));
    const list = await getChangeHistory({});
    if (!list.ok) throw new Error(list.message);
    expect(list.rows.length).toBeGreaterThanOrEqual(2);
    expect(list.rows.every((r) => r.who === "Daniel")).toBe(true);
    // Un cambio nuevo ya sale con el nombre nuevo.
    await editor.saveModel1(ORG, "gpt-5.6-luna", USER);
    const after = await getChangeHistory({ type: "modelos" });
    expect(after.ok && after.rows[0].who).toBe("Daniel Ruiz");
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
    const input = { id: null, name: "Banco", agentDescription: "", enabled: false, triggerAgent: false, triggerKeywords: [], triggerCommand: null, triggerStage: null, triggerStartOnly: false, triggerStartOnlyAgent: true, maxSendsPerChat: null, isAnswer: false, steps: [{ kind: "send_text" as const, text: "Hola" }] };
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

  it("pausas por chat: «Pausar agente» y «Activar» con quién; las automáticas (vendedor, contestador automático, asesor, vuelta sola) sin autor", async () => {
    const now = new Date();
    await pause.pauseAgentManually({ organizationId: ORG, conversationId: CONV, until: null, now, userId: USER }, { queue });
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER);
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER); // ya activo: sin fila
    await pause.pauseForHumanReply(ORG, CONV, new Date(), null, { action: "pausa_auto" });
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER);
    await pause.pauseForHumanReply(ORG, CONV, new Date(), null, { action: "pausa_bucle" });
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(), USER);
    // Pidió un asesor: pausa con hora de regreso; al cumplirse, el agente vuelve solo.
    const until = new Date(Date.now() - 60_000);
    await pause.pauseForHumanReply(ORG, CONV, new Date(Date.now() - 120_000), until, { action: "pausa_asesor" });
    expect(await pause.reactivateDuePauses(new Date())).toBe(1);
    expect(await pause.reactivateDuePause(ORG, CONV, new Date())).toBe(false); // ya volvió: sin fila
    const r = await rows();
    expect(r.map((x) => [x.action, x.userId])).toEqual([
      ["pausar", USER],
      ["activar", USER],
      ["pausa_auto", null],
      ["activar", USER],
      ["pausa_bucle", null],
      ["activar", USER],
      ["pausa_asesor", null],
      ["vuelta_sola", null],
    ]);
    expect(r[0]).toMatchObject({ subject: "Juan Pérez", subjectId: CONV, oldValue: "Activo", newValue: "Pausado hasta «Activar»" });
    expect(r[7]).toMatchObject({ subject: "Juan Pérez", newValue: "Activo" });
    expect(r[7].oldValue).toMatch(/^Pausado hasta \d/);

    // Todas las automáticas se ocultan sin el filtro y salen con él.
    const hidden = await getChangeHistory({ type: "pausas" });
    expect(hidden.ok && hidden.rows.map((x) => x.automatic)).toEqual([false, false, false, false]);
    const shown = await getChangeHistory({ type: "pausas", includeAuto: true });
    expect(shown.ok && shown.rows.filter((x) => x.automatic).map((x) => x.who)).toEqual(["Automático", "Automático", "Automático", "Automático"]);
  });

  it("Bloque E: regla de etapa, nombre del agente y tallas, con 'Ver cambios'; guardar igual no deja fila", async () => {
    const stages = await fs.listFunnelStages(ORG);
    const inbox = stages[0];
    await fs.updateFunnelStage(ORG, inbox.id, { botRule: "Mover cuando pida precio" }, USER);
    await fs.updateFunnelStage(ORG, inbox.id, { botRule: "Mover cuando pida precio" }, USER); // igual: sin fila
    await editor.saveProfile(ORG, { agentName: "Ángela R." }, USER);
    await editor.saveProfile(ORG, { agentName: "Ángela R." }, USER); // igual: sin fila
    await qualification.replaceSizeRanges(db, ORG, [{ linea: "estandar", talla: "1", minCm: 60, maxCm: 90, posicion: 0 }], USER);
    await qualification.replaceSizeRanges(db, ORG, [{ linea: "estandar", talla: "1", minCm: 60, maxCm: 95, posicion: 0 }], USER);
    await qualification.replaceSizeRanges(db, ORG, [{ linea: "estandar", talla: "1", minCm: 60, maxCm: 95, posicion: 0 }], USER); // igual
    const r = await rows();
    expect(r.map((x) => [x.kind, x.action])).toEqual([
      ["etapas", "regla"],
      ["nombre", "editar"],
      ["tallas", "editar"],
      ["tallas", "editar"],
    ]);
    expect(r[1]).toMatchObject({ oldValue: "Ángela", newValue: "Ángela R.", userId: USER });
    expect(r[3]).toMatchObject({ oldValue: "Estándar · 1: 60–90 cm", newValue: "Estándar · 1: 60–95 cm" });

    const list = await getChangeHistory({});
    if (!list.ok) throw new Error(list.message);
    const regla = list.rows.find((x) => x.what.startsWith("Cambió la regla"))!;
    expect(regla).toMatchObject({ type: "etapas", before: "(vacía)", after: "Mover cuando pida precio", hasDetail: true });
    const diff = await getChangeDiff(regla.id);
    expect(diff.ok && diff.diff.blocks[0]).toMatchObject({ title: "Regla del Agente IA", tag: "agregado" });
    expect(await getChangeHistory({ type: "tallas" })).toMatchObject({ ok: true, rows: [{ what: "Cambió las tallas y medidas" }, { what: "Cambió las tallas y medidas" }] });
  });

  it("mensajes rápidos: crear, editar y borrar con su texto (Ver cambios); todos los roles lo ven", async () => {
    const created = await snippetsActions.createSnippet({ name: "Saludo", body: "Hola {{nombre}}" });
    await snippetsActions.updateSnippet({ id: created.id, name: "Saludo", body: "Hola {{nombre}}" }); // igual: sin fila
    await snippetsActions.updateSnippet({ id: created.id, name: "Saludo inicial", body: "Hola {{nombre}}, soy {{vendedor}}" });
    await snippetsActions.deleteSnippet(created.id);
    await expect(snippetsActions.createSnippet({ name: "", body: "x" })).rejects.toThrow(); // no se guarda: sin fila
    const r = await rows();
    expect(r.map((x) => [x.action, x.subject, x.userId])).toEqual([
      ["crear", "Saludo", USER],
      ["editar", "Saludo inicial", USER],
      ["borrar", "Saludo inicial", USER],
    ]);
    expect(r[1]).toMatchObject({ oldValue: "Nombre: «Saludo»", newValue: "Nombre: «Saludo inicial»" });
    const list = await getChangeHistory({ type: "mensajes_rapidos" });
    if (!list.ok) throw new Error(list.message);
    const edit = list.rows.find((x) => x.what.startsWith("Editó"))!;
    const diff = await getChangeDiff(edit.id);
    if (!diff.ok) throw new Error(diff.message);
    expect(diff.diff.blocks[0].lines[0].segments.filter((x) => x.op === "added").map((x) => x.text)).toEqual([", soy {{vendedor}}"]);
  });

  it("vendedores: desactivar, reactivar y contraseña (sin mostrarla) en la misma transacción; solo owner y admin los ven", async () => {
    await db.insert(s.user).values({ id: VEND, name: "Ana", email: "ana.hc@example.test" });
    await db.insert(s.member).values([
      { id: "m_hc_owner", organizationId: ORG, userId: USER, role: "owner", createdAt: new Date() },
      { id: "m_hc_vend", organizationId: ORG, userId: VEND, role: "agent", createdAt: new Date() },
    ]);
    await db.insert(s.session).values({ id: "ses_hc", userId: VEND, token: "tok_hc", expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), updatedAt: new Date() });
    const log = { organizationId: ORG, actorId: USER, targetName: "Ana" };
    await team.setDeactivated(VEND, true, log);
    expect(await db.select().from(s.session).where(d.eq(s.session.userId, VEND))).toEqual([]);
    await team.setDeactivated(VEND, false, log);
    await team.setPassword(VEND, "una-contraseña-nueva-larga", log);
    await team.logTeamChange(log, VEND, { action: "rol", from: "agent", to: "admin" });
    // El último owner no se puede desactivar: el trigger truena y NO queda fila.
    await expect(team.setDeactivated(USER, true, { ...log, targetName: "Daniel" })).rejects.toThrow("al menos un owner");
    const r = await rows();
    expect(r.map((x) => [x.action, x.subject, x.oldValue, x.newValue])).toEqual([
      ["desactivar", "Ana", "Activo", "Desactivado"],
      ["reactivar", "Ana", "Desactivado", "Activo"],
      ["contrasena", "Ana", null, null],
      ["rol", "Ana", "Vendedor", "Admin"],
    ]);
    expect(JSON.stringify(r)).not.toContain("una-contraseña-nueva-larga");
    const [acc] = await db.select({ password: s.account.password }).from(s.account).where(d.eq(s.account.userId, VEND));
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toBe("una-contraseña-nueva-larga");

    // Un vendedor (agent) no ve estas filas ni el tipo; owner/admin sí.
    session.current = { organizationId: ORG, userId: USER, role: "agent" };
    const agent = await getChangeHistory({});
    expect(agent.ok && agent.rows.filter((x) => x.type === "vendedores")).toEqual([]);
    expect(await getChangeHistory({ type: "vendedores" })).toEqual({ ok: true, rows: [], truncated: false });
    session.current = { organizationId: ORG, userId: USER, role: "admin" };
    const admin = await getChangeHistory({ type: "vendedores" });
    expect(admin.ok && admin.rows.map((x) => x.what)).toEqual(["Cambió el rol de «Ana»", "Restableció la contraseña de «Ana»", "Reactivó a «Ana»", "Desactivó a «Ana»"]);
  });

  it("'Ver cambios': Goal por párrafo contra la versión anterior y workflow paso por paso; de otra organización, nada", async () => {
    await editor.saveGoal(ORG, USER, "Eres Ángela.\n\nPrecio $5,500.");
    await editor.saveGoal(ORG, USER, "Eres Ángela.\n\nPrecio $6,000.");
    const input = { id: null, name: "Banco", agentDescription: "", enabled: false, triggerAgent: false, triggerKeywords: [], triggerCommand: null, triggerStage: null, triggerStartOnly: false, triggerStartOnlyAgent: true, maxSendsPerChat: null, isAnswer: false, steps: [{ kind: "send_text" as const, text: "Datos de pago" }] };
    const created = await wf.saveWorkflow(input);
    if (!created.ok) throw new Error(created.error);
    await wf.saveWorkflow({ ...input, id: created.id, steps: [{ kind: "send_text", text: "Datos de pago actualizados" }, { kind: "wait", seconds: 10 }] });

    const list = await getChangeHistory({});
    if (!list.ok) throw new Error(list.message);
    const goals = list.rows.filter((x) => x.type === "goal_faqs");
    // La más nueva compara contra la anterior; la foto más vieja no tiene con qué compararse.
    expect(goals.map((x) => x.hasDetail)).toEqual([true, true, false]);
    const goal = await getChangeDiff(goals[0].id);
    if (!goal.ok) throw new Error(goal.message);
    expect(goal.diff.blocks).toEqual([
      { title: "Párrafo 2", tag: "editado", lines: [{ label: null, segments: [{ op: "same", text: "Precio" }, { op: "removed", text: " $5,500" }, { op: "added", text: " $6,000" }, { op: "same", text: "." }] }] },
    ]);
    expect(goal.diff.unchanged).toBe("1 párrafo sin cambios");

    const edit = list.rows.find((x) => x.what === "Editó el workflow «Banco»")!;
    const wfDiff = await getChangeDiff(edit.id);
    if (!wfDiff.ok) throw new Error(wfDiff.message);
    expect(wfDiff.diff.blocks.map((b) => [b.title, b.tag])).toEqual([
      ["Paso 1 · Texto", "editado"],
      ["Paso 2 · Espera", "agregado"],
    ]);

    // Opciones no tienen detalle; una fila de otra organización no se abre.
    expect(await getChangeDiff("o:cualquiera")).toEqual({ ok: false, message: "Este cambio no tiene detalle." });
    session.current = { organizationId: OTRA, userId: USER, role: "agent" };
    expect(await getChangeDiff(edit.id)).toEqual({ ok: false, message: "Este cambio no tiene detalle." });
    expect(await getChangeDiff(goals[0].id)).toEqual({ ok: false, message: "Este cambio no tiene detalle." });
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
