// Seguimientos en MODO ENSAYO contra Postgres REAL (docs/seguimientos.md, Parte 1): la ficha que
// deja el lector se guarda con su hora; una lectura nueva la reemplaza; si el cliente escribe se
// cierra; con la pausa puesta a mano queda como sugerencia; el barrido anota cuándo "habría
// salido" cada intento (sin mandar nada) y la burbuja muestra y cambia el seguimiento.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpFicha } from "./ficha";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Seguimientos en la base (modo ensayo)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./store");
  let view: typeof import("./view");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");

  const ORG = "org_seg";
  const CONTACT = "contact_seg";
  const CONV = "conv_seg";
  const CH = "ch_seg";
  const USER = "user_seg";
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // Lunes 5-oct-2026, 12:00 en la Ciudad de México (UTC-6): nuestra respuesta, sin contestar.
  const T0 = new Date("2026-10-05T12:00:00-06:00");
  const NOW = new Date(T0.getTime() + 4 * MIN);

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./store");
    view = await import("./view");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate follow_ups, change_history, templates, messages, conversations, channels, contact_entradas, contacts, organization, "user" cascade`);
    await db.insert(s.user).values({ id: USER, name: "Vendedor", email: "vendedor@seg.test" });
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-seg", createdAt: new Date() });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_seg", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana Lucía", phoneE164: "+525512345678" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: CH,
      providerConversationId: "zconv_seg",
      lastMessageAt: T0,
      // El cliente escribió a las 11:58: la ventana cierra mañana a las 11:58.
      windowExpiresAt: new Date(T0.getTime() - 2 * MIN + 24 * HOUR),
    });
  });

  const ficha = (caso: FollowUpFicha["caso"], extra: Partial<FollowUpFicha> = {}): FollowUpFicha => ({
    caso,
    pendiente: "Se le pidió el ancho de la cochera",
    siguientePaso: "Pedir el ancho de lado a lado",
    valeLaPena: true,
    motivo: null,
    fechaPedida: null,
    horaPedida: null,
    borrador: "Cuando esté en su casa, ¿me puede medir el ancho de la cochera?",
    ...extra,
  });

  async function reading(over: Partial<import("./store").FollowUpReading> = {}) {
    return store.applyFollowUpReading({
      organizationId: ORG,
      conversationId: CONV,
      contactId: CONTACT,
      readUpTo: T0,
      stopAt: T0,
      lastIsCompany: true,
      ficha: ficha("faltan_medidas"),
      stages: await stagesMod.listFunnelStages(ORG),
      stageKey: "inbox",
      monto: null,
      pago: null,
      now: NOW,
      ...over,
    });
  }
  const rows = () => db.select().from(s.followUps).orderBy(s.followUps.createdAt, s.followUps.id);
  const open = async () => (await rows()).filter((r) => r.status === "programado" || r.status === "esperando");

  it("guarda la ficha con la hora del caso en la zona del cliente; la misma lectura no la duplica", async () => {
    const summary = await reading();
    expect(summary).toMatch(/seguimiento: faltan_medidas 1\.º .* texto/);
    const [r] = await rows();
    expect(r).toMatchObject({
      status: "programado",
      ensayo: true,
      caso: "faltan_medidas",
      intento: 1,
      totalIntentos: 2,
      door: "texto",
      templateName: null,
      modo: "automatico",
      timeZone: "America/Mexico_City",
      borrador: "Cuando esté en su casa, ¿me puede medir el ancho de la cochera?",
    });
    // 20:00 en la Ciudad de México = 02:00 UTC del día siguiente.
    expect(r.dueAt?.toISOString()).toBe("2026-10-06T02:00:00.000Z");
    expect(await reading()).toBeNull();
    expect(await rows()).toHaveLength(1);
  });

  it("una lectura nueva reemplaza la ficha (en su lugar si no ha salido nada; si ya salió un intento, queda cerrada con su historial); si el último mensaje es del cliente, se cancela", async () => {
    await reading();
    const id = (await rows())[0].id;
    await reading({ readUpTo: new Date(T0.getTime() + 10 * MIN), stopAt: new Date(T0.getTime() + 10 * MIN), ficha: ficha("cotizacion_sin_respuesta"), now: new Date(NOW.getTime() + 10 * MIN) });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ id, status: "programado", caso: "cotizacion_sin_respuesta", totalIntentos: 3, basedOnMessageAt: new Date(T0.getTime() + 10 * MIN) });

    // Ya salió (en ensayo) el 1.er intento: la ficha nueva va en otra fila y la vieja se cierra.
    await store.followUpSweepOnce(new Date((await rows())[0].dueAt!.getTime() + MIN));
    await db.update(s.conversations).set({ lastMessageAt: new Date(T0.getTime() + 2 * 24 * 60 * MIN) }).where(d.eq(s.conversations.id, CONV));
    await reading({ readUpTo: new Date(T0.getTime() + 2 * 24 * 60 * MIN), stopAt: new Date(T0.getTime() + 2 * 24 * 60 * MIN), ficha: ficha("pago_pendiente"), now: new Date(T0.getTime() + 2 * 24 * 60 * MIN + MIN) });
    const [viejo, nuevo] = await rows();
    expect(viejo).toMatchObject({ id, status: "cancelado", cancelReason: "reemplazado" });
    expect(viejo.intentos).toHaveLength(1);
    expect(nuevo).toMatchObject({ status: "programado", caso: "pago_pendiente", intento: 1 });
    expect(await reading({ readUpTo: new Date(T0.getTime() + 20 * MIN), lastIsCompany: false })).toMatch(/cancelado \(el cliente escribió\)/);
    expect(await open()).toHaveLength(0);
  });

  it("no seguir: queda anotado sin hora", async () => {
    await reading({ ficha: ficha("no_seguir", { valeLaPena: false, motivo: "Ya lo compró en otro lado", borrador: null }) });
    const [r] = await rows();
    expect(r).toMatchObject({ status: "no_seguir", dueAt: null, motivo: "Ya lo compró en otro lado" });
  });

  it("canal sin Agente IA o que no es WhatsApp: no hay seguimiento", async () => {
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(d.eq(s.channels.id, CH));
    expect(await reading()).toMatch(/seguimiento: no/);
    expect(await rows()).toHaveLength(0);
  });

  it("\"Pausar agente\" puesto a mano: sugerencia, con la hora en que se le presenta al vendedor; la pausa automática no", async () => {
    await db.update(s.conversations).set({ agentState: "pausado_humano", agentStateChangedAt: new Date(T0.getTime() - HOUR) }).where(d.eq(s.conversations.id, CONV));
    await db.insert(s.changeHistory).values({ id: "ch1", organizationId: ORG, userId: USER, kind: "pausas", action: "pausar", subjectId: CONV, createdAt: new Date(T0.getTime() - HOUR) });
    await reading();
    const [r] = await rows();
    expect(r.modo).toBe("sugerido");
    // Sale a las 20:00 del centro (19:00 en Mazatlán, ya fuera del turno): se presenta a las 17:00 de Mazatlán.
    expect(r.presentarAt?.toISOString()).toBe("2026-10-06T00:00:00.000Z");

    // Un vendedor contestó después: pausa automática (la hora del cambio va en la conversación).
    await db.update(s.conversations).set({ agentStateChangedAt: new Date(T0.getTime() - MIN) }).where(d.eq(s.conversations.id, CONV));
    await db.insert(s.changeHistory).values({ id: "ch2", organizationId: ORG, userId: null, kind: "pausas", action: "pausa_auto", subjectId: CONV, createdAt: new Date(T0.getTime() - MIN) });
    await reading({ readUpTo: new Date(T0.getTime() + MIN), stopAt: new Date(T0.getTime() + MIN) });
    expect((await open())[0].modo).toBe("automatico");
  });

  it("barrido del ensayo: anota cada intento sin mandar nada, programa el siguiente y termina en frío", async () => {
    await reading();
    const due1 = (await rows())[0].dueAt!;
    expect(await store.followUpSweepOnce(new Date(due1.getTime() - MIN))).toBe(0);
    expect(await store.followUpSweepOnce(new Date(due1.getTime() + MIN))).toBe(1);
    let [r] = await rows();
    expect(r).toMatchObject({ status: "programado", intento: 2, door: "plantilla", templateName: "hola_buenas_tardes" });
    expect(r.intentos).toEqual([expect.objectContaining({ n: 1, door: "texto", template: null, modo: "automatico", ensayo: true })]);
    // Día 2 (miércoles 7) a las 18:00 del centro.
    expect(r.dueAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");

    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN));
    [r] = await rows();
    expect(r).toMatchObject({ status: "esperando", intento: 2, door: null });
    expect(r.intentos.map((a) => a.door)).toEqual(["texto", "plantilla"]);
    await store.followUpSweepOnce(new Date(r.dueAt!.getTime() + MIN));
    [r] = await rows();
    expect(r.status).toBe("terminado");
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });

  it("mensaje nuevo que el lector no ha leído: espera; si pasan 30 min sin leerlo, se cancela", async () => {
    await reading();
    const due = (await rows())[0].dueAt!;
    await db.update(s.conversations).set({ lastMessageAt: new Date(due.getTime() - 10 * MIN) }).where(d.eq(s.conversations.id, CONV));
    expect(await store.followUpSweepOnce(new Date(due.getTime() + MIN))).toBe(0);
    expect((await rows())[0]).toMatchObject({ status: "programado", intento: 1 });
    await store.followUpSweepOnce(new Date(due.getTime() + 25 * MIN));
    expect((await rows())[0]).toMatchObject({ status: "cancelado", cancelReason: "nuevo_mensaje" });
  });

  it("si ya compró cuando llega la hora, se cancela", async () => {
    await reading();
    const due = (await rows())[0].dueAt!;
    await db.update(s.contacts).set({ stage: "compra" }).where(d.eq(s.contacts.id, CONTACT));
    await store.followUpSweepOnce(new Date(due.getTime() + MIN));
    expect((await rows())[0]).toMatchObject({ status: "cancelado", cancelReason: "venta_cerrada" });
  });

  it("la burbuja: muestra la plantilla con el nombre, cambia la hora, 'Que salga solo' solo en sugerencias y Cancelar", async () => {
    await db.insert(s.templates).values({ id: "tpl1", organizationId: ORG, channelId: CH, name: "hola_buenas_tardes", language: "es_MX", body: "Hola {{1}}, buenas tardes.", status: "APPROVED" });
    await reading();
    await store.followUpSweepOnce(new Date((await rows())[0].dueAt!.getTime() + MIN));
    const v = await view.loadFollowUpView(ORG, CONV);
    expect(v).toMatchObject({ caso: "faltan_medidas", casoLabel: "Faltan medidas", intento: 2, total: 2, door: "plantilla", templateText: "Hola Ana, buenas tardes.", firstName: "Ana", phoneE164: "+525512345678", ensayo: true });
    expect(await view.loadFollowUpView("otra_org", CONV)).toBeNull();

    const nueva = new Date("2026-10-07T16:30:00Z");
    expect(await view.changeFollowUpTime(ORG, v!.id, nueva, USER, NOW)).toBe(true);
    expect((await rows())[0]).toMatchObject({ dueSetBy: "vendedor", updatedByUserId: USER });
    expect((await rows())[0].dueAt?.toISOString()).toBe(nueva.toISOString());
    expect(await view.approveFollowUp(ORG, v!.id, USER, NOW)).toBe(false);
    expect(await view.cancelFollowUpById("otra_org", v!.id, USER, NOW)).toBe(false);
    expect(await view.cancelFollowUpById(ORG, v!.id, USER, NOW)).toBe(true);
    expect((await rows())[0]).toMatchObject({ status: "cancelado", cancelReason: "manual" });
    expect(await view.loadFollowUpView(ORG, CONV)).toBeNull();
  });
});
