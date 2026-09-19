// Tests de integración del importador de contactos GHL contra Postgres REAL:
// verifica que canal, tags de negocio, etapa (desde Opportunities, la más
// avanzada), país y "sin teléfono" quedan bien guardados, la idempotencia del
// upsert por org+ghl_contact_id, y que un re-sync NO resetea la etapa ni borra
// un teléfono válido. Solo corren con TEST_DATABASE_URL apuntando a una base
// DESECHABLE con las migraciones aplicadas (incluida 0009 tags+country); borran
// sus datos al empezar. Nunca apuntarlos a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const header =
  "Contact Id,First Name,Last Name,Phone,Email,Created,Last Activity,Tags,Country,Opportunities";
const P = "open Embudo de ventas Diluvium";
// 8 filas reales de referencia (una por etapa + multi-opp + Opportunities vacía).
const sampleReal = `${header}
aBxgRqvijWmQ8Vgi2lgV,Ingeniería,Empresarial,+525540432914,carlos_hdez_m@hotmail.com,2026-06-08T10:28:39-07:00,Jul 22 2026 02:09 PM,"inbound whatsapp, wa: 5216682419579, transferencia a humano, another-device-replied-whatsapp",Mexico,${P} Prospecto
5OMR029hnaKCj5bHDl6i,Enrique - griselda (3 compuertas),,+523228886578,arquikeco_72@hotmail.com,2026-06-02T14:28:05-07:00,Jun 03 2026 12:59 PM,"inbound whatsapp, wa: 5216682419579, another-device-replied-whatsapp",Mexico,${P} Compra
PFE9k83NAkdatplYtNRh,Ana,Dacasa,+527771091114,,2026-07-15T11:48:17-07:00,Jul 16 2026 12:31 PM,"inbound whatsapp, wa: 5216682419579, medidas enviadas, another-device-replied-whatsapp",Mexico,${P} Interesado
LSURQKckw3gIEhnoN5v3,Adrian,,+526151557244,leydeamper08@gmail.com,2026-09-03T15:11:09-07:00,Sep 17 2026 12:03 PM,"inbound whatsapp, fb-ad-lead-whatsapp, wa: 5216682419579, video-instalacion-enviado, another-device-replied-whatsapp",Mexico,${P} Cerca de compra
BbEJNSEtefAqziLSmtgG,Marianalr83,,+526671045171,,2026-09-19T12:46:25-07:00,Sep 19 2026 12:46 PM,"inbound whatsapp, instagram-ad-lead-whatsapp, wa: 5216682419579",Mexico,${P} Inbox
dH4gmbAyjfj4f6TzNbvU,Diego,Stevenot,,,2026-08-25T13:43:50-07:00,Aug 25 2026 03:49 PM,,Mexico,"${P} Inbox, ${P} Inbox"
bH97HvG4GpQn8Dcreah5,User,,+524521178694,,2026-09-14T09:20:28-07:00,Sep 14 2026 09:20 AM,"wa: 5216682419579, another-device-replied-whatsapp",Mexico,
DkjVSookyfaDLUPRb6wk,Marissa,Orduña rovirosa,,,2026-09-18T21:36:17-07:00,Sep 18 2026 09:37 PM,,Mexico,${P} Inbox`;

describe.skipIf(!TEST_DATABASE_URL)("import de contactos GHL (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  type Schema = typeof import("@/lib/db/schema");
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let parseGhlContactsCsv: typeof import("./ghl-contacts-csv").parseGhlContactsCsv;
  let importParsedContacts: typeof import("./persist").importParsedContacts;
  const ORG_A = "org_import_a";
  const ORG_B = "org_import_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq, and } = await import("drizzle-orm"));
    ({ parseGhlContactsCsv } = await import("./ghl-contacts-csv"));
    ({ importParsedContacts } = await import("./persist"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "import-a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "import-b", createdAt: new Date() },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  function parse(csv = sampleReal) {
    const parsed = parseGhlContactsCsv(csv);
    if (!parsed.ok) throw new Error("La muestra debería parsear");
    return parsed;
  }

  async function contactsOf(orgId: string) {
    return db.select().from(s.contacts).where(eq(s.contacts.organizationId, orgId));
  }

  async function findBy(orgId: string, ghlContactId: string) {
    const [c] = await db
      .select()
      .from(s.contacts)
      .where(
        and(eq(s.contacts.organizationId, orgId), eq(s.contacts.ghlContactId, ghlContactId)),
      );
    return c;
  }

  it("importa las 8 filas reales con canal, tags, etapa, país y sin-teléfono", async () => {
    const result = await importParsedContacts(db, ORG_A, parse());
    expect(result).toEqual({
      imported: 8,
      updated: 0,
      invalidPhones: 0,
      withoutPhone: 2,
      unrecognizedStages: 0,
      skipped: 0,
    });

    const all = await contactsOf(ORG_A);
    expect(all).toHaveLength(8);
    expect(all.every((r) => r.source === "ghl_import")).toBe(true);
    expect(all.every((r) => r.country === "Mexico")).toBe(true);

    // Etapa desde Opportunities (una por cada valor).
    expect((await findBy(ORG_A, "aBxgRqvijWmQ8Vgi2lgV"))?.stage).toBe("prospecto");
    expect((await findBy(ORG_A, "5OMR029hnaKCj5bHDl6i"))?.stage).toBe("compra");
    expect((await findBy(ORG_A, "PFE9k83NAkdatplYtNRh"))?.stage).toBe("interesado");
    expect((await findBy(ORG_A, "LSURQKckw3gIEhnoN5v3"))?.stage).toBe("cerca_compra");
    expect((await findBy(ORG_A, "BbEJNSEtefAqziLSmtgG"))?.stage).toBe("inbox");

    // Canal y tags de negocio.
    expect(await findBy(ORG_A, "LSURQKckw3gIEhnoN5v3")).toMatchObject({
      sourceChannel: "fb",
      tags: ["video-instalacion-enviado"],
    });
    expect(await findBy(ORG_A, "BbEJNSEtefAqziLSmtgG")).toMatchObject({
      sourceChannel: "instagram",
    });
    expect(await findBy(ORG_A, "aBxgRqvijWmQ8Vgi2lgV")).toMatchObject({
      sourceChannel: "whatsapp",
      tags: ["transferencia a humano"],
    });

    // Multi-opp (Inbox, Inbox) → inbox; sin teléfono entra igual.
    expect(await findBy(ORG_A, "dH4gmbAyjfj4f6TzNbvU")).toMatchObject({
      stage: "inbox",
      phoneE164: null,
    });
    // Marissa sin teléfono.
    expect((await findBy(ORG_A, "DkjVSookyfaDLUPRb6wk"))?.phoneE164).toBeNull();

    // Ninguna etiqueta de sistema llegó a la BD.
    const leaked = all.flatMap((r) => r.tags).filter(
      (t) =>
        /^wa:\s*\d+$/i.test(t) ||
        /-ad-lead-whatsapp$/i.test(t) ||
        t.toLowerCase() === "inbound whatsapp" ||
        t.toLowerCase() === "another-device-replied-whatsapp",
    );
    expect(leaked).toEqual([]);
  });

  it("es idempotente: reimportar actualiza, no duplica", async () => {
    await importParsedContacts(db, ORG_A, parse());
    const second = await importParsedContacts(db, ORG_A, parse());
    expect(second).toMatchObject({ imported: 0, updated: 8 });
    expect(await contactsOf(ORG_A)).toHaveLength(8);
  });

  it("un re-sync NO resetea la etapa que el equipo ya movió en el kanban", async () => {
    await importParsedContacts(db, ORG_A, parse());
    // Marianalr83 estaba en inbox; el equipo la mueve a 'compra'.
    await db
      .update(s.contacts)
      .set({ stage: "compra" })
      .where(
        and(
          eq(s.contacts.organizationId, ORG_A),
          eq(s.contacts.ghlContactId, "BbEJNSEtefAqziLSmtgG"),
        ),
      );
    await importParsedContacts(db, ORG_A, parse());
    expect((await findBy(ORG_A, "BbEJNSEtefAqziLSmtgG"))?.stage).toBe("compra");
  });

  it("un re-sync con teléfono inválido/ausente NO borra el número válido guardado", async () => {
    const valid = `${header}\ncid-x,Ana,,+525512345678,,,,inbound whatsapp,Mexico,${P} Inbox`;
    const invalid = `${header}\ncid-x,Ana,,555-1234,,,,inbound whatsapp,Mexico,${P} Inbox`;
    const missing = `${header}\ncid-x,Ana,,,,,,inbound whatsapp,Mexico,${P} Inbox`;

    await importParsedContacts(db, ORG_A, parse(valid));
    expect((await findBy(ORG_A, "cid-x"))?.phoneE164).toBe("+525512345678");

    const res = await importParsedContacts(db, ORG_A, parse(invalid));
    expect(res).toMatchObject({ imported: 0, updated: 1, invalidPhones: 1 });
    expect((await findBy(ORG_A, "cid-x"))?.phoneE164).toBe("+525512345678");

    await importParsedContacts(db, ORG_A, parse(missing));
    expect((await findBy(ORG_A, "cid-x"))?.phoneE164).toBe("+525512345678");
  });

  it("unrecognizedStages cuenta solo inserts degradados, no re-syncs", async () => {
    const csv = `${header}\ncid-z,Ana,,+525512345678,,,,inbound whatsapp,Mexico,open Otro Pipeline Ganado`;
    const parsed = parse(csv);
    const first = await importParsedContacts(db, ORG_A, parsed);
    expect(first).toMatchObject({ imported: 1, updated: 0, unrecognizedStages: 1 });
    expect((await findBy(ORG_A, "cid-z"))?.stage).toBe("inbox");

    const second = await importParsedContacts(db, ORG_A, parsed);
    expect(second).toMatchObject({ imported: 0, updated: 1, unrecognizedStages: 0 });
  });

  it("aísla por organización: importar en A no toca B", async () => {
    await importParsedContacts(db, ORG_A, parse());
    expect(await contactsOf(ORG_A)).toHaveLength(8);
    expect(await contactsOf(ORG_B)).toHaveLength(0);
  });

  it("importa por lotes cruzando el límite de batch (1,200 filas) y es idempotente", async () => {
    const P = "open Embudo de ventas Diluvium";
    const lines = [header];
    for (let i = 0; i < 1200; i++) {
      const stage = i % 100 === 0 ? "Compra" : "Inbox";
      lines.push(
        `bulk-${i},Nombre${i},,+52551234${String(i).padStart(4, "0")},,,,inbound whatsapp,Mexico,${P} ${stage}`,
      );
    }
    const parsed = parse(lines.join("\n"));

    const first = await importParsedContacts(db, ORG_A, parsed);
    expect(first).toMatchObject({ imported: 1200, updated: 0 });
    expect(await contactsOf(ORG_A)).toHaveLength(1200);
    const { and: andOp } = await import("drizzle-orm");
    const compras = await db
      .select()
      .from(s.contacts)
      .where(andOp(eq(s.contacts.organizationId, ORG_A), eq(s.contacts.stage, "compra")));
    expect(compras).toHaveLength(12); // i = 0,100,...,1100

    const second = await importParsedContacts(db, ORG_A, parsed);
    expect(second).toMatchObject({ imported: 0, updated: 1200 });
    expect(await contactsOf(ORG_A)).toHaveLength(1200);
  });

  it("colapsa Contact Id duplicados dentro del mismo archivo (gana el último)", async () => {
    const P = "open Embudo de ventas Diluvium";
    const csv = [
      header,
      `dup-1,Primero,,+525512340001,,,,inbound whatsapp,Mexico,${P} Inbox`,
      `dup-1,Ultimo,,+525512340002,,,,inbound whatsapp,Mexico,${P} Compra`,
    ].join("\n");
    const res = await importParsedContacts(db, ORG_A, parse(csv));
    expect(res).toMatchObject({ imported: 1, updated: 0 });
    const c = await findBy(ORG_A, "dup-1");
    expect(c).toMatchObject({ firstName: "Ultimo", phoneE164: "+525512340002", stage: "compra" });
  });
});
