// Tests de integración del Dashboard (A2) contra Postgres REAL: días locales de
// Mazatlán, exclusión de ghl_import/seed, desgloses, anuncio y comparación
// contra el periodo anterior. Solo corren con TEST_DATABASE_URL apuntando a una
// base DESECHABLE con las migraciones aplicadas; borran sus datos al empezar.
// Nunca apuntarlos a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("dashboard: conversaciones nuevas (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  type Schema = typeof import("@/lib/db/schema");
  let db: Db;
  let s: Schema;
  let q: typeof import("./queries");
  const ORG_A = "org_dash_a";
  const ORG_B = "org_dash_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    q = await import("./queries");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "dash-a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "dash-b", createdAt: new Date() },
    ]);
    for (const [id, org] of [["ch_dash_a", ORG_A], ["ch_dash_b", ORG_B]] as const) {
      await db.insert(s.channels).values({
        id,
        organizationId: org,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: `zacc_${id}`,
        displayName: "Diluvium",
      });
    }
    await db.insert(s.channels).values({
      id: "ch_dash_a_test",
      organizationId: ORG_A,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_ch_dash_a_test",
      displayName: "Diluvium prueba",
      isTest: true,
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  async function contact(opts: {
    createdAtUtc: string;
    org?: string;
    source?: string | null;
    sourceChannel?: string | null;
    stage?: "inbox" | "prospecto" | "interesado" | "cerca_compra" | "compra";
    adReferral?: boolean;
    /** Default true: el contacto escribió (conversación + mensaje entrante). */
    wrote?: boolean;
    channelId?: string;
    esPrueba?: boolean;
    importedAt?: Date | null;
  }) {
    seq++;
    const id = `c_dash_${seq}`;
    const org = opts.org ?? ORG_A;
    await db.insert(s.contacts).values({
      id,
      organizationId: org,
      firstName: `Cliente ${seq}`,
      source: opts.source === undefined ? "whatsapp" : opts.source,
      sourceChannel: opts.sourceChannel === undefined ? "whatsapp" : opts.sourceChannel,
      stage: opts.stage ?? "inbox",
      esPrueba: opts.esPrueba ?? false,
      createdAt: new Date(opts.createdAtUtc),
    });
    await db.insert(s.conversations).values({
      id: `conv_dash_${seq}`,
      organizationId: org,
      contactId: id,
      channelId: opts.channelId ?? (org === ORG_A ? "ch_dash_a" : "ch_dash_b"),
      adReferral: opts.adReferral ? { headline: "Compuertas" } : null,
    });
    await db.insert(s.messages).values({
      id: `m_dash_${seq}`,
      organizationId: org,
      conversationId: `conv_dash_${seq}`,
      direction: opts.wrote === false ? "out" : "in",
      source: opts.wrote === false ? "business_app" : "contact",
      type: "text",
      body: "hola",
      status: opts.wrote === false ? "sent" : "received",
      sentAt: new Date(opts.createdAtUtc),
      importedAt: opts.importedAt ?? null,
    });
    return id;
  }

  it("agrupa por día LOCAL de Mazatlán (UTC-7) y rellena días vacíos con 0", async () => {
    // 2026-09-02 05:00 UTC = 2026-09-01 22:00 local → cuenta el día 1.
    await contact({ createdAtUtc: "2026-09-02T05:00:00Z" });
    // 2026-09-02 08:00 UTC = 2026-09-02 01:00 local → día 2.
    await contact({ createdAtUtc: "2026-09-02T08:00:00Z" });
    await contact({ createdAtUtc: "2026-09-02T20:00:00Z" });

    const series = await q.newConversationsByDay(db, ORG_A, { desde: "2026-09-01", hasta: "2026-09-03" });
    expect(series).toEqual([
      { dia: "2026-09-01", total: 1 },
      { dia: "2026-09-02", total: 2 },
      { dia: "2026-09-03", total: 0 },
    ]);
  });

  it("los bordes del rango son medianoche local, no UTC", async () => {
    // 2026-09-01 06:59 UTC = 2026-08-31 23:59 local → fuera.
    await contact({ createdAtUtc: "2026-09-01T06:59:00Z" });
    // 2026-09-01 07:00 UTC = 2026-09-01 00:00 local → dentro.
    await contact({ createdAtUtc: "2026-09-01T07:00:00Z" });
    // 2026-09-02 06:59 UTC = 2026-09-01 23:59 local → dentro.
    await contact({ createdAtUtc: "2026-09-02T06:59:00Z" });
    // 2026-09-02 07:00 UTC = 2026-09-02 00:00 local → fuera.
    await contact({ createdAtUtc: "2026-09-02T07:00:00Z" });

    const breakdown = await q.newConversationsBreakdown(db, ORG_A, { desde: "2026-09-01", hasta: "2026-09-01" });
    expect(breakdown.total).toBe(2);
  });

  it("excluye ghl_import y seed, pero cuenta source null y otros orígenes; aísla por organización", async () => {
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", source: "ghl_import" });
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", source: "seed" });
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", source: null });
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", source: "whatsapp" });
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", org: ORG_B });
    // Solo con salientes (el vendedor escribió primero y el cliente no contestó): no cuenta.
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", wrote: false });

    const breakdown = await q.newConversationsBreakdown(db, ORG_A, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(breakdown.total).toBe(2);
  });

  it("desglosa por canal, etapa y anuncio", async () => {
    await contact({ createdAtUtc: "2026-09-10T18:00:00Z", sourceChannel: "whatsapp", stage: "inbox", adReferral: true });
    await contact({ createdAtUtc: "2026-09-11T18:00:00Z", sourceChannel: "whatsapp", stage: "prospecto", adReferral: false });
    await contact({ createdAtUtc: "2026-09-12T18:00:00Z", sourceChannel: "fb", stage: "prospecto", adReferral: true });
    await contact({ createdAtUtc: "2026-09-12T18:00:00Z", sourceChannel: null, stage: "compra" });

    const breakdown = await q.newConversationsBreakdown(db, ORG_A, { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(breakdown).toEqual({
      total: 4,
      porCanal: [
        { clave: "whatsapp", total: 2 },
        { clave: "fb", total: 1 },
        { clave: "otro", total: 1 },
      ],
      porEtapa: [
        { clave: "compra", total: 1 },
        { clave: "inbox", total: 1 },
        { clave: "prospecto", total: 2 },
      ],
      porAnuncio: 2,
    });
  });

  it("tarjetas: hoy/semana/mes contra el mismo tramo del periodo anterior", async () => {
    // "Ahora" = martes 2026-09-22 11:00 local (18:00 UTC). Semana desde el lunes 21.
    const now = new Date("2026-09-22T18:00:00Z");
    await contact({ createdAtUtc: "2026-09-22T16:00:00Z" }); // hoy 09:00 → hoy, semana, mes
    await contact({ createdAtUtc: "2026-09-22T19:00:00Z" }); // hoy 12:00 → aún no pasa: no cuenta
    await contact({ createdAtUtc: "2026-09-21T17:00:00Z" }); // ayer 10:00 → ayer a esta hora, semana, mes
    await contact({ createdAtUtc: "2026-09-21T20:00:00Z" }); // ayer 13:00 → semana y mes, NO "ayer a esta hora"
    await contact({ createdAtUtc: "2026-09-15T17:00:00Z" }); // martes pasado 10:00 → semana anterior y mes
    await contact({ createdAtUtc: "2026-08-20T17:00:00Z" }); // 20-ago → mes anterior a la misma fecha
    await contact({ createdAtUtc: "2026-08-25T17:00:00Z" }); // 25-ago → mes anterior pero DESPUÉS del día 22
    await contact({ createdAtUtc: "2026-09-22T16:00:00Z", source: "ghl_import" }); // excluido

    const cards = await q.newConversationsCards(db, ORG_A, now);
    expect(cards).toEqual({
      hoy: { actual: 1, anterior: 1 },
      semana: { actual: 3, anterior: 1 },
      mes: { actual: 4, anterior: 1 },
    });
  });

  it("excluye canal de prueba, es_prueba, historial importado y source historial_celular en las tres métricas", async () => {
    const createdAtUtc = "2026-09-22T16:00:00Z"; // 09:00 local, dentro de hoy.
    await contact({ createdAtUtc, channelId: "ch_dash_a_test" });
    await contact({ createdAtUtc, esPrueba: true });
    await contact({ createdAtUtc, importedAt: new Date("2026-09-22T16:01:00Z") });
    await contact({ createdAtUtc, source: "historial_celular" });
    await contact({ createdAtUtc }); // control: contacto normal que sí cuenta.

    const range = { desde: "2026-09-22", hasta: "2026-09-22" };
    expect(await q.newConversationsByDay(db, ORG_A, range)).toEqual([{ dia: "2026-09-22", total: 1 }]);
    expect(await q.newConversationsBreakdown(db, ORG_A, range)).toMatchObject({ total: 1 });
    expect(await q.newConversationsCards(db, ORG_A, new Date("2026-09-22T18:00:00Z"))).toEqual({
      hoy: { actual: 1, anterior: 0 },
      semana: { actual: 1, anterior: 0 },
      mes: { actual: 1, anterior: 0 },
    });
  });
});
