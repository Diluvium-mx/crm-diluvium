// Editor del agente contra Postgres REAL: Goal y FAQs con versiones (y regresar a
// una anterior), perfil y modelo, siempre por organización. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("editor del agente (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let store: typeof import("./editor-store");
  const ORG = "org_ed";
  const OTRA = "org_ed_otra";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    store = await import("./editor-store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate ai_knowledge_versions, ai_knowledge, ai_config, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "dil", createdAt: new Date() },
      { id: OTRA, name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u_owner", name: "Dueño", email: "d@x.mx" });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL ORIGINAL" });
    await db.insert(s.aiKnowledge).values([
      { id: "k1", organizationId: ORG, ghlId: "g1", question: "¿Precio?", answer: "$5,500", position: 1 },
      { id: "k2", organizationId: ORG, ghlId: "g2", question: "¿Dónde?", answer: "Los Mochis", position: 2 },
    ]);
  });

  const goal = async (org = ORG) => (await db.select().from(s.aiConfig).where(eq(s.aiConfig.organizationId, org)))[0]?.goal;
  const faqs = async () => (await store.loadEditor(ORG)).faqs.map((f) => f.question);

  it("guardar el Goal deja versión; la primera vez guarda también el anterior, y se puede regresar", async () => {
    await store.saveGoal(ORG, "u_owner", "GOAL NUEVO");
    expect(await goal()).toBe("GOAL NUEVO");
    const versions = await store.listVersions(ORG, "goal");
    expect(versions).toHaveLength(2); // el nuevo (arriba) y el original
    expect(versions[0].author).toBe("Dueño");
    await store.restoreGoal(ORG, "u_owner", versions[1].id);
    expect(await goal()).toBe("GOAL ORIGINAL");
    expect(await store.listVersions(ORG, "goal")).toHaveLength(3); // restaurar también deja versión
    await store.saveGoal(ORG, "u_owner", "GOAL ORIGINAL"); // sin cambios: no hay versión nueva
    expect(await store.listVersions(ORG, "goal")).toHaveLength(3);
  });

  it("FAQs: agregar, editar, desactivar y borrar dejan versión; se puede regresar a la anterior (con el ancla de GHL)", async () => {
    await store.createFaq(ORG, "u_owner", { question: "¿Garantía?", answer: "5 años", enabled: true });
    expect(await faqs()).toEqual(["¿Precio?", "¿Dónde?", "¿Garantía?"]);
    const [k1] = (await store.loadEditor(ORG)).faqs;
    await store.updateFaq(ORG, "u_owner", k1.id, { question: "¿Cuánto cuesta?", answer: "$5,500 MXN", enabled: false });
    await store.deleteFaq(ORG, "u_owner", "k2");
    expect(await faqs()).toEqual(["¿Cuánto cuesta?", "¿Garantía?"]);
    const versions = await store.listVersions(ORG, "faqs");
    expect(versions.map((v) => v.summary)).toEqual(["2 preguntas", "3 preguntas", "3 preguntas", "2 preguntas"]);
    // Regresar a la foto ORIGINAL (antes del primer cambio).
    await store.restoreFaqs(ORG, "u_owner", versions[3].id);
    const restored = await db.select().from(s.aiKnowledge).where(eq(s.aiKnowledge.organizationId, ORG)).orderBy(s.aiKnowledge.position);
    expect(restored.map((f) => [f.question, f.answer, f.ghlId, f.enabled])).toEqual([
      ["¿Precio?", "$5,500", "g1", true],
      ["¿Dónde?", "Los Mochis", "g2", true],
    ]);
  });

  it("nada cruza organizaciones: otra org no edita, no borra ni restaura versiones ajenas", async () => {
    await store.saveGoal(ORG, "u_owner", "GOAL NUEVO");
    const [v] = await store.listVersions(ORG, "goal");
    await expect(store.restoreGoal(OTRA, "u_owner", v.id)).rejects.toBeInstanceOf(store.EditorNotFoundError);
    await expect(store.deleteFaq(OTRA, "u_owner", "k1")).rejects.toBeInstanceOf(store.EditorNotFoundError);
    await expect(store.updateFaq(OTRA, "u_owner", "k1", { question: "x", answer: "y", enabled: true })).rejects.toBeInstanceOf(store.EditorNotFoundError);
    expect(await faqs()).toEqual(["¿Precio?", "¿Dónde?"]);
    expect(await store.listVersions(OTRA, "goal")).toEqual([]);
  });

  it("perfil y modelo: nombre del agente, empresa y cerebro", async () => {
    await store.saveProfile(ORG, { agentName: "Sofía", companyName: "Diluvium MX" });
    await store.saveBrainModel(ORG, "claude-opus-5-5");
    expect(await store.loadEditor(ORG)).toMatchObject({ agentName: "Sofía", companyName: "Diluvium MX", modeloCerebro: "claude-opus-5-5" });
    // Una org sin fila de ai_config la obtiene con los defaults al editar.
    await store.saveProfile(OTRA, { agentName: "Ángela", companyName: "" });
    expect(await store.loadEditor(OTRA)).toMatchObject({ agentName: "Ángela", companyName: "", goal: "" });
  });
});
