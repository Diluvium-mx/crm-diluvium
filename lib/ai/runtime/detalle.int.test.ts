// Autollenado del Detalle del contacto por el Agente IA (parte 1, 26-sep-2026) contra
// Postgres REAL: solo campos vacíos o del propio agente, lo del vendedor nunca se toca,
// entradas con su tamaño sugerido, comentarios firmados "Agente IA" sin repetir, y
// todo acotado a la organización. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Detalle del contacto llenado por el Agente IA (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let q: typeof import("@/lib/contacts/qualification");
  let detalle: typeof import("./detalle");
  let tools: typeof import("./tools");
  let d: typeof import("drizzle-orm");

  const ORG = "org_detalle_ia";
  const OTHER_ORG = "org_detalle_ia_otra";
  const CONTACT = "contact_detalle_ia";
  const OTHER_CONTACT = "contact_detalle_ia_otra";
  const VENDEDOR = "user_detalle_ia_vendedor";
  // Como las Server Actions: quien escribe es la vendedora (origen "vendedor").
  const POR_VENDEDOR = { kind: "vendedor" as const, userId: "user_detalle_ia_vendedor" };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    q = await import("@/lib/contacts/qualification");
    detalle = await import("./detalle");
    tools = await import("./tools");
    d = await import("drizzle-orm");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG, OTHER_ORG]));
    await db.delete(s.user).where(d.inArray(s.user.id, [VENDEDOR]));
    // El autor de sistema lo crea la 0037; otras suites truncan "user".
    await db
      .insert(s.user)
      .values({ id: q.AGENT_AI_USER_ID, name: "Agente IA", email: "agente-ia@sistema.invalid", banned: true })
      .onConflictDoNothing();
    await db.insert(s.organization).values([
      { id: ORG, name: "Detalle", slug: "detalle-ia", createdAt: new Date() },
      { id: OTHER_ORG, name: "Otra", slug: "detalle-ia-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: VENDEDOR, name: "Vendedora", email: "detalle-ia-vendedora@example.test" });
    await db.insert(s.member).values({ id: "member_detalle_ia", organizationId: ORG, userId: VENDEDOR, role: "agent", createdAt: new Date() });
    await db.insert(s.contacts).values([
      { id: CONTACT, organizationId: ORG, firstName: "Cliente" },
      { id: OTHER_CONTACT, organizationId: OTHER_ORG, firstName: "Ajeno" },
    ]);
    const { DEFAULT_SIZE_RANGES } = await import("@/lib/contacts/sizes");
    await q.replaceSizeRanges(db, ORG, DEFAULT_SIZE_RANGES);
  });

  const pedido = (campos: Record<string, unknown>) => detalle.mergeDetalle([{ kind: "detalle", detalle: tools.parseDetalle(campos)! }])!;
  const details = () => q.getContactQualification(db, ORG, CONTACT);

  it("llena los 7 campos vacíos: marca 'IA', tamaño sugerido por ancho y ningún comentario (6-oct-2026)", async () => {
    const r = await detalle.applyDetalleByAgent(
      ORG,
      CONTACT,
      pedido({
        tiene_inundaciones: "si",
        nivel_agua_cm: 40.4,
        nivel_agua_texto: "le llega a la rodilla",
        num_entradas: 2,
        anchos_cm: [95, 105],
        porcentaje_convencimiento: 57,
        comentario: "Tiene cochera con desnivel",
      }),
    );
    expect(r.delVendedor).toEqual([]);
    const dt = await details();
    expect(dt).toMatchObject({ tieneInundaciones: "si", nivelAguaCm: 40, nivelAguaTexto: "le llega a la rodilla", numEntradas: 2, porcentajeConvencimiento: 60 });
    expect(dt.entradas.map((e) => [e.posicion, e.anchoCm])).toEqual([
      [1, 95],
      [2, 105],
    ]);
    expect(dt.entradas.every((e) => e.tamanoSugerido !== null)).toBe(true);
    expect(dt.comentarios).toEqual([]); // el comentario que mande un modelo viejo se ignora
    expect([...dt.iaFields].sort()).toEqual(
      ["entrada_1_ancho", "entrada_2_ancho", "nivel_agua_cm", "nivel_agua_texto", "num_entradas", "porcentaje_convencimiento", "tiene_inundaciones"].sort(),
    );
  });

  it("regla del dueño (26-sep): nada es definitivo — el agente corrige lo que puso un vendedor si el cliente dice otra cosa; la marca \"IA\" es de quien escribió al último", async () => {
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ nivel_agua_cm: 40, porcentaje_convencimiento: 30 }));
    // El vendedor corrige el nivel y llena las inundaciones (Server Action → "vendedor").
    await q.updateContactQualification(db, ORG, CONTACT, { nivelAguaCm: 55, tieneInundaciones: "no_sabe" }, POR_VENDEDOR);
    let dt = await details();
    expect(dt.iaFields).toEqual(["porcentaje_convencimiento"]); // lo del vendedor, sin marca
    // El cliente dice otra cosa en el chat: el agente lo vuelve a poner (y la marca regresa).
    const r = await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ nivel_agua_cm: 20, tiene_inundaciones: "si", porcentaje_convencimiento: 70 }));
    expect(r.delVendedor.sort()).toEqual(["nivel_agua_cm", "tiene_inundaciones"]); // solo para el log
    dt = await details();
    expect(dt).toMatchObject({ nivelAguaCm: 20, tieneInundaciones: "si", porcentajeConvencimiento: 70 });
    expect([...dt.iaFields].sort()).toEqual(["nivel_agua_cm", "porcentaje_convencimiento", "tiene_inundaciones"]);
    // Sin cambio, no escribe (la corrección del vendedor se queda si el agente no manda otro dato).
    await q.updateContactQualification(db, ORG, CONTACT, { nivelAguaCm: 60 }, POR_VENDEDOR);
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ porcentaje_convencimiento: 70 }));
    expect((await details()).nivelAguaCm).toBe(60);
  });

  it("un valor que ya estaba (sin origen: anterior a esta función o importado) también se corrige", async () => {
    await db.update(s.contacts).set({ porcentajeConvencimiento: 90, numEntradas: 1 }).where(d.eq(s.contacts.id, CONTACT));
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ porcentaje_convencimiento: 20, num_entradas: 3 }));
    expect(await details()).toMatchObject({ porcentajeConvencimiento: 20, numEntradas: 3 });
  });

  it("entradas: el cliente decide 2 compuertas en vez de 1 → se agrega la entrada; y si baja a 2 de 3, se quita la de más aunque la hubiera tocado un vendedor", async () => {
    await q.setNumEntradas(db, ORG, CONTACT, 1, POR_VENDEDOR);
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ anchos_cm: [90, 120] }));
    let dt = await details();
    expect(dt.numEntradas).toBe(2);
    expect(dt.entradas.map((e) => e.anchoCm)).toEqual([90, 120]);

    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ num_entradas: 3, anchos_cm: [80, 85, 100] }));
    await q.updateEntrada(db, ORG, CONTACT, 3, { anchoCm: 110 }, POR_VENDEDOR);
    expect((await details()).iaFields).not.toContain("entrada_3_ancho");
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ num_entradas: 2, anchos_cm: [81, 86] }));
    dt = await details();
    expect(dt.numEntradas).toBe(2);
    expect(dt.entradas.map((e) => e.anchoCm)).toEqual([81, 86]);
    // La marca de la entrada borrada se va con ella: si vuelve a crearse vacía, sin "IA".
    expect(dt.iaFields.filter((k) => k.startsWith("entrada_3_"))).toEqual([]);
    await q.setNumEntradas(db, ORG, CONTACT, 3, POR_VENDEDOR);
    expect((await details()).iaFields).not.toContain("entrada_3_ancho");
  });

  it("el agente corrige lo SUYO cuando el cliente lo cambia (p. ej. el % conforme avanza la conversación, o 2 entradas en vez de 3)", async () => {
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ porcentaje_convencimiento: 20, num_entradas: 3, anchos_cm: [80, 85, 90] }));
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ porcentaje_convencimiento: 80, num_entradas: 2 }));
    const dt = await details();
    expect(dt).toMatchObject({ porcentajeConvencimiento: 80, numEntradas: 2 });
    expect(dt.entradas.map((e) => e.anchoCm)).toEqual([80, 85]);
  });

  it("\"no sabe\" nunca borra un sí/no que ya dijo el cliente (relleno del modelo); sí llena uno vacío", async () => {
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ tiene_inundaciones: "si" }));
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ tiene_inundaciones: "no_sabe" }));
    expect((await details()).tieneInundaciones).toBe("si");
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ tiene_inundaciones: "no" }));
    expect((await details()).tieneInundaciones).toBe("no");
    await db.update(s.contacts).set({ tieneInundaciones: null }).where(d.eq(s.contacts.id, CONTACT));
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ tiene_inundaciones: "no_sabe" }));
    expect((await details()).tieneInundaciones).toBe("no_sabe");
  });

  it("organización: un contacto de otra organización no se toca", async () => {
    const r = await detalle.applyDetalleByAgent(ORG, OTHER_CONTACT, pedido({ num_entradas: 2, comentario: "x" }));
    expect(r).toEqual({ llenados: [], delVendedor: [] });
    const [ajeno] = await db.select().from(s.contacts).where(d.eq(s.contacts.id, OTHER_CONTACT));
    expect(ajeno.numEntradas).toBeNull();
  });

  it("contexto para el modelo: lo guardado, sin comentarios (6-oct-2026)", async () => {
    expect(await detalle.detalleContextFor(ORG, CONTACT)).toBe("Detalle guardado del contacto: vacío.");
    await detalle.applyDetalleByAgent(ORG, CONTACT, pedido({ tiene_inundaciones: "si", nivel_agua_cm: 40, anchos_cm: [95], porcentaje_convencimiento: 60, comentario: "Tiene cochera con desnivel" }));
    await q.addComment(db, ORG, CONTACT, VENDEDOR, "Nota interna: no darle descuento");
    let ctx = await detalle.detalleContextFor(ORG, CONTACT);
    expect(ctx).toContain("inundaciones: sí · agua: 40 cm · entradas: 1 (anchos: 95 cm) · convencimiento: 60 %");
    expect(ctx).not.toContain("cochera");
    expect(ctx).not.toContain("descuento");
    // Lo que corrigió un vendedor se le dice al modelo (pudo saberlo por teléfono).
    await q.setNumEntradas(db, ORG, CONTACT, 2, POR_VENDEDOR);
    ctx = await detalle.detalleContextFor(ORG, CONTACT);
    expect(ctx).toContain("entradas: 2 (anchos: 95 cm) (lo corrigió un vendedor)");
    expect(ctx).not.toContain("agua: 40 cm (lo corrigió");
  });
});
