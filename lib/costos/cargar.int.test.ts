// Reporte de costos contra Postgres real: el estimado de Meta (mensajes cobrables del mes en hora de Mazatlán,
// 72 h gratis por anuncio, 1,000 de servicio gratis por número, sin Instagram ni pruebas ni lo importado) y las
// ventas del mes. Otra organización no cuenta. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("reporte de costos (base real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let meta: typeof import("./meta-estimado");
  let cargar: typeof import("./cargar");
  let mes: typeof import("./mes");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");
  const ORG = "org_costos";
  const OTRA = "org_costos_b";
  const HOUR = 3_600_000;
  // 10-oct-2026 12:00 en Mazatlán.
  const T = new Date("2026-10-10T19:00:00Z");
  let seq = 0;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    meta = await import("./meta-estimado");
    cargar = await import("./cargar");
    mes = await import("./mes");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate messages, templates, conversations, channels, contacts, funnel_stages, organization cascade`);
    for (const org of [ORG, OTRA]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
      await db.insert(s.channels).values([
        { id: `wa_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `wa_${org}`, displayName: "W" },
        { id: `ig_${org}`, organizationId: org, type: "instagram", provider: "zernio", providerAccountId: `ig_${org}`, displayName: "I" },
        { id: `pr_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `pr_${org}`, displayName: "P", isTest: true },
      ]);
      await db.insert(s.templates).values([
        { id: `t1_${org}`, organizationId: org, channelId: `wa_${org}`, name: "promo", language: "es_MX", category: "MARKETING", status: "APPROVED" },
        { id: `t2_${org}`, organizationId: org, channelId: `wa_${org}`, name: "aviso", language: "es_MX", category: "utility", status: "APPROVED" },
      ]);
      await stagesMod.listFunnelStages(org);
    }
  });

  async function chat(opts: { org?: string; canal?: "wa" | "ig" | "pr"; stage?: string; stageChangedAt?: Date; prueba?: boolean } = {}) {
    const org = opts.org ?? ORG;
    const n = ++seq;
    await db.insert(s.contacts).values({ id: `c${n}`, organizationId: org, firstName: "X", phoneE164: `+5255100000${n}`, stage: opts.stage ?? "inbox", stageChangedAt: opts.stageChangedAt ?? T, esPrueba: opts.prueba ?? false });
    await db.insert(s.conversations).values({ id: `v${n}`, organizationId: org, contactId: `c${n}`, channelId: `${opts.canal ?? "wa"}_${org}`, lastMessageAt: T });
    return { org, conv: `v${n}` };
  }

  type Msg = {
    at: Date;
    dir?: "in" | "out";
    type?: "text" | "template" | "system_note";
    template?: string;
    status?: "delivered" | "read" | "sent" | "failed" | "received";
    source?: "ai_agent" | "business_app" | "contact";
    anuncio?: boolean;
    importado?: boolean;
  };
  function fila(c: { org: string; conv: string }, m: Msg) {
    const n = ++seq;
    const dir = m.dir ?? "out";
    return {
      id: `m${n}`, organizationId: c.org, conversationId: c.conv, direction: dir, source: m.source ?? (dir === "in" ? "contact" : "ai_agent"),
      type: m.type ?? (m.template ? "template" : "text"), templateName: m.template ?? null, body: "x", status: m.status ?? (dir === "in" ? "received" : "delivered"),
      providerMessageId: `w${n}`, sentAt: m.at, createdAt: m.at, adReferral: m.anuncio ? { source_id: "ad1" } : null, importedAt: m.importado ? m.at : null,
    } as const;
  }
  async function mensajes(c: { org: string; conv: string }, ms: Msg[]) {
    await db.insert(s.messages).values(ms.map((m) => fila(c, m)));
  }

  it("cuenta lo cobrable de Meta en el mes y lo demás no", async () => {
    // Llegó por anuncio: 72 h gratis desde la primera respuesta (1 h después).
    const anuncio = await chat();
    await mensajes(anuncio, [
      { at: T, dir: "in", anuncio: true },
      { at: new Date(T.getTime() + HOUR) },
      { at: new Date(T.getTime() + 10 * HOUR), template: "promo" },
      { at: new Date(T.getTime() + 80 * HOUR), template: "promo" }, // ya fuera de las 72 h: se cobra
      { at: new Date(T.getTime() + 81 * HOUR), template: "aviso" }, // utilidad (categoría en minúsculas)
    ]);
    // Sin anuncio: 1,002 respuestas normales → 2 pasan de las 1,000 gratis del mes.
    const normal = await chat();
    await mensajes(normal, Array.from({ length: 1002 }, (_, i) => ({ at: new Date(T.getTime() + i * 60_000) })));
    // No cuentan: fallido, solo enviado, importado, del celular, nota del sistema.
    await mensajes(normal, [
      { at: T, template: "promo", status: "failed" },
      { at: T, template: "promo", status: "sent" },
      { at: T, template: "promo", importado: true },
      { at: T, template: "promo", source: "business_app" },
      { at: T, type: "system_note" },
    ]);
    // Bordes del mes en hora de Mazatlán: 31-oct 22:00 sí; 30-sep 22:00 no.
    await mensajes(normal, [
      { at: new Date("2026-11-01T05:00:00Z"), template: "promo" },
      { at: new Date("2026-10-01T05:00:00Z"), template: "promo" },
    ]);
    // Instagram, canal de pruebas y otra organización no cuentan.
    await mensajes(await chat({ canal: "ig" }), [{ at: T, template: "promo" }]);
    await mensajes(await chat({ canal: "pr" }), [{ at: T, template: "promo" }]);
    await mensajes(await chat({ org: OTRA }), [{ at: T, template: "promo" }]);

    expect(await meta.contarMetaCobrables(db, ORG, "2026-10-01", "2026-10-31")).toEqual({ marketing: 2, utilidad: 1, servicio: 2 });
  });

  it("ventas: contactos que hoy están en la etapa de venta y entraron en el mes (sin los de prueba)", async () => {
    const stages = await stagesMod.listFunnelStages(ORG);
    const venta = stages.find((x) => x.role === "venta_cerrada")!.key;
    const otra = stages.find((x) => x.role === "cerca_compra")!.key;
    await chat({ stage: venta, stageChangedAt: T });
    await chat({ stage: venta, stageChangedAt: new Date("2026-11-01T05:00:00Z") }); // 31-oct en Mazatlán
    await chat({ stage: venta, stageChangedAt: new Date("2026-10-01T05:00:00Z") }); // 30-sep en Mazatlán
    await chat({ stage: otra, stageChangedAt: T });
    await chat({ stage: venta, stageChangedAt: T, prueba: true }); // contacto de prueba
    const ventaOtra = (await stagesMod.listFunnelStages(OTRA)).find((x) => x.role === "venta_cerrada")!.key;
    await chat({ org: OTRA, stage: ventaOtra, stageChangedAt: T });

    expect(await cargar.contarVentas(db, ORG, mes.mesDe("2026-10"))).toBe(2);
  });

  it("arma el reporte completo de la organización sin lecturas de cobro", async () => {
    const r = await cargar.cargarReporte(db, { id: ORG, name: "Diluvium" }, mes.mesDe("2026-10"), new Date("2026-11-03T16:00:00Z"), null);
    expect(r.renglones.map((x) => [x.servicio, x.usd])).toEqual([
      ["IA · Anthropic", 0],
      ["IA · OpenAI", 0],
      ["Railway", null],
      ["Zernio", null],
      ["Meta (WhatsApp)", 0],
    ]);
    expect(r.sinDato).toEqual(["Railway", "Zernio"]);
    expect(r.ventas).toBe(0);
  });
});
