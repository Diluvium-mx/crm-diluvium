// Pruebas contra Postgres REAL. Solo corren con TEST_DATABASE_URL apuntando a
// una base DESECHABLE con todas las migraciones aplicadas; cada caso limpia
// únicamente las organizaciones y usuarios propios de esta suite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("calificación del contacto (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  type Schema = typeof import("@/lib/db/schema");
  type Qualification = typeof import("./qualification");
  type Drizzle = typeof import("drizzle-orm");

  let db: Db;
  let s: Schema;
  let q: Qualification;
  let d: Drizzle;
  let defaultRanges: typeof import("./sizes").DEFAULT_SIZE_RANGES;

  const ORG_A = "org_qualification_a";
  const ORG_B = "org_qualification_b";
  const CONTACT_A = "contact_qualification_a";
  const CONTACT_B = "contact_qualification_b";
  const AUTHOR = "user_qualification_author";
  const OTHER = "user_qualification_other";
  const ADMIN = "user_qualification_admin";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    q = await import("./qualification");
    d = await import("drizzle-orm");
    ({ DEFAULT_SIZE_RANGES: defaultRanges } = await import("./sizes"));
  });

  beforeEach(async () => {
    await db
      .delete(s.organization)
      .where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.delete(s.user).where(d.inArray(s.user.id, [AUTHOR, OTHER, ADMIN]));

    await db.insert(s.organization).values([
      { id: ORG_A, name: "Qualification A", slug: "qualification-a", createdAt: new Date() },
      { id: ORG_B, name: "Qualification B", slug: "qualification-b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values([
      { id: AUTHOR, name: "Autora", email: "qualification-author@example.test" },
      { id: OTHER, name: "Otro agente", email: "qualification-other@example.test" },
      { id: ADMIN, name: "Administradora", email: "qualification-admin@example.test" },
    ]);
    await db.insert(s.member).values([
      {
        id: "member_qualification_author",
        organizationId: ORG_A,
        userId: AUTHOR,
        role: "agent",
        createdAt: new Date(),
      },
      {
        id: "member_qualification_other",
        organizationId: ORG_A,
        userId: OTHER,
        role: "agent",
        createdAt: new Date(),
      },
      {
        id: "member_qualification_admin",
        organizationId: ORG_A,
        userId: ADMIN,
        role: "admin",
        createdAt: new Date(),
      },
    ]);
    await db.insert(s.contacts).values([
      { id: CONTACT_A, organizationId: ORG_A, firstName: "Contacto A" },
      { id: CONTACT_B, organizationId: ORG_B, firstName: "Contacto B" },
    ]);
    await q.replaceSizeRanges(db, ORG_A, defaultRanges);
    await q.replaceSizeRanges(db, ORG_B, defaultRanges);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function expectEntryState(expectedCount: number, expectedNum: number | null) {
    const [contact] = await db
      .select({ numEntradas: s.contacts.numEntradas })
      .from(s.contacts)
      .where(
        d.and(
          d.eq(s.contacts.id, CONTACT_A),
          d.eq(s.contacts.organizationId, ORG_A),
        ),
      );
    const entries = await db
      .select()
      .from(s.contactEntradas)
      .where(
        d.and(
          d.eq(s.contactEntradas.organizationId, ORG_A),
          d.eq(s.contactEntradas.contactId, CONTACT_A),
        ),
      );
    expect(contact.numEntradas).toBe(expectedNum);
    expect(entries).toHaveLength(expectedCount);
    expect(entries.every((entry) => expectedNum !== null && entry.posicion <= expectedNum)).toBe(
      true,
    );
  }

  it("sube y baja num_entradas sin dejar posiciones sobrantes", async () => {
    await q.setNumEntradas(db, ORG_A, CONTACT_A, 3);
    await expectEntryState(3, 3);

    await q.setNumEntradas(db, ORG_A, CONTACT_A, 5);
    await expectEntryState(5, 5);

    await q.setNumEntradas(db, ORG_A, CONTACT_A, 2);
    await expectEntryState(2, 2);

    await q.setNumEntradas(db, ORG_A, CONTACT_A, null);
    await expectEntryState(0, null);
  });

  it("rechaza actualizar una posición inexistente", async () => {
    await q.setNumEntradas(db, ORG_A, CONTACT_A, 1);
    await expect(
      q.updateEntrada(db, ORG_A, CONTACT_A, 2, { anchoCm: 90 }),
    ).rejects.toThrow("La entrada indicada no existe para este contacto.");
  });

  it("guarda la talla sugerida y conserva el override manual", async () => {
    await q.setNumEntradas(db, ORG_A, CONTACT_A, 1);
    await q.updateEntrada(db, ORG_A, CONTACT_A, 1, {
      anchoCm: 90,
      linea: "mini",
      tamanoManual: "Especial 91",
    });
    await q.updateEntrada(db, ORG_A, CONTACT_A, 1, { anchoCm: 100 });

    const qualification = await q.getContactQualification(db, ORG_A, CONTACT_A);
    expect(qualification.entradas[0]).toMatchObject({
      anchoCm: 100,
      linea: "mini",
      tamanoSugerido: "G",
      tamanoManual: "Especial 91",
    });
  });

  it("reemplaza rangos, recalcula sugerencias y rechaza encimados", async () => {
    await q.setNumEntradas(db, ORG_A, CONTACT_A, 1);
    await q.updateEntrada(db, ORG_A, CONTACT_A, 1, { anchoCm: 90, linea: "mini" });

    const replacement = [
      { linea: "mini" as const, talla: "Nueva M", minCm: 80, maxCm: 100, posicion: 1 },
      {
        linea: "estandar" as const,
        talla: "Estándar",
        minCm: 69,
        maxCm: 120,
        posicion: 1,
      },
    ];
    await q.replaceSizeRanges(db, ORG_A, replacement);
    expect((await q.getContactQualification(db, ORG_A, CONTACT_A)).entradas[0])
      .toMatchObject({ tamanoSugerido: "Nueva M" });

    await expect(
      q.replaceSizeRanges(db, ORG_A, [
        { linea: "mini", talla: "A", minCm: 60, maxCm: 80, posicion: 1 },
        { linea: "mini", talla: "B", minCm: 80, maxCm: 90, posicion: 2 },
      ]),
    ).rejects.toThrow("se enciman");
    expect(await q.listSizeRanges(db, ORG_A)).toEqual(replacement);
  });

  it("permite modificar comentarios al autor y al admin, pero no a otro agente", async () => {
    const comment = await q.addComment(db, ORG_A, CONTACT_A, AUTHOR, "  Comentario inicial  ");
    expect(comment.body).toBe("Comentario inicial");

    await q.updateComment(
      db,
      ORG_A,
      comment.id,
      { userId: AUTHOR, role: "agent" },
      "Editado por autora",
    );
    await expect(
      q.updateComment(
        db,
        ORG_A,
        comment.id,
        { userId: OTHER, role: "agent" },
        "Intento ajeno",
      ),
    ).rejects.toThrow("No puedes modificar este comentario.");
    await expect(
      q.deleteComment(db, ORG_A, comment.id, { userId: OTHER, role: "agent" }),
    ).rejects.toThrow("No puedes modificar este comentario.");

    await q.updateComment(
      db,
      ORG_A,
      comment.id,
      { userId: ADMIN, role: "admin" },
      "Editado por admin",
    );
    expect((await q.getContactQualification(db, ORG_A, CONTACT_A)).comentarios[0].body)
      .toBe("Editado por admin");
    await q.deleteComment(db, ORG_A, comment.id, { userId: ADMIN, role: "admin" });
    expect((await q.getContactQualification(db, ORG_A, CONTACT_A)).comentarios).toEqual([]);
  });

  it("aísla los contactos de otra organización", async () => {
    await expect(q.getContactQualification(db, ORG_A, CONTACT_B)).rejects.toThrow(
      "Contacto no encontrado en esta organización.",
    );
    await expect(
      q.updateContactQualification(db, ORG_A, CONTACT_B, { nivelAguaCm: 20 }),
    ).rejects.toThrow("Contacto no encontrado en esta organización.");
  });

  it("los CHECK de Postgres rechazan porcentaje 15 y nivel de agua -1", async () => {
    await expect(
      db
        .update(s.contacts)
        .set({ porcentajeConvencimiento: 15 })
        .where(
          d.and(
            d.eq(s.contacts.id, CONTACT_A),
            d.eq(s.contacts.organizationId, ORG_A),
          ),
        ),
    ).rejects.toThrow();

    await expect(
      db
        .update(s.contacts)
        .set({ nivelAguaCm: -1 })
        .where(
          d.and(
            d.eq(s.contacts.id, CONTACT_A),
            d.eq(s.contacts.organizationId, ORG_A),
          ),
        ),
    ).rejects.toThrow();
  });
});
