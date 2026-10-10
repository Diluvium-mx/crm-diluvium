// Seguimientos con el interruptor en REAL contra Postgres de verdad y un proveedor FALSO (nada sale a
// WhatsApp): el texto sale con el saludo por hora como mensaje del Agente IA y una sola vez; la plantilla
// sale con su {{1}}; la sugerencia (pausa a mano) no sale sola y deja el aviso; el cliente que contesta
// regresa al Agente IA (opción B); 131050 = sin seguimientos; al final, frío. Con el interruptor en
// Ensayo no se manda nada. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpFicha } from "./ficha";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Seguimientos en modo REAL (proveedor falso)", () => {
  type Db = typeof import("@/lib/db").db;
  type P = import("@/lib/messaging/provider").MessagingProvider;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./store");
  let reply: typeof import("./reply");
  let delivery: typeof import("./delivery");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");

  const ORG = "org_envio";
  const CONTACT = "contact_envio";
  const CONV = "conv_envio";
  const CH = "ch_envio";
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // Lunes 5-oct-2026: el cliente escribió 11:58 y le contestamos 12:00 (Ciudad de México, UTC-6).
  const T0 = new Date("2026-10-05T12:00:00-06:00");

  let sent: { kind: "text" | "template"; text?: string; name?: string; params?: string[]; key: string }[] = [];
  const provider = {
    name: "zernio",
    sendText: async (i: { text: string; idempotencyKey: string }) => {
      sent.push({ kind: "text", text: i.text, key: i.idempotencyKey });
      return { providerInternalId: `z_${sent.length}`, providerMessageId: `wamid.envio.${sent.length}` };
    },
    sendTemplate: async (i: { name: string; bodyParams: string[]; idempotencyKey: string }) => {
      sent.push({ kind: "template", name: i.name, params: i.bodyParams, key: i.idempotencyKey });
      return { providerInternalId: `z_${sent.length}`, providerMessageId: `wamid.envio.${sent.length}` };
    },
  } as unknown as P;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./store");
    reply = await import("./reply");
    delivery = await import("./delivery");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function msg(id: string, direction: "in" | "out", at: Date, source: "contact" | "ai_agent" | "crm" = direction === "in" ? "contact" : "ai_agent") {
    await db.insert(s.messages).values({ id, organizationId: ORG, conversationId: CONV, direction, source, type: "text", body: id, status: direction === "in" ? "received" : "sent", providerMessageId: `wamid.${id}`, sentAt: at, createdAt: at });
  }

  beforeEach(async () => {
    sent = [];
    await db.execute(d.sql`truncate follow_ups, change_history, ai_agent_notices, ai_config, templates, messages, conversations, channels, contact_entradas, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-envio", createdAt: new Date() });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "x", seguimientosReal: true });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_envio", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana Lucía", phoneE164: "+525512345678" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: CH,
      providerConversationId: "zconv_envio",
      lastMessageAt: T0,
      lastInboundAt: new Date(T0.getTime() - 2 * MIN),
      windowExpiresAt: new Date(T0.getTime() - 2 * MIN + 24 * HOUR),
    });
    await msg("m_cliente", "in", new Date(T0.getTime() - 2 * MIN));
    await msg("m_agente", "out", T0);
    for (const [name, body] of [
      ["hola_buenas_tardes", "Hola, buenas tardes."],
      ["hola_buenos_dias", "Hola, buenos días."],
      ["seg_medidas", "Referente a la compuerta anti-inundaciones que nos comentó {{1}}. Tuvo oportunidad de medir la entrada?"],
    ]) {
      await db.insert(s.templates).values({ id: `t_${name}`, organizationId: ORG, channelId: CH, name, language: "es_MX", body, status: "APPROVED" });
    }
  });

  const ficha = (extra: Partial<FollowUpFicha> = {}): FollowUpFicha => ({
    caso: "faltan_medidas",
    pendiente: "Se le pidió el ancho de la cochera",
    siguientePaso: "Saber el ancho",
    valeLaPena: true,
    motivo: null,
    fechaPedida: null,
    horaPedida: null,
    borrador: "¿Pudo medir el ancho de su cochera?",
    casoDeFondo: null,
    plantilla2: null,
    plantilla3: null,
    ...extra,
  });

  async function reading(now = new Date(T0.getTime() + 4 * MIN)) {
    return store.applyFollowUpReading({
      organizationId: ORG,
      conversationId: CONV,
      contactId: CONTACT,
      readUpTo: T0,
      stopAt: T0,
      lastIsCompany: true,
      ficha: ficha(),
      stages: await stagesMod.listFunnelStages(ORG),
      stageKey: "inbox",
      monto: null,
      pago: null,
      now,
    });
  }
  const row = async () => (await db.select().from(s.followUps))[0];

  it("texto: sale UNA vez a su hora, con el saludo por hora, como mensaje del Agente IA marcado «seguimiento»", async () => {
    await reading();
    const r = await row();
    expect(r).toMatchObject({ ensayo: false, door: "texto", intento: 1 });
    const at = new Date(r.dueAt!.getTime() + MIN);
    await store.followUpSweepOnce(at, { provider });
    await store.followUpSweepOnce(at, { provider });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("Hola, buenas noches, le escribo de parte del equipo de Diluvium. ¿Pudo medir el ancho de su cochera?");
    const [m] = await db.select().from(s.messages).where(d.eq(s.messages.id, sent[0].key));
    expect(m).toMatchObject({ source: "ai_agent", sentByUserId: null, direction: "out" });
    expect(m.metadata).toMatchObject({ seguimiento: { followUpId: r.id, intento: 1 } });
    const after = await row();
    expect(after).toMatchObject({ status: "programado", intento: 2 });
    expect(after.intentos[0]).toMatchObject({ n: 1, ensayo: false, messageId: sent[0].key });
    // Su propio mensaje no deja vieja la ficha: 40 min después sigue programado.
    await store.followUpSweepOnce(new Date(at.getTime() + 40 * MIN), { provider });
    expect(await row()).toMatchObject({ status: "programado", intento: 2 });
  });

  it("plantilla con la ventana cerrada: la del caso con {{1}} = cuándo escribió; nunca después de las 19:00", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    expect(r).toMatchObject({ intento: 2, door: "plantilla" });
    sent = [];
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect(sent).toEqual([expect.objectContaining({ kind: "template", name: "seg_medidas", params: ["antier"] })]);
    expect(await row()).toMatchObject({ status: "esperando" });
  });

  it("una plantilla a las 20:00 del cliente se mueve al día siguiente; con el interruptor en Ensayo no sale nada", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    // Forzar la plantilla a las 20:00 (hora del cliente): no sale, se recorre.
    const r = await row();
    const late = new Date("2026-10-07T20:00:00-06:00");
    await db.update(s.followUps).set({ dueAt: late }).where(d.eq(s.followUps.id, r.id));
    sent = [];
    await store.followUpSweepOnce(new Date(late.getTime() + MIN), { provider });
    expect(sent).toHaveLength(0);
    expect((await row()).dueAt!.getTime()).toBeGreaterThan(late.getTime());

    await db.update(s.aiConfig).set({ seguimientosReal: false }).where(d.eq(s.aiConfig.organizationId, ORG));
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    expect(sent).toHaveLength(0);
    expect((await row()).intentos.at(-1)).toMatchObject({ ensayo: true });
  });

  it("plantilla a las 20:30 del cliente elegida con «Cambiar hora»: sale a esa hora (el tope de las 19:00 es solo para lo del CRM)", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    expect(r).toMatchObject({ intento: 2, door: "plantilla" });
    const late = new Date("2026-10-07T20:30:00-06:00");
    await db.update(s.followUps).set({ dueAt: late, dueSetBy: "vendedor" }).where(d.eq(s.followUps.id, r.id));
    sent = [];
    await store.followUpSweepOnce(new Date(late.getTime() + MIN), { provider });
    expect(sent).toEqual([expect.objectContaining({ kind: "template", name: "seg_medidas" })]);
    expect(await row()).toMatchObject({ status: "esperando" });
  });

  it("pausa puesta a mano: no sale sola; a su hora de presentarse deja UN aviso (tarjeta amarilla); «Que salga solo» la deja salir", async () => {
    await db.update(s.conversations).set({ agentState: "pausado_humano", agentStateChangedAt: new Date(T0.getTime() - MIN) }).where(d.eq(s.conversations.id, CONV));
    await db.insert(s.changeHistory).values({ id: "h_pausa", organizationId: ORG, kind: "pausas", action: "pausar", subjectId: CONV, createdAt: new Date(T0.getTime() - MIN) });
    await reading();
    const r = await row();
    expect(r.modo).toBe("sugerido");
    const at = new Date(Math.max(r.dueAt!.getTime(), r.presentarAt!.getTime()) + MIN);
    await store.followUpSweepOnce(at, { provider });
    await store.followUpSweepOnce(at, { provider });
    expect(sent).toHaveLength(0);
    const notices = await db.select().from(s.aiAgentNotices);
    expect(notices).toEqual([expect.objectContaining({ kind: "seguimiento", conversationId: CONV })]);
    await db.update(s.followUps).set({ autoAprobado: true }).where(d.eq(s.followUps.id, r.id));
    await store.followUpSweepOnce(at, { provider });
    expect(sent).toHaveLength(1);
  });

  it("el cliente contesta un seguimiento que salió con pausa automática: vuelve el Agente IA con el contexto", async () => {
    const pausedAt = new Date(T0.getTime() + MIN);
    await db.update(s.conversations).set({ agentState: "pausado_humano", agentStateChangedAt: pausedAt }).where(d.eq(s.conversations.id, CONV));
    await db.insert(s.changeHistory).values({ id: "h_auto", organizationId: ORG, kind: "pausas", action: "pausa_auto", subjectId: CONV, createdAt: pausedAt });
    await reading();
    expect((await row()).modo).toBe("automatico");
    const at = new Date((await row()).dueAt!.getTime() + MIN);
    await store.followUpSweepOnce(at, { provider });
    expect(sent).toHaveLength(1);
    const wrote = new Date(at.getTime() + 10 * MIN);
    expect(await reply.resumeAgentOnFollowUpReply(ORG, CONV, wrote, wrote)).toBe(true);
    const [c] = await db.select().from(s.conversations).where(d.eq(s.conversations.id, CONV));
    expect(c.agentState).toBe("activo");
    expect(c.agentStateChangedAt!.getTime()).toBeLessThan(wrote.getTime());
    const hist = await db.select().from(s.changeHistory).where(d.eq(s.changeHistory.action, "vuelta_seguimiento"));
    expect(hist).toHaveLength(1);
    expect(await reply.followUpContextFor(ORG, CONV, wrote)).toContain("Se le pidió el ancho de la cochera");
  });

  it("un vendedor escribió DESPUÉS del seguimiento: manda el vendedor (no se reactiva)", async () => {
    await reading();
    const at = new Date((await row()).dueAt!.getTime() + MIN);
    await store.followUpSweepOnce(at, { provider });
    await db.update(s.conversations).set({ agentState: "pausado_humano", agentStateChangedAt: new Date(at.getTime() + MIN) }).where(d.eq(s.conversations.id, CONV));
    expect(await reply.resumeAgentOnFollowUpReply(ORG, CONV, new Date(at.getTime() + 5 * MIN), new Date(at.getTime() + 5 * MIN))).toBe(false);
  });

  it("un borrador con una nota interna no sale: el intento queda con el error (mismo candado que las respuestas)", async () => {
    await reading();
    await db.update(s.followUps).set({ borrador: '[tool call] actualizar_detalle {"tiene_inundaciones":"si"}' });
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    expect(sent).toHaveLength(0);
    expect((await row()).intentos[0].error).toMatch(/nota interna/);
    expect(await db.select().from(s.messages).where(d.eq(s.messages.conversationId, CONV))).toHaveLength(2);
  });

  it("131050 (baja de promociones): el intento queda con el error y el contacto, sin seguimientos", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    await delivery.onFollowUpDeliveryFailed({ organizationId: ORG, conversationId: CONV, errorCode: "131050", errorMessage: null, metadata: { seguimiento: { followUpId: r.id, intento: 1 } } });
    const after = await row();
    expect(after).toMatchObject({ status: "cancelado", cancelReason: "sin_seguimientos" });
    expect(after.intentos[0].error).toMatch(/se dio de baja/);
    const [c] = await db.select().from(s.contacts).where(d.eq(s.contacts.id, CONTACT));
    expect(c.sinSeguimientos).toBe(true);
    // Una lectura nueva ya no programa nada.
    expect(await reading(new Date(T0.getTime() + 2 * HOUR))).toMatch(/se dio de baja/);
    // «Quitar» en el Detalle: vuelve a tener seguimientos y la siguiente lectura arma uno.
    const view = await import("./view");
    expect(await view.sinSeguimientosOf(ORG, CONTACT)).toBe(true);
    expect(await view.clearSinSeguimientos("otra_org", CONTACT)).toBe(false);
    expect(await view.clearSinSeguimientos(ORG, CONTACT)).toBe(true);
    expect(await view.sinSeguimientosOf(ORG, CONTACT)).toBe(false);
    expect(await reading(new Date(T0.getTime() + 3 * HOUR))).toMatch(/faltan_medidas 1\.º/);
  });

  it("tras el último intento sin respuesta: frío", async () => {
    await reading();
    let r = await row();
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    r = await row();
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    r = await row();
    expect(r.status).toBe("esperando");
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect((await row()).status).toBe("terminado");
    const [c] = await db.select().from(s.contacts).where(d.eq(s.contacts.id, CONTACT));
    expect(c.temperature).toBe("frio");
  });

  it("7 días entre plantillas: en real NO cuentan las que solo «habrían salido» en el ensayo; sí las que salieron", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    // Una plantilla de ensayo de ayer (de otro seguimiento ya cerrado) no frena la plantilla real.
    await db.insert(s.followUps).values({
      id: "f_viejo", organizationId: ORG, conversationId: CONV, contactId: CONTACT, caso: "precio_sin_respuesta", status: "terminado",
      ensayo: true, timeZone: "America/Mexico_City", basedOnMessageAt: T0, createdAt: new Date(r.dueAt!.getTime() - 24 * HOUR),
      intentos: [{ n: 2, at: new Date(r.dueAt!.getTime() - 24 * HOUR).toISOString(), door: "plantilla", template: "hola_buenas_tardes", modo: "automatico", ensayo: true }],
    });
    sent = [];
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect(sent).toEqual([expect.objectContaining({ kind: "template" })]);
  });

  it("7 días entre plantillas: una plantilla que de verdad le llegó (aunque la mandara un vendedor) sí recorre la siguiente", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    // Antes de la parada (si fuera después, sería un mensaje nuevo que el lector tiene que leer).
    const ayer = new Date(T0.getTime() - HOUR);
    await db.insert(s.messages).values({ id: "m_tpl_vendedor", organizationId: ORG, conversationId: CONV, direction: "out", source: "crm", type: "template", body: "Hola, buenas tardes.", status: "delivered", providerMessageId: "wamid.tplv", sentAt: ayer, createdAt: ayer });
    sent = [];
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect(sent).toHaveLength(0);
    expect((await row()).dueAt!.getTime()).toBeGreaterThanOrEqual(ayer.getTime() + 7 * 24 * HOUR - MIN);
  });

  it("Cancelar apaga los seguimientos de ESE chat: el Agente IA no arma otro aunque el chat se mueva; «Reactivar» lo reabre", async () => {
    const view = await import("./view");
    await db.insert(s.user).values({ id: "u_vend", name: "Carlos", email: "carlos@envio.test" });
    await reading();
    const r = await row();
    expect(await view.cancelFollowUpById(ORG, r.id, "u_vend", new Date(T0.getTime() + 10 * MIN))).toBe(true);
    // La píldora queda «cancelado», con quién.
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "cancelado", byName: "Carlos" });
    // Una lectura nueva (el chat se movió) no arma nada.
    expect(await reading(new Date(T0.getTime() + 2 * HOUR))).toMatch(/cancelados en este chat/);
    expect((await db.select().from(s.followUps)).filter((x) => x.status === "programado")).toHaveLength(0);
    // Reactivar: el chat no cambió, se reabre el mismo seguimiento con hora nueva.
    expect(await view.reactivateFollowUps(ORG, CONV, new Date(T0.getTime() + 3 * HOUR))).toBe(true);
    const again = await row();
    expect(again).toMatchObject({ id: r.id, status: "programado", intento: 1 });
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "activo" });
    expect(await view.reactivateFollowUps(ORG, CONV, new Date(T0.getTime() + 4 * HOUR))).toBe(false);
  });

  it("«Reactivar» con el chat ya cambiado (7-oct-2026): no reabre el viejo, pide una lectura nueva (nunca deja el chat sin nada)", async () => {
    const view = await import("./view");
    await db.insert(s.user).values({ id: "u_vend", name: "Carlos", email: "carlos@envio.test" });
    await reading();
    const r = await row();
    // Después de la lectura llegó otro mensaje nuestro (el chat cambió).
    const despues = new Date(T0.getTime() + 5 * MIN);
    await db.insert(s.messages).values({ id: "m_nuevo", organizationId: ORG, conversationId: CONV, direction: "out", source: "crm", type: "text", body: "¿Sigue ahí?", status: "delivered", providerMessageId: "wamid.nuevo", sentAt: despues, createdAt: despues });
    await db.update(s.conversations).set({ detalleLeidoHasta: T0 }).where(d.eq(s.conversations.id, CONV));
    expect(await view.cancelFollowUpById(ORG, r.id, "u_vend", new Date(T0.getTime() + 10 * MIN))).toBe(true);
    expect(await view.reactivateFollowUps(ORG, CONV, new Date(T0.getTime() + 20 * MIN))).toBe(true);
    expect((await row()).status).toBe("cancelado");
    const [c] = await db.select().from(s.conversations).where(d.eq(s.conversations.id, CONV));
    expect(c).toMatchObject({ seguimientosOffAt: null, detalleLeidoHasta: null });
  });

  it("se dio de baja (131050): la píldora queda en «baja»; «Volver a darle seguimiento» la quita", async () => {
    const view = await import("./view");
    await reading();
    const r = await row();
    await delivery.onFollowUpDeliveryFailed({ organizationId: ORG, conversationId: CONV, errorCode: "131050", errorMessage: null, metadata: { seguimiento: { followUpId: r.id, intento: 1 } } });
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "baja", contactId: CONTACT });
    await view.clearSinSeguimientos(ORG, CONTACT);
    // La píldora siempre está (7-oct-2026): sin seguimiento abierto, «dormido».
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "dormido" });
  });

  it("la píldora siempre está (7-oct-2026): «dormido» con su razón, «esperando» tras el último intento y «Apagar» desde dormido", async () => {
    const view = await import("./view");
    await db.insert(s.user).values({ id: "u_vend", name: "Carlos", email: "carlos@envio.test" });
    // Nuestro mensaje es el último y el Agente IA todavía no lee el chat.
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "dormido", razon: expect.stringMatching(/lee el chat en unos minutos/) });
    // Ya lo leyó y dijo «No seguir».
    await db.update(s.conversations).set({ detalleLeidoHasta: T0 }).where(d.eq(s.conversations.id, CONV));
    await store.applyFollowUpReading({
      organizationId: ORG, conversationId: CONV, contactId: CONTACT, readUpTo: T0, stopAt: T0, lastIsCompany: true,
      ficha: ficha({ caso: "no_seguir", valeLaPena: false, motivo: "Dijo que ya lo compró en otro lado" }),
      stages: await stagesMod.listFunnelStages(ORG), stageKey: "inbox", monto: null, pago: null, now: new Date(T0.getTime() + 4 * MIN),
    });
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "dormido", razon: "No seguir: Dijo que ya lo compró en otro lado." });
    // El cliente escribió al último.
    const despues = new Date(T0.getTime() + 10 * MIN);
    await msg("m_cliente2", "in", despues);
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "dormido", razon: expect.stringMatching(/El cliente escribió al último/) });
    // «Apagar seguimientos en este chat» desde dormido: queda «Cancelado».
    expect(await view.turnOffFollowUps(ORG, CONV, "u_vend", new Date(T0.getTime() + 11 * MIN))).toBe(true);
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "cancelado", byName: "Carlos" });
  });

  it("«esperando» se queda tras la espera de 72 h mientras el último mensaje sea nuestro; Cancelar ahí apaga el chat", async () => {
    const view = await import("./view");
    await db.insert(s.user).values({ id: "u_vend", name: "Carlos", email: "carlos@envio.test" });
    await reading();
    const r = await row();
    await db.update(s.followUps).set({ status: "terminado", closedAt: new Date(T0.getTime() + 5 * 24 * HOUR), intentos: [{ n: 1, at: new Date(T0.getTime() + HOUR).toISOString(), door: "texto", template: null, modo: "automatico", ensayo: false, messageId: "m_x" }] }).where(d.eq(s.followUps.id, r.id));
    await db.update(s.conversations).set({ detalleLeidoHasta: T0 }).where(d.eq(s.conversations.id, CONV));
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "activo", status: "esperando", terminado: true, dueAt: null });
    expect(await view.cancelFollowUpById(ORG, r.id, "u_vend", new Date(T0.getTime() + 6 * 24 * HOUR))).toBe(true);
    expect((await row()).status).toBe("terminado");
    expect(await view.loadFollowUpState(ORG, CONV)).toMatchObject({ estado: "cancelado" });
  });
});
