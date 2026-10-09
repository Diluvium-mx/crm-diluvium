// Historial de etapas contra Postgres REAL (TEST_DATABASE_URL): el Agente IA (moveStageForward)
// y borrar una etapa dejan su fila en la misma transacción, con los nombres de las etapas de ese
// momento y el nombre del vendedor que fija el trigger; un movimiento ignorado no deja fila; la
// lista filtra por etapa, quién lo movió, contacto (sin acentos ni mayúsculas, también por
// teléfono) y periodo; aislada por organización; y se borra con el contacto (ARCO).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock("@/lib/workflows/triggers", () => ({ onContactStageEntered: async () => undefined }));

describe.skipIf(!TEST_DATABASE_URL)("historial de etapas (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let fs: typeof import("./funnel-stages");
  let moveStageForward: typeof import("./stage").moveStageForward;
  let q: typeof import("./stage-history-queries");
  let resetHub: typeof import("@/lib/inbox/events").__resetInboxHubForTests;

  const ORG_A = "org_sh_a";
  const ORG_B = "org_sh_b";
  const USER = "u_sh_vendedor";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
  const all = { desde: today, hasta: today };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    fs = await import("./funnel-stages");
    ({ moveStageForward } = await import("./stage"));
    q = await import("./stage-history-queries");
    ({ __resetInboxHubForTests: resetHub } = await import("@/lib/inbox/events"));
  });

  beforeEach(async () => {
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.delete(s.user).where(d.eq(s.user.id, USER));
    await db.insert(s.user).values({ id: USER, name: "Laura", email: "sh-vendedor@example.test" });
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "sh-a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "sh-b", createdAt: new Date() },
    ]);
    await db.insert(s.contacts).values([
      { id: "sh_c1", organizationId: ORG_A, firstName: "José", lastName: "Peña", phoneE164: "+526681112233", stage: "prospecto" },
      { id: "sh_c2", organizationId: ORG_A, firstName: "Ana", stage: "prospecto" },
      { id: "sh_cb", organizationId: ORG_B, firstName: "B", stage: "prospecto" },
    ]);
  });

  afterAll(async () => {
    await resetHub();
    if (db) {
      await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
      await db.delete(s.user).where(d.eq(s.user.id, USER));
      await (db.$client as unknown as { end: () => Promise<void> }).end();
    }
  });

  const rowsOf = async (org: string) =>
    db.select().from(s.contactStageHistory).where(d.eq(s.contactStageHistory.organizationId, org)).orderBy(s.contactStageHistory.createdAt);

  it("el Agente IA deja su fila; un retroceso ignorado no deja nada", async () => {
    expect(await moveStageForward({ organizationId: ORG_A, contactId: "sh_c1", to: "interesado", by: "agente" })).toEqual({ from: "prospecto" });
    expect(await moveStageForward({ organizationId: ORG_A, contactId: "sh_c1", to: "prospecto", by: "agente" })).toBeNull();
    const rows = await rowsOf(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contactId: "sh_c1",
      fromStage: "prospecto",
      fromName: "Prospecto",
      toStage: "interesado",
      toName: "Interesado",
      changedBy: "agente",
      userId: null,
      authorName: null,
    });
  });

  it("/banco con vendedor: guarda quién fue y su nombre de ese momento", async () => {
    await moveStageForward({ organizationId: ORG_A, contactId: "sh_c2", to: "cerca_compra", by: "sistema", actorUserId: USER });
    await db.update(s.user).set({ name: "Laura Cambiada" }).where(d.eq(s.user.id, USER));
    const { rows } = await q.listStageHistory(ORG_A, all);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contactName: "Ana", fromName: "Prospecto", toName: "Cerca de compra", who: "Laura" });
  });

  it("borrar una etapa deja una fila por contacto con el nombre de la etapa borrada", async () => {
    const prospecto = (await fs.listFunnelStages(ORG_A)).find((x) => x.key === "prospecto")!;
    const interesado = (await fs.listFunnelStages(ORG_A)).find((x) => x.key === "interesado")!;
    const out = await fs.deleteFunnelStage(ORG_A, prospecto.id, interesado.id, USER);
    expect(out.moved).toBe(2);
    const rows = await rowsOf(ORG_A);
    expect(rows.map((r) => [r.contactId, r.fromName, r.toName, r.changedBy, r.authorName]).sort()).toEqual([
      ["sh_c1", "Prospecto", "Interesado", "sistema", "Laura"],
      ["sh_c2", "Prospecto", "Interesado", "sistema", "Laura"],
    ]);
    // La etapa ya no existe, pero el historial conserva su nombre.
    const { rows: listed } = await q.listStageHistory(ORG_A, all);
    expect(listed.every((r) => r.fromName === "Prospecto")).toBe(true);
  });

  it("filtros: etapa, quién, contacto sin acentos o por teléfono, y periodo", async () => {
    await moveStageForward({ organizationId: ORG_A, contactId: "sh_c1", to: "interesado", by: "agente" });
    await moveStageForward({ organizationId: ORG_A, contactId: "sh_c2", to: "cerca_compra", by: "sistema", actorUserId: USER });
    await moveStageForward({ organizationId: ORG_A, contactId: "sh_c1", to: "compra", by: "sistema" });

    const names = async (f: Partial<import("./stage-history-queries").StageHistoryFilters>) =>
      (await q.listStageHistory(ORG_A, { ...all, ...f })).rows.map((r) => `${r.contactName}:${r.toStage}`);

    expect(await names({})).toEqual(["José Peña:compra", "Ana:cerca_compra", "José Peña:interesado"]);
    expect(await names({ etapa: "interesado" })).toEqual(["José Peña:interesado"]);
    expect(await names({ quien: "agente" })).toEqual(["José Peña:interesado"]);
    expect(await names({ quien: "sistema" })).toEqual(["José Peña:compra"]);
    expect(await names({ quien: `u:${USER}` })).toEqual(["Ana:cerca_compra"]);
    expect(await names({ q: "jose pena" })).toEqual(["José Peña:compra", "José Peña:interesado"]);
    expect(await names({ q: "668 111" })).toEqual(["José Peña:compra", "José Peña:interesado"]);
    expect(await names({ desde: "2020-01-01", hasta: "2020-01-31" })).toEqual([]);
    expect((await q.listStageHistory(ORG_A, all)).rows.map((r) => r.who)).toEqual(["Automático", "Laura", "Agente IA"]);
  });

  it("aislado por organización y se borra con el contacto", async () => {
    await moveStageForward({ organizationId: ORG_B, contactId: "sh_cb", to: "interesado", by: "agente" });
    await moveStageForward({ organizationId: ORG_A, contactId: "sh_c1", to: "interesado", by: "agente" });
    expect((await q.listStageHistory(ORG_A, all)).rows.map((r) => r.contactId)).toEqual(["sh_c1"]);
    await db.delete(s.contacts).where(d.eq(s.contacts.id, "sh_c1"));
    expect(await rowsOf(ORG_A)).toHaveLength(0);
    expect(await rowsOf(ORG_B)).toHaveLength(1);
  });

  it("parseWho solo acepta agente, sistema o u:<id>", () => {
    expect(q.parseWho("agente")).toBe("agente");
    expect(q.parseWho("u:abc")).toBe("u:abc");
    expect(q.parseWho("u:")).toBeNull();
    expect(q.parseWho("cualquier")).toBeNull();
    expect(q.parseWho(undefined)).toBeNull();
  });
});
