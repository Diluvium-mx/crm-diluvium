// Tabla editable de los seguimientos (Agente IA › Seguimientos, Parte 4) contra Postgres REAL: guardar deja
// una fila en el Historial; un caso apagado no se programa (y lo programado se cancela al llegar su hora);
// un intento apagado se salta; la hora editada manda; «Cambiar hora» avisa en lugar de mover la hora.
// Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpFicha } from "./ficha";
import type { FollowUpTable } from "./tabla";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Tabla de seguimientos en la base", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./store");
  let view: typeof import("./view");
  let tabla: typeof import("./tabla");
  let tablaStore: typeof import("./tabla-store");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");

  const ORG = "org_tab";
  const CONTACT = "contact_tab";
  const CONV = "conv_tab";
  const CH = "ch_tab";
  const USER = "user_tab";
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
    tabla = await import("./tabla");
    tablaStore = await import("./tabla-store");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    tablaStore.clearFollowUpTableCache();
    await db.execute(d.sql`truncate follow_ups, change_history, templates, messages, conversations, channels, contact_entradas, contacts, organization, "user" cascade`);
    await db.insert(s.user).values({ id: USER, name: "Daniel", email: "daniel@tab.test" });
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-tab", createdAt: new Date() });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_tab", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana", phoneE164: "+525512345678" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: CH,
      providerConversationId: "zconv_tab",
      lastMessageAt: T0,
      // El cliente escribió a las 11:58: la ventana cierra mañana a las 11:58.
      windowExpiresAt: new Date(T0.getTime() - 2 * MIN + 24 * HOUR),
    });
  });

  const ficha = (caso: FollowUpFicha["caso"]): FollowUpFicha => ({
    caso,
    pendiente: "Se le pidió el ancho de la cochera",
    siguientePaso: "Pedir el ancho de lado a lado",
    valeLaPena: true,
    motivo: null,
    fechaPedida: null,
    horaPedida: null,
    borrador: "¿Me puede medir el ancho de la cochera?",
    casoDeFondo: null,
    plantilla2: null,
    plantilla3: null,
  });

  async function reading(caso: FollowUpFicha["caso"] = "faltan_medidas", over: Partial<import("./store").FollowUpReading> = {}) {
    return store.applyFollowUpReading({
      organizationId: ORG,
      conversationId: CONV,
      contactId: CONTACT,
      readUpTo: T0,
      stopAt: T0,
      lastIsCompany: true,
      ficha: ficha(caso),
      stages: await stagesMod.listFunnelStages(ORG),
      stageKey: "inbox",
      monto: null,
      pago: null,
      now: NOW,
      ...over,
    });
  }
  const rows = () => db.select().from(s.followUps).orderBy(s.followUps.createdAt, s.followUps.id);

  type CasePatch = Partial<FollowUpTable["casos"]["faltan_medidas"]>;
  async function saveCase(caso: keyof FollowUpTable["casos"], patch: CasePatch) {
    const current = await tablaStore.loadFollowUpTableFresh(ORG);
    const next: FollowUpTable = { ...current, casos: { ...current.casos, [caso]: { ...current.casos[caso], ...patch } } };
    return tablaStore.saveFollowUpTable(ORG, USER, next);
  }

  it("guardar: solo si cambió algo, una fila en el Historial con «Ver cambios»; volver a fábrica deja las columnas en null", async () => {
    const first = await saveCase("faltan_medidas", { intentos: [true, true, true], from: "19:30", to: "21:00" });
    expect(first.changes.map((c) => c.title)).toEqual(["Faltan medidas · 3.er intento", "Faltan medidas · hora"]);
    const [cfg] = await db.select({ casos: s.aiConfig.seguimientosCasos, vendedores: s.aiConfig.seguimientosVendedores }).from(s.aiConfig).where(d.eq(s.aiConfig.organizationId, ORG));
    expect(cfg.casos).not.toBeNull();
    expect(cfg.vendedores).toBeNull();
    const history = await db.select().from(s.changeHistory).where(d.eq(s.changeHistory.organizationId, ORG));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "seguimientos", action: "editar", userId: USER, oldValue: null, newValue: null });
    expect(history[0].detail).toEqual({ type: "lineas", lines: first.changes });
    expect((await tablaStore.loadLastTableChange(ORG))?.author).toBe("Daniel");

    // Mismo contenido: nada que guardar.
    expect((await saveCase("faltan_medidas", { intentos: [true, true, true] })).changes).toEqual([]);
    expect(await db.select().from(s.changeHistory)).toHaveLength(1);

    // De vuelta a fábrica: null en las columnas (un cambio futuro de la fábrica sí llega).
    await tablaStore.saveFollowUpTable(ORG, USER, tabla.FACTORY_TABLE);
    const [back] = await db.select({ casos: s.aiConfig.seguimientosCasos }).from(s.aiConfig).where(d.eq(s.aiConfig.organizationId, ORG));
    expect(back.casos).toBeNull();
    expect(await tablaStore.loadFollowUpTable(ORG)).toEqual(tabla.FACTORY_TABLE);
  });

  it("caso apagado: el lector lo reconoce pero no se programa; si ya estaba programado, se cancela al llegar su hora", async () => {
    await reading();
    expect((await rows())[0]).toMatchObject({ status: "programado", caso: "faltan_medidas", intento: 1 });

    await saveCase("faltan_medidas", { on: false });
    // Lo ya programado conserva su hora: al llegar, se cancela.
    await store.followUpSweepOnce(new Date((await rows())[0].dueAt!.getTime() + MIN));
    expect((await rows())[0]).toMatchObject({ status: "cancelado", cancelReason: "caso_apagado", intentos: [] });

    // Una lectura nueva del mismo caso: no programa nada.
    const summary = await reading("faltan_medidas", { readUpTo: new Date(T0.getTime() + 10 * MIN), stopAt: new Date(T0.getTime() + 10 * MIN) });
    expect(summary).toMatch(/faltan_medidas apagado en Agente IA › Seguimientos/);
    expect((await rows()).filter((r) => r.status === "programado")).toHaveLength(0);
  });

  it("1.er intento apagado: el primero que sale es el 2.º (día 2, ya con la ventana cerrada)", async () => {
    await saveCase("faltan_medidas", { intentos: [false, true, false] });
    await reading();
    const [r] = await rows();
    expect(r).toMatchObject({ status: "programado", intento: 2, totalIntentos: 2, door: "plantilla" });
    // Día 2 desde la parada (miércoles 7), la plantilla de un caso de noche a las 18:00 del centro.
    expect(r.dueAt?.toISOString()).toBe(new Date("2026-10-07T18:00:00-06:00").toISOString());
  });

  it("intento apagado después de programado: al llegar su hora pasa al siguiente prendido sin mandar nada", async () => {
    await reading("cotizacion_sin_respuesta");
    expect((await rows())[0]).toMatchObject({ intento: 1, totalIntentos: 3 });
    await saveCase("cotizacion_sin_respuesta", { intentos: [false, false, true] });
    await store.followUpSweepOnce(new Date((await rows())[0].dueAt!.getTime() + MIN));
    const [r] = await rows();
    expect(r).toMatchObject({ status: "programado", intento: 3, intentos: [] });
    // 7 días después de la parada (no salió ninguno antes), a la hora del caso.
    expect(r.dueAt?.toISOString()).toBe(new Date("2026-10-12T18:00:00-06:00").toISOString());
  });

  it("después de un intento, el siguiente salta los apagados", async () => {
    await saveCase("cotizacion_sin_respuesta", { intentos: [true, false, true] });
    await reading("cotizacion_sin_respuesta");
    await store.followUpSweepOnce(new Date((await rows())[0].dueAt!.getTime() + MIN));
    const [r] = await rows();
    expect(r).toMatchObject({ status: "programado", intento: 3, totalIntentos: 3 });
    expect(r.intentos).toHaveLength(1);
  });

  it("la hora editada manda: medidas de 20:30 a 21:00 → sale a las 20:30 del centro", async () => {
    await saveCase("faltan_medidas", { from: "20:30", to: "21:00" });
    await reading();
    expect((await rows())[0].dueAt?.toISOString()).toBe(new Date("2026-10-05T20:30:00-06:00").toISOString());
  });

  it("Cambiar hora: si para el cliente no se puede, avisa con el rango en hora de Mazatlán y no la guarda", async () => {
    await reading();
    const v = await view.loadFollowUpView(ORG, CONV);
    expect(v?.objetivo).toBe(tabla.FACTORY_TABLE.casos.faltan_medidas.busca);
    const before = (await rows())[0];
    // 22:00 del centro con la ventana abierta: texto, pero fuera de 7:00–21:00.
    const late = await view.changeFollowUpTime(ORG, v!.id, new Date("2026-10-05T22:00:00-06:00"), USER, NOW);
    expect(late).toEqual({ ok: false, message: "Para el cliente serían las 22:00 (su hora). Los seguimientos salen de 7:00 a 21:00 de su hora: elige entre las 6:00 y las 20:00 de Mazatlán." });
    // Miércoles 21:30 del centro: la ventana ya cerró → plantilla, también de 7:00 a 21:00 (10-oct-2026).
    const tpl = await view.changeFollowUpTime(ORG, v!.id, new Date("2026-10-07T21:30:00-06:00"), USER, NOW);
    expect(tpl).toEqual({ ok: false, message: "Para el cliente serían las 21:30 (su hora). Los seguimientos salen de 7:00 a 21:00 de su hora: elige entre las 6:00 y las 20:00 de Mazatlán." });
    expect((await rows())[0]).toMatchObject({ dueAt: before.dueAt, dueSetBy: "sistema" });
    // Miércoles 20:59 del centro con plantilla (el caso del 10-oct-2026): se guarda.
    expect(await view.changeFollowUpTime(ORG, v!.id, new Date("2026-10-07T20:59:00-06:00"), USER, NOW)).toEqual({ ok: true });
    expect((await rows())[0]).toMatchObject({ door: "plantilla", dueSetBy: "vendedor" });
    // Una hora que sí se puede: se guarda tal cual.
    expect(await view.changeFollowUpTime(ORG, v!.id, new Date("2026-10-05T20:45:00-06:00"), USER, NOW)).toEqual({ ok: true });
    expect((await rows())[0]).toMatchObject({ dueSetBy: "vendedor" });
  });
});
