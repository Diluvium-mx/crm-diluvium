// «Programar para las 22:00» contra Postgres REAL (9-oct-2026): lo programado no toca lo que usa
// el Agente IA hasta su hora; a las 22:00 se aplica junto (una versión de Goal y una de FAQs);
// un cambio guardado «Ahora» después no se pisa (conflicto). Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("Goal y FAQs programados para las 22:00 (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let editor: typeof import("./editor-store");
  let store: typeof import("./scheduled-store");
  const ORG = "org_prog";
  const OTRA = "org_prog_otra";
  // 9-oct-2026 a las 10:00 y a las 22:01 de Mazatlán (UTC−7).
  const MORNING = new Date("2026-10-09T10:00:00-07:00");
  const NIGHT = new Date("2026-10-09T22:01:00-07:00");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    editor = await import("./editor-store");
    store = await import("./scheduled-store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate ai_scheduled_changes, ai_knowledge_versions, ai_knowledge, ai_config, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "dil", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_owner", name: "Dueño", email: "d@x.mx" });
    await db.insert(s.aiConfig).values([
      { organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL ORIGINAL" },
      { organizationId: OTRA, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL OTRA" },
    ]);
    await db.insert(s.aiKnowledge).values([
      { id: "k1", organizationId: ORG, ghlId: "g1", question: "¿Precio?", answer: "$5,500", position: 1 },
      { id: "k2", organizationId: ORG, ghlId: "g2", question: "¿Dónde?", answer: "Los Mochis", position: 2 },
    ]);
  });

  const goal = async (org = ORG) => (await db.select().from(s.aiConfig).where(eq(s.aiConfig.organizationId, org)))[0]?.goal;
  const live = () => editor.liveFaqs(db, ORG);
  const versions = (kind: "goal" | "faqs") => editor.listVersions(ORG, kind);

  it("programar el Goal no cambia el que usa el Agente IA; queda para hoy a las 22:00", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL NUEVO", MORNING);
    expect(await goal()).toBe("GOAL ORIGINAL");
    const row = await store.loadScheduled(ORG);
    expect(row?.goal).toBe("GOAL NUEVO");
    expect(row?.baseGoal).toBe("GOAL ORIGINAL");
    expect(row?.applyAt.toISOString()).toBe(new Date("2026-10-09T22:00:00-07:00").toISOString());
    expect(row?.author).toBe("Dueño");
    // Antes de las 22:00 el barrido no hace nada.
    expect(await store.applyDueScheduled(MORNING)).toEqual([]);
    expect(await goal()).toBe("GOAL ORIGINAL");
  });

  it("a las 22:00 aplica Goal y FAQs JUNTOS: una versión de cada uno, con su nombre, y la fila se borra", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL NUEVO", MORNING);
    const list = (await live()).map((f) => (f.id === "k1" ? { ...f, answer: "$5,000" } : f));
    await store.scheduleFaqs(ORG, "u_owner", [...list, { id: "nueva", question: "¿Garantía?", answer: "1 año", enabled: true, position: 3 }], MORNING);
    expect((await live()).map((f) => f.answer)).toEqual(["$5,500", "Los Mochis"]);
    const done = await store.applyDueScheduled(NIGHT);
    expect(done).toEqual([{ organizationId: ORG, result: { kind: "aplicado" } }]);
    expect(await goal()).toBe("GOAL NUEVO");
    const after = await live();
    expect(after.map((f) => [f.question, f.answer])).toEqual([
      ["¿Precio?", "$5,000"],
      ["¿Dónde?", "Los Mochis"],
      ["¿Garantía?", "1 año"],
    ]);
    // Conserva el id y el ancla de GHL de las que ya existían.
    expect(after[0].id).toBe("k1");
    const [k1] = await db.select().from(s.aiKnowledge).where(eq(s.aiKnowledge.id, "k1"));
    expect(k1.ghlId).toBe("g1");
    expect((await versions("goal"))[0].name).toBe(store.VERSION_AT_22);
    const faqVersions = await versions("faqs");
    expect(faqVersions[0].name).toBe(store.VERSION_AT_22);
    // Antes no había versiones de FAQs: queda la de antes y UNA nueva (no una por cada cambio).
    expect(faqVersions).toHaveLength(2);
    expect(await store.loadScheduled(ORG)).toBeNull();
  });

  it("un cambio guardado «Ahora» después de programar no se pisa: queda en conflicto con el motivo", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL PROGRAMADO", MORNING);
    await editor.saveGoal(ORG, "u_owner", "GOAL URGENTE");
    const done = await store.applyDueScheduled(NIGHT);
    expect(done[0].result.kind).toBe("conflicto");
    expect(await goal()).toBe("GOAL URGENTE");
    const row = await store.loadScheduled(ORG);
    expect(row?.status).toBe("conflicto");
    expect(row?.conflict).toContain("el Goal");
    // En conflicto el barrido ya no lo intenta cada minuto…
    expect(await store.applyDueScheduled(NIGHT)).toEqual([]);
    // …y «Aplicar de todos modos» lo pisa a propósito.
    expect((await store.applyScheduled(ORG, { userId: "u_owner", force: true, versionName: store.VERSION_NOW })).kind).toBe("aplicado");
    expect(await goal()).toBe("GOAL PROGRAMADO");
    expect((await versions("goal"))[0].name).toBe(store.VERSION_NOW);
  });

  it("guardar «Ahora» el mismo texto programado lo quita de lo programado (no queda un aviso de algo que ya está)", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL NUEVO", MORNING);
    await editor.saveGoal(ORG, "u_owner", "GOAL NUEVO");
    await store.pruneScheduled(ORG);
    expect(await store.loadScheduled(ORG)).toBeNull();
  });

  it("programar algo igual a lo que está en vivo no deja nada programado", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL ORIGINAL", MORNING);
    await store.scheduleFaqs(ORG, "u_owner", await live(), MORNING);
    expect(await store.loadScheduled(ORG)).toBeNull();
    // Y regresar lo programado a como estaba lo quita.
    await store.scheduleGoal(ORG, "u_owner", "OTRO", MORNING);
    await store.scheduleGoal(ORG, "u_owner", "GOAL ORIGINAL", MORNING);
    expect(await store.loadScheduled(ORG)).toBeNull();
  });

  it("quitar una parte deja la otra; quitar todo borra la fila", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL NUEVO", MORNING);
    await store.scheduleFaqs(ORG, "u_owner", (await live()).slice(0, 1), MORNING);
    await store.cancelScheduled(ORG, "goal", "u_owner", MORNING);
    const row = await store.loadScheduled(ORG);
    expect(row?.goal).toBeNull();
    expect(row?.faqs).toHaveLength(1);
    await store.cancelScheduled(ORG, "todo", "u_owner", MORNING);
    expect(await store.loadScheduled(ORG)).toBeNull();
  });

  it("de noche (después de las 22:00) lo programado se aplica en el siguiente barrido", async () => {
    await store.scheduleGoal(ORG, "u_owner", "GOAL DE NOCHE", NIGHT);
    expect((await store.loadScheduled(ORG))?.applyAt.getTime()).toBe(NIGHT.getTime());
    expect((await store.applyDueScheduled(NIGHT))[0].result.kind).toBe("aplicado");
    expect(await goal()).toBe("GOAL DE NOCHE");
  });

  it("programar una versión anterior en vez de restaurarla al momento", async () => {
    await editor.saveGoal(ORG, "u_owner", "GOAL V2");
    // La más vieja es el Goal original (la guardó el primer guardado).
    const all = await versions("goal");
    await store.scheduleVersion(ORG, "u_owner", "goal", all[all.length - 1].id, MORNING);
    expect(await goal()).toBe("GOAL V2");
    expect((await store.loadScheduled(ORG))?.goal).toBe("GOAL ORIGINAL");
  });

  it("cada organización ve y aplica solo lo suyo", async () => {
    await store.scheduleGoal(OTRA, "u_owner", "GOAL OTRA NUEVO", MORNING);
    expect(await store.loadScheduled(ORG)).toBeNull();
    await store.applyDueScheduled(NIGHT);
    expect(await goal(OTRA)).toBe("GOAL OTRA NUEVO");
    expect(await goal()).toBe("GOAL ORIGINAL");
  });
});
