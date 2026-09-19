import { describe, expect, it, vi } from "vitest";
import {
  parseGhlContactsCsv,
  type ContactStage,
  type ParsedGhlContactRow,
  type ParseGhlContactsCsvResult,
  type SourceChannel,
} from "./ghl-contacts-csv";

// Resuelve el alias de Next dentro de este test usando la implementación real.
vi.mock("@/lib/phone", () => import("../phone"));

// Encabezado REAL del export de GHL (Export_Contacts_*.csv).
const header =
  "Contact Id,First Name,Last Name,Phone,Email,Created,Last Activity,Tags,Country,Opportunities";

const allColumns = {
  lastName: true,
  phone: true,
  email: true,
  tags: true,
  country: true,
  opportunities: true,
};
const noColumns = {
  lastName: false,
  phone: false,
  email: false,
  tags: false,
  country: false,
  opportunities: false,
};

function expectSuccess(
  result: ParseGhlContactsCsvResult,
): asserts result is Extract<ParseGhlContactsCsvResult, { ok: true }> {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("Se esperaba un CSV válido");
}

// Fila de datos con columnas Created/Last Activity presentes (se ignoran) en el
// orden real. Devuelve la línea CSV. Los campos con coma se citan por el caller.
function line(fields: {
  id?: string;
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  tags?: string;
  country?: string;
  opps?: string;
}): string {
  const q = (v: string) => (v.includes(",") ? `"${v}"` : v);
  return [
    fields.id ?? "1",
    fields.first ?? "Ana",
    fields.last ?? "",
    fields.phone ?? "",
    fields.email ?? "",
    "2026-06-08T10:28:39-07:00", // Created (ignorada)
    "Jul 22 2026 02:09 PM", // Last Activity (ignorada)
    q(fields.tags ?? ""),
    fields.country ?? "",
    q(fields.opps ?? ""),
  ].join(",");
}

// Valores por defecto de una fila mapeada.
function row(overrides: Partial<ParsedGhlContactRow>): ParsedGhlContactRow {
  return {
    ghlContactId: "1",
    firstName: "Ana",
    lastName: null,
    phoneE164: null,
    phoneInvalid: false,
    phoneMissing: true,
    email: null,
    country: null,
    sourceChannel: "whatsapp",
    tags: [],
    pipelineStage: null,
    stage: "inbox",
    stageRecognized: true,
    ...overrides,
  };
}

describe("parseGhlContactsCsv (formato real de GHL)", () => {
  it("mapea una fila real completa: canal, tags de negocio, etapa desde Opportunities, país", () => {
    const csv = `${header}\n${line({
      id: "id-1",
      first: "Adrian",
      phone: "+526151557244",
      email: "leydeamper08@gmail.com",
      tags: "inbound whatsapp, fb-ad-lead-whatsapp, wa: 5216682419579, video-instalacion-enviado, another-device-replied-whatsapp",
      country: "Mexico",
      opps: "open Embudo de ventas Diluvium Cerca de compra",
    })}`;
    expect(parseGhlContactsCsv(csv)).toEqual({
      ok: true,
      columnsPresent: allColumns,
      rows: [
        row({
          ghlContactId: "id-1",
          firstName: "Adrian",
          phoneE164: "+526151557244",
          phoneMissing: false,
          email: "leydeamper08@gmail.com",
          country: "Mexico",
          sourceChannel: "fb",
          tags: ["video-instalacion-enviado"],
          pipelineStage: "open Embudo de ventas Diluvium Cerca de compra",
          stage: "cerca_compra",
          stageRecognized: true,
        }),
      ],
      skipped: [],
      totalRows: 1,
    });
  });

  it.each(["", "   "])("marca phoneMissing y no inválido un teléfono vacío (%j)", (phone) => {
    const result = parseGhlContactsCsv(`${header}\n${line({ phone })}`);
    expectSuccess(result);
    expect(result.rows[0]).toMatchObject({
      phoneE164: null,
      phoneInvalid: false,
      phoneMissing: true,
    });
  });

  it("conserva la fila con teléfono inválido (presente pero mal formado)", () => {
    const result = parseGhlContactsCsv(`${header}\n${line({ phone: "555-1234" })}`);
    expectSuccess(result);
    expect(result.rows[0]).toMatchObject({
      phoneE164: null,
      phoneInvalid: true,
      phoneMissing: false,
    });
  });

  it("conserva un teléfono de EE. UU. (+1) sin forzarlo a México", () => {
    const result = parseGhlContactsCsv(`${header}\n${line({ phone: "+16193058746" })}`);
    expectSuccess(result);
    expect(result.rows[0]).toMatchObject({ phoneE164: "+16193058746", phoneInvalid: false });
  });

  it.each(["", "   "])("omite una fila sin Contact Id (%j)", (id) => {
    const result = parseGhlContactsCsv(`${header}\n${line({ id })}`);
    expectSuccess(result);
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ rowNumber: 1, reason: "Falta Contact Id" }]);
  });

  it.each(["", "   "])("omite una fila sin First Name (%j)", (first) => {
    const result = parseGhlContactsCsv(`${header}\n${line({ first })}`);
    expectSuccess(result);
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ rowNumber: 1, reason: "Falta First Name" }]);
  });

  describe("source_channel solo desde los tags de anuncio (separador coma)", () => {
    const channelCases: [string, SourceChannel][] = [
      ["inbound whatsapp, fb-ad-lead-whatsapp, wa: 5216682419579", "fb"],
      ["inbound whatsapp, instagram-ad-lead-whatsapp, wa: 5216682419579", "instagram"],
      ["inbound whatsapp, wa: 5216682419579, medidas enviadas", "whatsapp"],
      ["wa: 5216682419579, another-device-replied-whatsapp", "whatsapp"],
      ["", "whatsapp"],
      ["FB-AD-LEAD-WHATSAPP", "fb"],
      ["Instagram-Ad-Lead-WhatsApp", "instagram"],
      ["fb-ad-lead-whatsapp, instagram-ad-lead-whatsapp", "instagram"],
    ];
    it.each(channelCases)("deriva Tags %j como %j", (tags, channel) => {
      const result = parseGhlContactsCsv(`${header}\n${line({ tags })}`);
      expectSuccess(result);
      expect(result.rows[0].sourceChannel).toBe(channel);
    });
  });

  describe("tags de negocio: conserva y filtra las de sistema", () => {
    it("descarta wa:<numero> (con espacio), inbound whatsapp, another-device y *-ad-lead-whatsapp", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({
          tags: "inbound whatsapp, fb-ad-lead-whatsapp, wa: 5216682419579, another-device-replied-whatsapp",
        })}`,
      );
      expectSuccess(result);
      expect(result.rows[0].tags).toEqual([]);
    });

    it("conserva etiquetas de negocio con texto original (acentos/mayúsculas)", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({
          tags: "inbound whatsapp, Medidas Enviadas, transferencia a humano, wa: 5216682419579",
        })}`,
      );
      expectSuccess(result);
      expect(result.rows[0].tags).toEqual(["Medidas Enviadas", "transferencia a humano"]);
    });

    it("no descarta etiquetas de negocio con prefijo/sufijo parecido al de sistema", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({ tags: "wa: pendiente, tiktok-ad-lead-whatsapp, wa:opted_in" })}`,
      );
      expectSuccess(result);
      expect(result.rows[0].tags).toEqual([
        "wa: pendiente",
        "tiktok-ad-lead-whatsapp",
        "wa:opted_in",
      ]);
      expect(result.rows[0].sourceChannel).toBe("whatsapp");
    });

    it("quita duplicados exactos conservando orden y primer texto", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({ tags: "medidas enviadas, MEDIDAS ENVIADAS, seguimiento" })}`,
      );
      expectSuccess(result);
      expect(result.rows[0].tags).toEqual(["medidas enviadas", "seguimiento"]);
    });
  });

  describe("etapa desde Opportunities: quita el prefijo del pipeline y mapea", () => {
    const PREFIX = "open Embudo de ventas Diluvium";
    const stageCases: [string, ContactStage][] = [
      [`${PREFIX} Inbox`, "inbox"],
      [`${PREFIX} Prospecto`, "prospecto"],
      [`${PREFIX} Interesado`, "interesado"],
      [`${PREFIX} Cerca de compra`, "cerca_compra"],
      [`${PREFIX} Compra`, "compra"],
    ];
    it.each(stageCases)("mapea %j → %j", (opps, stage) => {
      const result = parseGhlContactsCsv(`${header}\n${line({ opps })}`);
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({ stage, stageRecognized: true });
    });

    it("no confunde 'Cerca de compra' con 'Compra'", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({ opps: `${PREFIX} Cerca de compra` })}`,
      );
      expectSuccess(result);
      expect(result.rows[0].stage).toBe("cerca_compra");
    });

    it("con varias oportunidades toma la MÁS AVANZADA", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({
          opps: `${PREFIX} Inbox, ${PREFIX} Compra, ${PREFIX} Prospecto`,
        })}`,
      );
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({ stage: "compra", stageRecognized: true });
    });

    it("varias oportunidades todas Inbox → inbox", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({ opps: `${PREFIX} Inbox, ${PREFIX} Inbox` })}`,
      );
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({ stage: "inbox", stageRecognized: true });
    });

    it("Opportunities vacía → inbox (default), no se marca como no reconocida", () => {
      const result = parseGhlContactsCsv(`${header}\n${line({ opps: "" })}`);
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({
        pipelineStage: null,
        stage: "inbox",
        stageRecognized: true,
      });
    });

    it("Opportunities con valor pero sin etapa reconocible → inbox + stageRecognized=false", () => {
      const result = parseGhlContactsCsv(
        `${header}\n${line({ opps: "open Otro Pipeline Ganado" })}`,
      );
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({ stage: "inbox", stageRecognized: false });
    });

    it.each([
      // Otro pipeline cuyo nombre TERMINA igual: no debe colarse por subcadena.
      "open Otro Embudo de ventas Diluvium Compra",
      // La misma variante SIN status: "Otro" no es un status conocido, así que
      // no puede consumirse como tal (no debe clasificarse como compra).
      "Otro Embudo de ventas Diluvium Compra",
      // Etiqueta conocida en un pipeline totalmente distinto.
      "open Ventas Mostrador Compra",
    ])("no reconoce una etapa de un pipeline ajeno: %j", (opps) => {
      const result = parseGhlContactsCsv(`${header}\n${line({ opps })}`);
      expectSuccess(result);
      expect(result.rows[0]).toMatchObject({ stage: "inbox", stageRecognized: false });
    });
  });

  it("guarda el país y conserva nombres con emoji/minúsculas tal cual", () => {
    const result = parseGhlContactsCsv(
      `${header}\n${line({ id: "a", first: "🤔", country: "Mexico" })}\n${line({
        id: "b",
        first: "teresita",
        last: "noriega",
        country: "United States",
      })}`,
    );
    expectSuccess(result);
    expect(result.rows[0]).toMatchObject({ firstName: "🤔", country: "Mexico" });
    expect(result.rows[1]).toMatchObject({
      firstName: "teresita",
      lastName: "noriega",
      country: "United States",
    });
  });

  it("acepta columnas opcionales ausentes (canal whatsapp, sin tags/país/etapa)", () => {
    expect(parseGhlContactsCsv("Contact Id,First Name\n1,Ana")).toEqual({
      ok: true,
      columnsPresent: noColumns,
      skipped: [],
      totalRows: 1,
      rows: [row({ ghlContactId: "1", firstName: "Ana" })],
    });
  });

  it("detecta cada columna opcional aunque no haya filas de datos", () => {
    expect(
      parseGhlContactsCsv("Contact Id,First Name, eMaIl , TAGS , Country , Opportunities "),
    ).toEqual({
      ok: true,
      rows: [],
      skipped: [],
      totalRows: 0,
      columnsPresent: {
        lastName: false,
        phone: false,
        email: true,
        tags: true,
        country: true,
        opportunities: true,
      },
    });
  });

  it("conserva Email sin validar su formato y lo convierte a null si viene vacío", () => {
    const withEmail = parseGhlContactsCsv(`${header}\n${line({ email: " no-es-email " })}`);
    expectSuccess(withEmail);
    expect(withEmail.rows[0].email).toBe("no-es-email");
    const empty = parseGhlContactsCsv(`${header}\n${line({ email: "" })}`);
    expectSuccess(empty);
    expect(empty.rows[0].email).toBeNull();
  });

  // Las 8 filas reales de referencia (una por etapa + casos borde).
  const sampleReal = `${header}
aBxgRqvijWmQ8Vgi2lgV,Ingeniería,Empresarial,+525540432914,carlos_hdez_m@hotmail.com,2026-06-08T10:28:39-07:00,Jul 22 2026 02:09 PM,"inbound whatsapp, wa: 5216682419579, transferencia a humano, another-device-replied-whatsapp",Mexico,open Embudo de ventas Diluvium Prospecto
5OMR029hnaKCj5bHDl6i,Enrique - griselda (3 compuertas),,+523228886578,arquikeco_72@hotmail.com,2026-06-02T14:28:05-07:00,Jun 03 2026 12:59 PM,"inbound whatsapp, wa: 5216682419579, another-device-replied-whatsapp",Mexico,open Embudo de ventas Diluvium Compra
PFE9k83NAkdatplYtNRh,Ana,Dacasa,+527771091114,,2026-07-15T11:48:17-07:00,Jul 16 2026 12:31 PM,"inbound whatsapp, wa: 5216682419579, medidas enviadas, another-device-replied-whatsapp",Mexico,open Embudo de ventas Diluvium Interesado
LSURQKckw3gIEhnoN5v3,Adrian,,+526151557244,leydeamper08@gmail.com,2026-09-03T15:11:09-07:00,Sep 17 2026 12:03 PM,"inbound whatsapp, fb-ad-lead-whatsapp, wa: 5216682419579, video-instalacion-enviado, another-device-replied-whatsapp",Mexico,open Embudo de ventas Diluvium Cerca de compra
BbEJNSEtefAqziLSmtgG,Marianalr83,,+526671045171,,2026-09-19T12:46:25-07:00,Sep 19 2026 12:46 PM,"inbound whatsapp, instagram-ad-lead-whatsapp, wa: 5216682419579",Mexico,open Embudo de ventas Diluvium Inbox
dH4gmbAyjfj4f6TzNbvU,Diego,Stevenot,,,2026-08-25T13:43:50-07:00,Aug 25 2026 03:49 PM,,Mexico,"open Embudo de ventas Diluvium Inbox, open Embudo de ventas Diluvium Inbox"
bH97HvG4GpQn8Dcreah5,User,,+524521178694,,2026-09-14T09:20:28-07:00,Sep 14 2026 09:20 AM,"wa: 5216682419579, another-device-replied-whatsapp",Mexico,
DkjVSookyfaDLUPRb6wk,Marissa,Orduña rovirosa,,,2026-09-18T21:36:17-07:00,Sep 18 2026 09:37 PM,,Mexico,open Embudo de ventas Diluvium Inbox`;

  it("procesa las 8 filas reales: canal, tags, etapa (incl. multi/vacía) y sin-teléfono", () => {
    const result = parseGhlContactsCsv(sampleReal);
    expectSuccess(result);
    expect(result.totalRows).toBe(8);
    expect(result.rows).toHaveLength(8);
    expect(result.skipped).toEqual([]);

    const byId = Object.fromEntries(result.rows.map((r) => [r.ghlContactId, r]));

    expect(byId["aBxgRqvijWmQ8Vgi2lgV"]).toMatchObject({
      sourceChannel: "whatsapp",
      tags: ["transferencia a humano"],
      stage: "prospecto",
      country: "Mexico",
      email: "carlos_hdez_m@hotmail.com",
    });
    expect(byId["5OMR029hnaKCj5bHDl6i"]).toMatchObject({ stage: "compra", tags: [] });
    expect(byId["PFE9k83NAkdatplYtNRh"]).toMatchObject({
      stage: "interesado",
      tags: ["medidas enviadas"],
    });
    expect(byId["LSURQKckw3gIEhnoN5v3"]).toMatchObject({
      sourceChannel: "fb",
      tags: ["video-instalacion-enviado"],
      stage: "cerca_compra",
    });
    expect(byId["BbEJNSEtefAqziLSmtgG"]).toMatchObject({
      sourceChannel: "instagram",
      stage: "inbox",
    });
    // Multi-oportunidad (Inbox, Inbox) → inbox.
    expect(byId["dH4gmbAyjfj4f6TzNbvU"]).toMatchObject({
      stage: "inbox",
      phoneMissing: true,
    });
    // Opportunities vacía → inbox default, recognized.
    expect(byId["bH97HvG4GpQn8Dcreah5"]).toMatchObject({
      stage: "inbox",
      stageRecognized: true,
      pipelineStage: null,
    });
    // Marissa: sin teléfono, entra igual.
    expect(byId["DkjVSookyfaDLUPRb6wk"]).toMatchObject({
      firstName: "Marissa",
      phoneMissing: true,
      stage: "inbox",
    });

    expect(result.rows.filter((r) => r.phoneMissing)).toHaveLength(2);
    expect(result.rows.filter((r) => r.email)).toHaveLength(3);
    // Ninguna etiqueta de sistema se filtró.
    const leaked = result.rows.flatMap((r) => r.tags).filter(
      (t) =>
        /^wa:\s*\d+$/i.test(t) ||
        /-ad-lead-whatsapp$/i.test(t) ||
        t.toLowerCase() === "inbound whatsapp" ||
        t.toLowerCase() === "another-device-replied-whatsapp",
    );
    expect(leaked).toEqual([]);
  });

  it.each([
    [`${header}\n${line({ id: "1" })}\n2,"Luis`, "MissingQuotes"],
    [`${header}\n1,Ana`, "TooFewFields"],
  ])("rechaza todo el archivo por %s", (csv, code) => {
    expect(parseGhlContactsCsv(csv)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });
});
