import { describe, expect, it, vi } from "vitest";
import { parseGhlContactsCsv, type SourceChannel } from "./ghl-contacts-csv";

// Resuelve el alias de Next dentro de este test usando la implementación real.
vi.mock("@/lib/phone", () => import("../phone"));

const header = "Contact Id,First Name,Last Name,Phone,Email,Tags";

describe("parseGhlContactsCsv", () => {
  it("mapea y recorta una fila completa sin conservar las tags", () => {
    expect(
      parseGhlContactsCsv(
        `${header}\n id-1 , Ana , López , +52 (55) 1234-5678 , ana@example.com ,"inbound whatsapp, vip, wa:opted_in"`,
      ),
    ).toEqual({
      rows: [{
        ghlContactId: "id-1",
        firstName: "Ana",
        lastName: "López",
        phoneE164: "+525512345678",
        phoneInvalid: false,
        email: "ana@example.com",
        sourceChannel: "whatsapp",
      }],
      skipped: [],
      totalRows: 1,
    });
  });

  it.each(["", "   "])("incluye una fila con Last Name vacío (%j)", (lastName) => {
    const result = parseGhlContactsCsv(`${header}\n1,Ana,${lastName},,,`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lastName).toBeNull();
    expect(result.skipped).toEqual([]);
  });

  it.each(["", "   "])("no marca como inválido un teléfono vacío (%j)", (phone) => {
    const result = parseGhlContactsCsv(`${header}\n1,Ana,,${phone},,`);
    expect(result.rows[0]).toMatchObject({ phoneE164: null, phoneInvalid: false });
    expect(result.skipped).toEqual([]);
  });

  it("conserva la fila con teléfono inválido", () => {
    const result = parseGhlContactsCsv(`${header}\n1,Ana,,555-1234,,`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ phoneE164: null, phoneInvalid: true });
    expect(result.skipped).toEqual([]);
  });

  it("normaliza un teléfono con prefijo internacional 00", () => {
    const result = parseGhlContactsCsv(`${header}\n1,Ana,,00525512345678,,`);
    expect(result.rows[0]).toMatchObject({ phoneE164: "+525512345678", phoneInvalid: false });
  });

  it.each(["", "   "])("omite una fila sin Contact Id (%j)", (id) => {
    expect(parseGhlContactsCsv(`${header}\n${id},Ana,,,,`)).toEqual({
      rows: [], skipped: [{ rowNumber: 1, reason: "Falta Contact Id" }], totalRows: 1,
    });
  });

  it.each(["", "   "])("omite una fila sin First Name (%j)", (name) => {
    expect(parseGhlContactsCsv(`${header}\n1,${name},,,,`)).toEqual({
      rows: [], skipped: [{ rowNumber: 1, reason: "Falta First Name" }], totalRows: 1,
    });
  });

  const channelCases: [string, SourceChannel | null][] = [
    ["wa:opted_in", "whatsapp"],
    ["inbound whatsapp", "whatsapp"],
    ["fb-ad-lead-whatsapp", "whatsapp"],
    ["another-device-replied-whatsapp", "whatsapp"],
    ["instagram-dm", "instagram"],
    ["ig-lead", "instagram"],
    ["fb-lead", "fb"],
    ["facebook-ad", "fb"],
    ["VIP", null],
    ["cliente-frecuente", null],
    ["", null],
    ["   ", null],
    ["VIP, cliente-frecuente", null],
    [" FB:lead ", "fb"],
    [" IG:lead ", "instagram"],
    [" WA:opted_in ", "whatsapp"],
    ["INBOUND WHATSAPP", "whatsapp"],
    ["INSTAGRAM-DM", "instagram"],
    ["FACEBOOK-AD", "fb"],
    ["campaign-FB-AD-2026", "fb"],
    ["fb-lead, instagram-dm, wa:opted_in", "whatsapp"],
    ["wa:opted_in, instagram-dm, fb-lead", "whatsapp"],
    ["fb-lead, ig-lead", "instagram"],
    ["ig-lead, fb-lead", "instagram"],
    ["awa:lead, xig-lead, xfb:lead", null],
  ];

  it.each(channelCases)("deriva Tags %j como %j", (tags, channel) => {
    const result = parseGhlContactsCsv(`${header}\n1,Ana,,,,"${tags}"`);
    expect(result.rows[0].sourceChannel).toBe(channel);
  });

  it("normaliza espacios y mayúsculas de todos los headers", () => {
    const result = parseGhlContactsCsv(
      " Contact Id ,first name, LAST NAME , PHONE , eMaIl , TAGS \n1,Ana,López,+525512345678,a@example.com,ig-lead",
    );
    expect(result).toEqual(parseGhlContactsCsv(
      `${header}\n1,Ana,López,+525512345678,a@example.com,ig-lead`,
    ));
  });

  it("acepta columnas opcionales ausentes", () => {
    expect(parseGhlContactsCsv("Contact Id,First Name\n1,Ana").rows).toEqual([{
      ghlContactId: "1", firstName: "Ana", lastName: null,
      phoneE164: null, phoneInvalid: false, email: null, sourceChannel: null,
    }]);
  });

  it.each([
    ["First Name\nAna", "Falta Contact Id"],
    ["Contact Id\n1", "Falta First Name"],
  ])("omite filas si falta una columna requerida: %j", (csv, reason) => {
    expect(parseGhlContactsCsv(csv)).toEqual({
      rows: [], skipped: [{ rowNumber: 1, reason }], totalRows: 1,
    });
  });

  it.each(["", "   "])("convierte Email vacío (%j) a null", (email) => {
    expect(parseGhlContactsCsv(`${header}\n1,Ana,,,${email},`).rows[0].email).toBeNull();
  });

  it("conserva Email sin validar su formato", () => {
    expect(parseGhlContactsCsv(`${header}\n1,Ana,,, no-es-email ,`).rows[0].email)
      .toBe("no-es-email");
  });

  it.each(["", header, `${header}\n\n`])("devuelve cero filas para CSV sin datos (%j)", (csv) => {
    expect(parseGhlContactsCsv(csv)).toEqual({ rows: [], skipped: [], totalRows: 0 });
  });

  it("respeta comas, comillas escapadas y saltos de línea dentro de celdas", () => {
    const result = parseGhlContactsCsv(`${header}\n1,"Ana, ""Anita""\nMaría",,,,\n2,,,,,`);
    expect(result.rows[0].firstName).toBe('Ana, "Anita"\nMaría');
    expect(result.skipped).toEqual([{ rowNumber: 2, reason: "Falta First Name" }]);
    expect(result.totalRows).toBe(2);
  });

  it("cuenta y clasifica un export GHL mixto de siete filas", () => {
    const csv = `${header}
ghl-1,Ana,López,+52 55 1234 5678,ana@example.com,"facebook-ad, inbound whatsapp"

ghl-2,Luis,,555-1234,luis@example.com,instagram-dm
ghl-3,Marta,Pérez,,,VIP
ghl-4,   ,Ruiz,+525512345678,,wa:opted_in
,Pedro,Díaz,+525512345678,,fb-lead
ghl-6,Elena,Ríos,00525587654321,elena@example.com,fb-lead
ghl-7,José,Vega,+525512345679,,"cliente-frecuente, VIP"
`;
    const result = parseGhlContactsCsv(csv);
    expect(result.totalRows).toBe(7);
    expect(result.rows).toHaveLength(5);
    expect(result.skipped).toEqual([
      { rowNumber: 4, reason: "Falta First Name" },
      { rowNumber: 5, reason: "Falta Contact Id" },
    ]);
    expect(result.rows.length + result.skipped.length).toBe(result.totalRows);
    expect(result.rows.filter((row) => row.phoneInvalid)).toHaveLength(1);
    expect(result.rows.filter((row) => row.phoneE164 !== null)).toHaveLength(3);
    expect(result.rows.map((row) => row.sourceChannel))
      .toEqual(["whatsapp", "instagram", null, "fb", null]);
  });
});
