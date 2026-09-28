// Aviso "contacto actualizado" (contact.updated) contra Postgres REAL
// (TEST_DATABASE_URL): cada ruta que cambia un contacto lo manda al confirmar, con
// qué cambió y quién; solo a su organización; nada si se revierte; y una
// importación masiva sigue siendo UN solo contacts.bulk.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactUpdatedEvent, InboxEvent } from "@/lib/inbox/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const session = vi.hoisted(() => ({ current: { organizationId: "org_live_a", userId: "u_live_daniel", role: "agent" } }));
vi.mock("@/lib/auth/active-organization", () => ({ requireActiveMembership: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/workflows/triggers", () => ({ onContactStageEntered: async () => undefined }));

describe.skipIf(!TEST_DATABASE_URL)("aviso contact.updated (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let subscribeToInbox: typeof import("@/lib/inbox/events").subscribeToInbox;
  let resetHub: typeof import("@/lib/inbox/events").__resetInboxHubForTests;
  let notifyContactUpdated: typeof import("./notify-updated").notifyContactUpdated;
  let q: typeof import("./qualification");
  let moveStageForward: typeof import("./stage").moveStageForward;
  let setQuoteByAgent: typeof import("@/lib/ai/runtime/actions").setQuoteByAgent;
  let contactActions: typeof import("@/lib/actions/contacts");
  let qualificationActions: typeof import("@/lib/actions/contact-qualification");
  let importParsedContacts: typeof import("@/lib/import/persist").importParsedContacts;
  let parseGhlContactsCsv: typeof import("@/lib/import/ghl-contacts-csv").parseGhlContactsCsv;

  const ORG_A = "org_live_a";
  const ORG_B = "org_live_b";
  const DANIEL = "u_live_daniel";
  const ANA = "u_live_ana";
  const JUAN = "c_live_juan";
  const OTRO = "c_live_otro";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    ({ subscribeToInbox, __resetInboxHubForTests: resetHub } = await import("@/lib/inbox/events"));
    ({ notifyContactUpdated } = await import("./notify-updated"));
    q = await import("./qualification");
    ({ moveStageForward } = await import("./stage"));
    ({ setQuoteByAgent } = await import("@/lib/ai/runtime/actions"));
    contactActions = await import("@/lib/actions/contacts");
    qualificationActions = await import("@/lib/actions/contact-qualification");
    ({ importParsedContacts } = await import("@/lib/import/persist"));
    ({ parseGhlContactsCsv } = await import("@/lib/import/ghl-contacts-csv"));
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG_A, userId: DANIEL, role: "agent" };
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.delete(s.user).where(d.inArray(s.user.id, [DANIEL, ANA]));
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Live A", slug: "live-a", createdAt: new Date() },
      { id: ORG_B, name: "Live B", slug: "live-b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values([
      { id: DANIEL, name: "Daniel López", email: "live-daniel@example.test" },
      { id: ANA, name: "Ana", email: "live-ana@example.test" },
    ]);
    await db.insert(s.member).values([
      { id: "m_live_daniel", organizationId: ORG_A, userId: DANIEL, role: "agent", createdAt: new Date() },
      { id: "m_live_ana", organizationId: ORG_B, userId: ANA, role: "agent", createdAt: new Date() },
    ]);
    await db.insert(s.contacts).values([
      { id: JUAN, organizationId: ORG_A, firstName: "Juan", lastName: "Pérez", stage: "prospecto" },
      { id: OTRO, organizationId: ORG_B, firstName: "Otra", stage: "prospecto" },
    ]);
    // Los contact.created de la semilla pueden llegar tarde: se dejan pasar.
    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(async () => {
    await resetHub();
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function listen(organizationId: string) {
    const all: InboxEvent[] = [];
    const off = await subscribeToInbox(organizationId, (event) => all.push(event));
    const updates = () => all.filter((e): e is ContactUpdatedEvent => e.type === "contact.updated");
    const wait = (n: number, ms = 2_000) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (updates().length >= n) return resolve();
          if (Date.now() - started > ms) return reject(new Error(`solo llegaron ${updates().length} de ${n} avisos`));
          setTimeout(tick, 20);
        };
        tick();
      });
    return { all, updates, wait, off };
  }
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  it("el vendedor mueve la etapa: de → a, su nombre y solo a su organización", async () => {
    const a = await listen(ORG_A);
    const b = await listen(ORG_B);
    try {
      await contactActions.updateContactStage({ contactId: JUAN, stage: "interesado" });
      await a.wait(1);
      expect(a.updates()[0]).toMatchObject({
        type: "contact.updated",
        contactId: JUAN,
        contactName: "Juan Pérez",
        changes: ["etapa"],
        stage: { from: "prospecto", to: "interesado" },
        by: { kind: "vendedor", userId: DANIEL, name: "Daniel López" },
      });
      expect(Number.isNaN(Date.parse(a.updates()[0].at))).toBe(false);
      // Soltarla en la misma columna no es un cambio: sin aviso.
      await contactActions.updateContactStage({ contactId: JUAN, stage: "interesado" });
      await settle();
      expect(a.updates()).toHaveLength(1);
      expect(b.all.filter((e) => e.type !== "reload")).toHaveLength(0);
    } finally {
      a.off();
      b.off();
    }
  });

  it("temperatura del vendedor: aviso sin etapa", async () => {
    const a = await listen(ORG_A);
    try {
      await contactActions.updateContactTemperature({ contactId: JUAN, temperature: "caliente" });
      await a.wait(1);
      expect(a.updates()[0]).toMatchObject({ changes: ["temperatura"], by: { kind: "vendedor", userId: DANIEL } });
      expect(a.updates()[0].stage).toBeUndefined();
    } finally {
      a.off();
    }
  });

  it("el agente mueve la etapa y fija la cotización (también sobre la de un vendedor: nada es definitivo); sin cambio, no escribe ni avisa", async () => {
    const a = await listen(ORG_A);
    try {
      expect(await moveStageForward({ organizationId: ORG_A, contactId: JUAN, to: "interesado", by: "agente" })).toEqual({ from: "prospecto" });
      expect(await setQuoteByAgent(ORG_A, JUAN, 5500)).toBe(true);
      await a.wait(2);
      expect(a.updates()[0]).toMatchObject({ changes: ["etapa"], stage: { from: "prospecto", to: "interesado" }, by: { kind: "agente" } });
      expect(a.updates()[1]).toMatchObject({ changes: ["cotizacion"], by: { kind: "agente" } });
      // Retroceso o misma etapa: se ignora y no avisa.
      expect(await moveStageForward({ organizationId: ORG_A, contactId: JUAN, to: "prospecto", by: "agente" })).toBeNull();
      await q.updateContactQualification(db, ORG_A, JUAN, { montoCotizacion: 9000 }, { kind: "vendedor", userId: DANIEL });
      await a.wait(3);
      expect(await setQuoteByAgent(ORG_A, JUAN, 4000)).toBe(true);
      await a.wait(4);
      expect(a.updates()[3]).toMatchObject({ changes: ["cotizacion"], by: { kind: "agente" } });
      expect(await setQuoteByAgent(ORG_A, JUAN, 4000)).toBe(false); // mismo monto: nada
      await settle();
      expect(a.updates()).toHaveLength(4);
    } finally {
      a.off();
    }
  });

  it("/banco: automatización, con el vendedor que escribió el comando (o sin él, palabra clave del cliente)", async () => {
    const a = await listen(ORG_A);
    try {
      await moveStageForward({ organizationId: ORG_A, contactId: JUAN, to: "interesado", by: "sistema", actorUserId: null });
      await moveStageForward({ organizationId: ORG_A, contactId: JUAN, to: "cerca_compra", by: "sistema", actorUserId: DANIEL });
      await a.wait(2);
      expect(a.updates()[0].by).toEqual({ kind: "automatizacion", userId: null });
      expect(a.updates()[1]).toMatchObject({
        stage: { from: "interesado", to: "cerca_compra" },
        by: { kind: "automatizacion", userId: DANIEL },
      });
    } finally {
      a.off();
    }
  });

  it("Detalle: toda escritura de qualification.ts avisa (sin `by` = Agente IA, el autollenado)", async () => {
    const a = await listen(ORG_A);
    try {
      await q.updateContactQualification(db, ORG_A, JUAN, { nivelAguaCm: 40, tieneInundaciones: "si" });
      await q.setNumEntradas(db, ORG_A, JUAN, 2);
      await q.updateEntrada(db, ORG_A, JUAN, 1, { anchoCm: 90 });
      const comment = await q.addComment(db, ORG_A, JUAN, DANIEL, "Llamar mañana");
      await q.updateComment(db, ORG_A, comment.id, { userId: DANIEL, role: "agent" }, "Llamar el lunes");
      await q.deleteComment(db, ORG_A, comment.id, { userId: DANIEL, role: "agent" });
      await a.wait(6);
      expect(a.updates().map((e) => [e.changes, e.by.kind])).toEqual([
        [["detalle"], "agente"],
        [["detalle"], "agente"],
        [["detalle"], "agente"],
        [["comentarios"], "vendedor"],
        [["comentarios"], "vendedor"],
        [["comentarios"], "vendedor"],
      ]);
      // Monto + otro campo en una sola escritura: los dos cambios.
      await q.updateContactQualification(db, ORG_A, JUAN, { montoCotizacion: 1200, porcentajeConvencimiento: 50 });
      await a.wait(7);
      expect(a.updates()[6].changes).toEqual(["cotizacion", "detalle"]);
    } finally {
      a.off();
    }
  });

  it("desde las Server Actions del Detalle, el aviso lleva al vendedor de la sesión", async () => {
    const a = await listen(ORG_A);
    try {
      await qualificationActions.updateContactQualification(JUAN, { nivelAguaTexto: "hasta la rodilla" });
      await qualificationActions.setNumEntradas(JUAN, 1);
      await qualificationActions.updateEntrada(JUAN, 1, { linea: "mini" });
      await a.wait(3);
      for (const event of a.updates()) expect(event.by).toEqual({ kind: "vendedor", userId: DANIEL, name: "Daniel López" });
    } finally {
      a.off();
    }
  });

  it("sin confirmar no hay aviso: una transacción revertida no manda nada", async () => {
    const a = await listen(ORG_A);
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.update(s.contacts).set({ stage: "compra" }).where(d.eq(s.contacts.id, JUAN));
          await notifyContactUpdated(tx, {
            organizationId: ORG_A,
            contactId: JUAN,
            changes: ["etapa"],
            stage: { from: "prospecto", to: "compra" },
            by: { kind: "agente" },
          });
          throw new Error("revertir");
        }),
      ).rejects.toThrow("revertir");
      await settle(300);
      expect(a.updates()).toHaveLength(0);
    } finally {
      a.off();
    }
  });

  it("un contacto de otra organización no genera aviso en ninguna", async () => {
    const a = await listen(ORG_A);
    const b = await listen(ORG_B);
    try {
      await notifyContactUpdated(db, { organizationId: ORG_A, contactId: OTRO, changes: ["detalle"], by: { kind: "agente" } });
      await expect(q.updateContactQualification(db, ORG_A, OTRO, { nivelAguaCm: 10 })).rejects.toThrow();
      await settle(300);
      expect(a.updates()).toHaveLength(0);
      expect(b.updates()).toHaveLength(0);
    } finally {
      a.off();
      b.off();
    }
  });

  it("ponerse al día (Embudo al conectar/reconectar): solo lo movido desde esa hora y solo de su organización", async () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    // Semilla vieja: fuera del margen de 5 s.
    await db.update(s.contacts).set({ stageChangedAt: new Date(Date.now() - 120_000) }).where(d.inArray(s.contacts.id, [JUAN, OTRO]));
    const empty = await contactActions.getContactsChangedSince(before);
    expect(empty).toMatchObject({ contacts: [], tooMany: false });
    await moveStageForward({ organizationId: ORG_A, contactId: JUAN, to: "interesado", by: "agente" });
    await moveStageForward({ organizationId: ORG_B, contactId: OTRO, to: "interesado", by: "agente" });
    const changed = await contactActions.getContactsChangedSince(before);
    expect(changed.contacts.map((c) => [c.id, c.stage])).toEqual([[JUAN, "interesado"]]);
    expect(Date.parse(changed.now)).toBeGreaterThan(Date.parse(before));
    // La temperatura (sin hora) viaja completa: la de su organización, no la de otra.
    expect(changed.temperatures).toEqual([]);
    await contactActions.updateContactTemperature({ contactId: JUAN, temperature: "caliente" });
    await db.update(s.contacts).set({ temperature: "frio" }).where(d.eq(s.contacts.id, OTRO));
    expect((await contactActions.getContactsChangedSince(changed.now)).temperatures).toEqual([[JUAN, "caliente"]]);
    await expect(contactActions.getContactsChangedSince("no es fecha")).rejects.toThrow();
    // Más de 200: se pide recargar completo.
    // Hora explícita (como la escribe la app): el now() por defecto depende del TimeZone de la base.
    await db
      .insert(s.contacts)
      .values(Array.from({ length: 201 }, (_, i) => ({ id: `c_live_many_${i}`, organizationId: ORG_A, firstName: `M${i}`, stageChangedAt: new Date() })));
    const many = await contactActions.getContactsChangedSince(before);
    expect(many).toMatchObject({ contacts: [], tooMany: true });
  });

  it("el Embudo recibe solo las columnas de la tarjeta (B14): nada de campos personalizados ni calificación", async () => {
    const { boardContactColumns } = await import("./board-contact");
    await db.update(s.contacts).set({ customFields: { notas: "largo" }, montoCotizacion: "1000.00" }).where(d.eq(s.contacts.id, JUAN));
    const board = Object.keys(boardContactColumns).sort();
    const listed = await contactActions.listContacts();
    expect(listed.map((c) => c.id)).toContain(JUAN);
    expect(listed.map((c) => c.id)).not.toContain(OTRO);
    for (const c of listed) expect(Object.keys(c).sort()).toEqual(board);
    const byId = await contactActions.getContactsByIds([JUAN, OTRO]);
    expect(byId.map((c) => [c.id, Object.keys(c).sort()])).toEqual([[JUAN, board]]);
    await db.update(s.contacts).set({ stageChangedAt: new Date() }).where(d.eq(s.contacts.id, JUAN));
    const changed = await contactActions.getContactsChangedSince(new Date(Date.now() - 60_000).toISOString());
    expect(changed.contacts.map((c) => Object.keys(c).sort())).toEqual([board]);
  });

  it("importación masiva: UN contacts.bulk y ningún contact.updated (tampoco al reimportar)", async () => {
    const header = "Contact Id,First Name,Last Name,Phone,Email,Created,Last Activity,Tags,Country,Opportunities";
    const rows = Array.from(
      { length: 60 },
      (_, i) =>
        `ghl_live_${i},Cliente${i},,+5266810${String(i).padStart(5, "0")},,2026-09-01T10:00:00-07:00,Sep 01 2026 10:00 AM,,Mexico,open Embudo de ventas Diluvium Interesado`,
    );
    const parsed = parseGhlContactsCsv([header, ...rows].join("\n"));
    if (!parsed.ok) throw new Error("CSV de prueba inválido");
    const a = await listen(ORG_A);
    try {
      await importParsedContacts(db, ORG_A, parsed);
      await settle(400);
      expect(a.all.filter((e) => e.type === "contacts.bulk")).toHaveLength(1);
      expect(a.all.filter((e) => e.type === "contact.created")).toHaveLength(0);
      await importParsedContacts(db, ORG_A, parsed);
      await settle(400);
      expect(a.updates()).toHaveLength(0);
    } finally {
      a.off();
    }
  });
});
