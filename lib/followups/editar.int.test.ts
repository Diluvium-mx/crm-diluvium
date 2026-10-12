// «Editar mensaje» (12-oct-2026, docs/seguimientos.md §23) contra Postgres de verdad y un proveedor FALSO: el texto
// de un vendedor sale TAL CUAL (sin saludo) con la ventana abierta; con la ventana cerrada sale la plantilla que eligió
// (solo de las aprobadas que el seguimiento sabe llenar); vale para ese intento y se borra al salir o al releer el chat.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpFicha } from "./ficha";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Editar mensaje del seguimiento", () => {
  type Db = typeof import("@/lib/db").db;
  type P = import("@/lib/messaging/provider").MessagingProvider;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./store");
  let editar: typeof import("./editar");
  let view: typeof import("./view");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");

  const ORG = "org_editar";
  const OTRA = "org_otra";
  const CONTACT = "contact_editar";
  const CONV = "conv_editar";
  const CH = "ch_editar";
  const USER = "u_editar";
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // Lunes 5-oct-2026: el cliente escribió 11:58 y le contestamos 12:00 (Ciudad de México, UTC-6).
  const T0 = new Date("2026-10-05T12:00:00-06:00");

  let sent: { kind: "text" | "template"; text?: string; name?: string; params?: string[] }[] = [];
  const provider = {
    name: "zernio",
    sendText: async (i: { text: string }) => {
      sent.push({ kind: "text", text: i.text });
      return { providerInternalId: `z_${sent.length}`, providerMessageId: `wamid.editar.${sent.length}` };
    },
    sendTemplate: async (i: { name: string; bodyParams: string[] }) => {
      sent.push({ kind: "template", name: i.name, params: i.bodyParams });
      return { providerInternalId: `z_${sent.length}`, providerMessageId: `wamid.editar.${sent.length}` };
    },
  } as unknown as P;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./store");
    editar = await import("./editar");
    view = await import("./view");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function msg(id: string, direction: "in" | "out", at: Date) {
    await db.insert(s.messages).values({ id, organizationId: ORG, conversationId: CONV, direction, source: direction === "in" ? "contact" : "ai_agent", type: "text", body: id, status: direction === "in" ? "received" : "sent", providerMessageId: `wamid.${id}`, sentAt: at, createdAt: at });
  }

  beforeEach(async () => {
    sent = [];
    await db.execute(d.sql`truncate follow_ups, change_history, ai_agent_notices, ai_config, templates, messages, conversations, channels, contact_entradas, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org-editar", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "org-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Carlos", email: "carlos@editar.test" });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "x", seguimientosReal: true });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_editar", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana", phoneE164: "+525512345678" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: CH,
      providerConversationId: "zconv_editar",
      lastMessageAt: T0,
      lastInboundAt: new Date(T0.getTime() - 2 * MIN),
      windowExpiresAt: new Date(T0.getTime() - 2 * MIN + 24 * HOUR),
    });
    await msg("m_cliente", "in", new Date(T0.getTime() - 2 * MIN));
    await msg("m_agente", "out", T0);
    const rows: { name: string; body: string; status?: string; unsupported?: boolean }[] = [
      { name: "hola_buenas_tardes", body: "Hola, buenas tardes." },
      { name: "hola_buenos_dias", body: "Hola, buenos días." },
      { name: "seg_medidas", body: "Referente a la compuerta que nos comentó {{1}}. Tuvo oportunidad de medir la entrada?" },
      { name: "seg_info_duda", body: "Hola, le escribo de parte del equipo de Diluvium. Referente a la compuerta que nos comento {{1}}. Le quedo alguna duda?" },
      // Su {{1}} es el nombre: un seguimiento nunca la manda.
      { name: "promo_nombre", body: "Hola {{1}}, tenemos promoción." },
      { name: "seg_rechazada", body: "No la aprobó Meta.", status: "REJECTED" },
      { name: "con_boton", body: "Lleva un botón con dato.", unsupported: true },
    ];
    for (const t of rows) {
      await db.insert(s.templates).values({ id: `t_${t.name}`, organizationId: ORG, channelId: CH, name: t.name, language: "es_MX", body: t.body, status: t.status ?? "APPROVED", unsupported: t.unsupported ?? false });
    }
  });

  const ficha = (extra: Partial<FollowUpFicha> = {}): FollowUpFicha => ({
    caso: "faltan_medidas",
    pendiente: "Falta la medida del zaguán",
    siguientePaso: "Saber la medida",
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

  async function reading(now = new Date(T0.getTime() + 4 * MIN), upTo = T0) {
    return store.applyFollowUpReading({
      organizationId: ORG,
      conversationId: CONV,
      contactId: CONTACT,
      readUpTo: upTo,
      stopAt: upTo,
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
  const now = () => new Date(T0.getTime() + 10 * MIN);

  it("ventana abierta: el texto del vendedor sale TAL CUAL (sin saludo), queda marcado «editado» y el siguiente vuelve a ser del Agente IA", async () => {
    await reading();
    const r = await row();
    expect(r).toMatchObject({ door: "texto", intento: 1 });
    const texto = "Hola, ¿pudo medir el zaguán de lado a lado? Con esa medida le confirmo la compuerta.";
    expect(await editar.editFollowUpText(ORG, r.id, `  ${texto}  `, USER, now())).toEqual({ ok: true });
    expect(await row()).toMatchObject({ mensajeVendedor: texto, updatedByUserId: USER });
    const v = await view.loadFollowUpView(ORG, CONV);
    expect(v).toMatchObject({ mensajeVendedor: texto, plantillaVendedor: null });

    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect(sent).toEqual([{ kind: "text", text: texto }]);
    const after = await row();
    expect(after).toMatchObject({ intento: 2, mensajeVendedor: null, plantillaVendedor: null });
    expect(after.intentos[0]).toMatchObject({ n: 1, door: "texto", editado: true });
    expect((await view.loadFollowUpView(ORG, CONV))?.intentos[0]).toMatchObject({ editado: true });
  });

  it("ventana cerrada: lista de plantillas que se pueden mandar (la del Agente IA primero, ya llenas) y sale la que eligió el vendedor", async () => {
    await reading();
    await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    const r = await row();
    expect(r).toMatchObject({ intento: 2, door: "plantilla", templateName: "seg_medidas" });

    const options = await editar.followUpTemplateOptions(ORG, r.id);
    expect(options?.map((o) => o.name)).toEqual(["seg_medidas", "seg_info_duda", "hola_buenas_tardes", "hola_buenos_dias"]);
    expect(options?.[0]).toMatchObject({ delAgente: true, title: "Faltan medidas" });
    expect(options?.find((o) => o.name === "seg_info_duda")?.text).not.toContain("{{1}}");

    expect(await editar.chooseFollowUpTemplate(ORG, r.id, "seg_info_duda", USER, now())).toEqual({ ok: true });
    const v = await view.loadFollowUpView(ORG, CONV);
    expect(v).toMatchObject({ templateName: "seg_info_duda", plantillaVendedor: "seg_info_duda" });
    expect(v?.templateText).toContain("Le quedo alguna duda?");

    sent = [];
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN), { provider });
    expect(sent).toEqual([expect.objectContaining({ kind: "template", name: "seg_info_duda", params: [expect.any(String)] })]);
    const after = await row();
    expect(after).toMatchObject({ status: "esperando", plantillaVendedor: null });
    expect(after.intentos.at(-1)).toMatchObject({ door: "plantilla", template: "seg_info_duda", editado: true });
  });

  it("no acepta lo que no se puede mandar: plantilla con nombre, rechazada, con datos en botón; texto vacío o muy largo; otra organización", async () => {
    await reading();
    const r = await row();
    for (const name of ["promo_nombre", "seg_rechazada", "con_boton", "no_existe"]) {
      expect(await editar.chooseFollowUpTemplate(ORG, r.id, name, USER, now())).toMatchObject({ ok: false });
    }
    expect(await editar.editFollowUpText(ORG, r.id, "   ", USER, now())).toEqual({ ok: false, message: "Escribe el mensaje." });
    expect(await editar.editFollowUpText(ORG, r.id, "a".repeat(editar.MAX_FOLLOW_UP_TEXT + 1), USER, now())).toMatchObject({ ok: false });
    expect(await editar.editFollowUpText(OTRA, r.id, "Hola", USER, now())).toEqual({ ok: false, message: "Ese seguimiento ya no está programado." });
    expect(await editar.followUpTemplateOptions(OTRA, r.id)).toBeNull();
    expect(await row()).toMatchObject({ mensajeVendedor: null, plantillaVendedor: null });
  });

  it("«Volver al del Agente IA» borra lo editado; una lectura nueva del chat también lo descarta", async () => {
    await reading();
    const r = await row();
    await editar.editFollowUpText(ORG, r.id, "Texto del vendedor", USER, now());
    expect(await editar.editFollowUpText(ORG, r.id, null, USER, now())).toEqual({ ok: true });
    expect(await row()).toMatchObject({ mensajeVendedor: null });

    await editar.editFollowUpText(ORG, r.id, "Texto del vendedor", USER, now());
    await editar.chooseFollowUpTemplate(ORG, r.id, "seg_info_duda", USER, now());
    // Releer sin nada nuevo no cambia nada; con un mensaje nuevo (aquí, del Agente IA) la ficha se rehace.
    await reading(new Date(T0.getTime() + 12 * MIN));
    expect(await row()).toMatchObject({ mensajeVendedor: "Texto del vendedor", plantillaVendedor: "seg_info_duda" });
    const nuevo = new Date(T0.getTime() + 15 * MIN);
    await msg("m_agente_2", "out", nuevo);
    await reading(new Date(T0.getTime() + 20 * MIN), nuevo);
    expect(await row()).toMatchObject({ id: r.id, mensajeVendedor: null, plantillaVendedor: null });
  });

  it("texto editado y la ventana se cierra antes de salir: sale la plantilla del Agente IA (el texto no se puede mandar)", async () => {
    await reading();
    const r = await row();
    await editar.editFollowUpText(ORG, r.id, "Texto del vendedor", USER, now());
    await db.update(s.conversations).set({ windowExpiresAt: new Date(r.dueAt!.getTime() - HOUR) }).where(d.eq(s.conversations.id, CONV));
    // La plantilla no sale después de las 19:00 del cliente: se recorre y sale a su nueva hora.
    for (let i = 0; i < 3 && sent.length === 0; i++) await store.followUpSweepOnce(new Date((await row()).dueAt!.getTime() + MIN), { provider });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "template" });
    expect((await row()).intentos[0].editado).toBeUndefined();
  });
});
