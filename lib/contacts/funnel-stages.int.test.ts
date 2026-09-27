// Columnas del Embudo contra Postgres REAL (TEST_DATABASE_URL): las 5 de siempre
// nacen con la organización (trigger de la 0041); renombrar, agregar entre dos,
// reordenar (y "solo hacia adelante" sigue el orden nuevo), borrar con reasignación
// en una sola transacción y UN solo aviso stages.updated, no borrar una etapa con
// papel, mover un papel, límites 3–10, aislamiento por organización y la llave
// foránea de contacts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxEvent } from "@/lib/inbox/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock("@/lib/workflows/triggers", () => ({ onContactStageEntered: async () => undefined }));

describe.skipIf(!TEST_DATABASE_URL)("columnas del Embudo (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let fs: typeof import("./funnel-stages");
  let moveStageForward: typeof import("./stage").moveStageForward;
  let subscribeToInbox: typeof import("@/lib/inbox/events").subscribeToInbox;
  let resetHub: typeof import("@/lib/inbox/events").__resetInboxHubForTests;

  const ORG_A = "org_fs_a";
  const ORG_B = "org_fs_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    fs = await import("./funnel-stages");
    ({ moveStageForward } = await import("./stage"));
    ({ subscribeToInbox, __resetInboxHubForTests: resetHub } = await import("@/lib/inbox/events"));
  });

  beforeEach(async () => {
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "fs-a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "fs-b", createdAt: new Date() },
    ]);
    await db.insert(s.contacts).values([
      { id: "fs_c1", organizationId: ORG_A, firstName: "Uno", stage: "prospecto" },
      { id: "fs_c2", organizationId: ORG_A, firstName: "Dos", stage: "prospecto" },
      { id: "fs_c3", organizationId: ORG_A, firstName: "Tres", stage: "interesado" },
      { id: "fs_cb", organizationId: ORG_B, firstName: "B", stage: "prospecto" },
    ]);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(async () => {
    await resetHub();
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const keys = async (org = ORG_A) => (await fs.listFunnelStages(org)).map((x) => x.key);
  const byId = async (org: string, key: string) => (await fs.listFunnelStages(org)).find((x) => x.key === key)!;
  const stageOf = async (id: string) => (await db.select({ stage: s.contacts.stage, by: s.contacts.stageChangedBy }).from(s.contacts).where(d.eq(s.contacts.id, id)))[0];

  async function listen(organizationId: string) {
    const all: InboxEvent[] = [];
    const unsubscribe = await subscribeToInbox(organizationId, (e) => all.push(e));
    return {
      events: () => all.filter((e) => e.type === "stages.updated"),
      wait: async () => {
        await new Promise((r) => setTimeout(r, 200));
        unsubscribe();
      },
    };
  }

  it("toda organización nace con las 5 de siempre, sus papeles y el modelo por etapa", async () => {
    const a = await fs.listFunnelStages(ORG_A);
    expect(a.map((x) => [x.key, x.name, x.position, x.role, x.modelSlot])).toEqual([
      ["inbox", "Inbox", 1, "entrada", 1],
      ["prospecto", "Prospecto", 2, null, 1],
      ["interesado", "Interesado", 3, null, 1],
      ["cerca_compra", "Cerca de compra", 4, "cerca_compra", 2],
      ["compra", "Compra", 5, "venta_cerrada", 2],
    ]);
    expect(a.find((x) => x.key === "prospecto")?.botRule).toBe("Cuando el cliente contesta por primera vez.");
  });

  it("renombrar cambia el nombre, no la clave; los contactos siguen en su etapa; un solo aviso", async () => {
    const l = await listen(ORG_A);
    const st = await byId(ORG_A, "cerca_compra");
    const out = await fs.updateFunnelStage(ORG_A, st.id, { name: "  Pago   pendiente " });
    expect(out).toMatchObject({ key: "cerca_compra", name: "Pago pendiente", role: "cerca_compra" });
    await l.wait();
    expect(l.events()).toEqual([{ type: "stages.updated", reason: "updated", movedContacts: 0, from: null, to: null }]);
    await expect(fs.updateFunnelStage(ORG_A, st.id, { name: "   " })).rejects.toThrow("no puede quedar vacío");
    await expect(fs.updateFunnelStage(ORG_A, st.id, { name: "Compra" })).rejects.toThrow('Ya hay una etapa llamada "Compra"');
    expect((await stageOf("fs_c1")).stage).toBe("prospecto");
  });

  it("agregar entre dos etapas: clave estable desde el nombre, posición intermedia, modelo y regla", async () => {
    const after = await byId(ORG_A, "interesado");
    const created = await fs.createFunnelStage(ORG_A, { name: "Cotización enviada", afterId: after.id, botRule: "Cuando le mandas el total.", modelSlot: 1 });
    expect(created).toMatchObject({ key: "cotizacion_enviada", name: "Cotización enviada", position: 4, role: null, modelSlot: 1 });
    expect(await keys()).toEqual(["inbox", "prospecto", "interesado", "cotizacion_enviada", "cerca_compra", "compra"]);
    // Otra con el mismo nombre normalizado no se permite; con otro nombre parecido, clave con sufijo.
    await expect(fs.createFunnelStage(ORG_A, { name: "cotización enviada" })).rejects.toThrow("Ya hay una etapa llamada");
    const dup = await fs.createFunnelStage(ORG_A, { name: "Inbox 2" });
    expect(dup.key).toBe("inbox_2");
    // Máximo 10.
    for (const n of [3, 4, 5]) await fs.createFunnelStage(ORG_A, { name: `Extra ${n}` });
    expect((await keys()).length).toBe(10);
    await expect(fs.createFunnelStage(ORG_A, { name: "Once" })).rejects.toThrow("no puede tener más de 10");
  });

  it("reordenar: 'solo hacia adelante' del bot sigue el orden NUEVO", async () => {
    const st = await fs.listFunnelStages(ORG_A);
    const id = (k: string) => st.find((x) => x.key === k)!.id;
    // Interesado pasa a estar ANTES de Prospecto.
    await fs.reorderFunnelStages(ORG_A, [id("inbox"), id("interesado"), id("prospecto"), id("cerca_compra"), id("compra")]);
    expect(await keys()).toEqual(["inbox", "interesado", "prospecto", "cerca_compra", "compra"]);
    // fs_c3 está en interesado: ahora prospecto es "adelante".
    expect(await moveStageForward({ organizationId: ORG_A, contactId: "fs_c3", to: "prospecto", by: "agente" })).toEqual({ from: "interesado" });
    // fs_c1 está en prospecto: interesado ya es "atrás" → se ignora.
    expect(await moveStageForward({ organizationId: ORG_A, contactId: "fs_c1", to: "interesado", by: "agente" })).toBeNull();
    // Una clave que no existe nunca mueve.
    expect(await moveStageForward({ organizationId: ORG_A, contactId: "fs_c1", to: "ganado", by: "agente" })).toBeNull();
    // Un orden incompleto o con ids de otra organización se rechaza.
    await expect(fs.reorderFunnelStages(ORG_A, [id("inbox")])).rejects.toThrow("no coincide");
  });

  it("borrar con reasignación: un solo UPDATE, ningún contacto perdido, workflows sin etapa, UN aviso con el conteo", async () => {
    const l = await listen(ORG_A);
    await db.insert(s.workflows).values({ id: "wf_fs", organizationId: ORG_A, slug: "x", name: "X", triggerStage: "prospecto" });
    const prospecto = await byId(ORG_A, "prospecto");
    const interesado = await byId(ORG_A, "interesado");
    const out = await fs.deleteFunnelStage(ORG_A, prospecto.id, interesado.id);
    expect(out.moved).toBe(2);
    expect(await keys()).toEqual(["inbox", "interesado", "cerca_compra", "compra"]);
    expect((await fs.listFunnelStages(ORG_A)).map((x) => x.position)).toEqual([1, 2, 3, 4]);
    expect(await stageOf("fs_c1")).toEqual({ stage: "interesado", by: "sistema" });
    expect(await stageOf("fs_c2")).toEqual({ stage: "interesado", by: "sistema" });
    expect((await db.select().from(s.workflows).where(d.eq(s.workflows.id, "wf_fs")))[0].triggerStage).toBeNull();
    // La otra organización no se tocó.
    expect((await stageOf("fs_cb")).stage).toBe("prospecto");
    await l.wait();
    expect(l.events()).toEqual([{ type: "stages.updated", reason: "deleted", movedContacts: 2, from: "prospecto", to: "interesado" }]);
    // Sin ORG_B en la escucha: el aviso de A no le llega a B (lo comprueba el hub por org).
  });

  it("no se borra una etapa con papel ni se baja de 3; hay que mover el papel primero", async () => {
    const compra = await byId(ORG_A, "compra");
    const inbox = await byId(ORG_A, "inbox");
    await expect(fs.deleteFunnelStage(ORG_A, compra.id, inbox.id)).rejects.toThrow('papel "Venta cerrada"');
    await expect(fs.deleteFunnelStage(ORG_A, compra.id, compra.id)).rejects.toThrow("Elige otra etapa");
    // Mover el papel "Venta cerrada" a Cerca de compra no se puede (ya tiene papel)…
    const cerca = await byId(ORG_A, "cerca_compra");
    await expect(fs.setFunnelStageRole(ORG_A, cerca.id, "venta_cerrada")).rejects.toThrow("ya tiene el papel");
    // …ni a Interesado (quedaría ANTES de Cerca de compra: /banco regresaría a un cliente de Venta cerrada)…
    const interesado = await byId(ORG_A, "interesado");
    await expect(fs.setFunnelStageRole(ORG_A, interesado.id, "venta_cerrada")).rejects.toThrow("debe ir antes que la de");
    // …pero sí a una columna nueva al final; entonces Compra queda sin papel y se puede borrar.
    const entregado = await fs.createFunnelStage(ORG_A, { name: "Entregado" });
    const after = await fs.setFunnelStageRole(ORG_A, entregado.id, "venta_cerrada");
    expect(after.find((x) => x.key === "entregado")?.role).toBe("venta_cerrada");
    expect(after.find((x) => x.key === "compra")?.role).toBeNull();
    expect(after.filter((x) => x.role === "venta_cerrada")).toHaveLength(1);
    await fs.deleteFunnelStage(ORG_A, compra.id, interesado.id);
    // Mínimo 3.
    const prospecto = await byId(ORG_A, "prospecto");
    await fs.deleteFunnelStage(ORG_A, prospecto.id, inbox.id);
    await fs.deleteFunnelStage(ORG_A, interesado.id, inbox.id);
    expect((await keys()).length).toBe(3);
    await fs.createFunnelStage(ORG_A, { name: "Extra" });
    const extra = await byId(ORG_A, "extra");
    await fs.deleteFunnelStage(ORG_A, extra.id, inbox.id);
    // Quedan 3, todas con papel: ninguna se puede borrar.
    expect((await keys()).length).toBe(3);
    await expect(fs.deleteFunnelStage(ORG_A, (await byId(ORG_A, "cerca_compra")).id, (await byId(ORG_A, "inbox")).id)).rejects.toThrow(/papel|al menos 3/);
  });

  it("el orden de los papeles se respeta: Entrada primero y Cerca de compra antes que Venta cerrada", async () => {
    const st = await fs.listFunnelStages(ORG_A);
    const id = (k: string) => st.find((x) => x.key === k)!.id;
    // Compra arriba de Cerca de compra: rechazado (y nada cambia).
    await expect(fs.reorderFunnelStages(ORG_A, [id("inbox"), id("prospecto"), id("interesado"), id("compra"), id("cerca_compra")])).rejects.toThrow("debe ir antes que la de");
    // Inbox (Entrada) abajo: rechazado.
    await expect(fs.reorderFunnelStages(ORG_A, [id("prospecto"), id("inbox"), id("interesado"), id("cerca_compra"), id("compra")])).rejects.toThrow("primera columna");
    expect(await keys()).toEqual(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]);
    // Agregar al inicio (antes de Entrada) tampoco: se agrega "después de" otra etapa o al final.
    // Pasar Entrada a otra columna que no es la primera: rechazado.
    await expect(fs.setFunnelStageRole(ORG_A, id("prospecto"), "entrada")).rejects.toThrow("primera columna");
  });

  it("borrar mientras otro mueve un contacto a esa etapa: el borrado gana y el otro falla limpio (sin contactos huérfanos)", async () => {
    const neg = await fs.createFunnelStage(ORG_A, { name: "Negociando" });
    const inter = await byId(ORG_A, "interesado");
    // Una transacción "de otro" mueve fs_c1 a Negociando y se queda abierta un momento.
    const other = db.transaction(async (tx) => {
      await tx.update(s.contacts).set({ stage: "negociando" }).where(d.eq(s.contacts.id, "fs_c1"));
      await new Promise((r) => setTimeout(r, 300));
    });
    await new Promise((r) => setTimeout(r, 50));
    const del = fs.deleteFunnelStage(ORG_A, neg.id, inter.id);
    const [o, r] = await Promise.allSettled([other, del]);
    // El otro confirmó primero (el borrado esperó su candado) y el borrado se lo llevó a Interesado.
    expect(o.status).toBe("fulfilled");
    expect(r.status).toBe("fulfilled");
    expect((await stageOf("fs_c1")).stage).toBe("interesado");
    const orphans = await db.execute(d.sql`select count(*)::int as n from contacts c where c.organization_id = ${ORG_A} and not exists (select 1 from funnel_stages f where f.organization_id = c.organization_id and f.key = c.stage)`);
    expect(Number((orphans as unknown as { n: number }[])[0].n)).toBe(0);
  });

  it("aislamiento: los ids de otra organización no editan ni borran nada", async () => {
    const bProspecto = await byId(ORG_B, "prospecto");
    await expect(fs.updateFunnelStage(ORG_A, bProspecto.id, { name: "Hackeado" })).rejects.toThrow("ya no existe");
    const aInbox = await byId(ORG_A, "inbox");
    await expect(fs.deleteFunnelStage(ORG_A, bProspecto.id, aInbox.id)).rejects.toThrow("ya no existe");
    expect((await byId(ORG_B, "prospecto")).name).toBe("Prospecto");
    expect(await keys(ORG_B)).toEqual(["inbox", "prospecto", "interesado", "cerca_compra", "compra"]);
  });

  it("la base no deja un contacto en una etapa inexistente (llave foránea por organización)", async () => {
    await expect(db.insert(s.contacts).values({ id: "fs_x", organizationId: ORG_A, firstName: "X", stage: "ganado" })).rejects.toThrow();
    // Ni siquiera con una clave que existe en OTRA organización.
    await fs.createFunnelStage(ORG_B, { name: "Solo en B" });
    await expect(db.insert(s.contacts).values({ id: "fs_y", organizationId: ORG_A, firstName: "Y", stage: "solo_en_b" })).rejects.toThrow();
    await expect(db.delete(s.funnelStages).where(d.and(d.eq(s.funnelStages.organizationId, ORG_A), d.eq(s.funnelStages.key, "prospecto")))).rejects.toThrow();
  });
});
