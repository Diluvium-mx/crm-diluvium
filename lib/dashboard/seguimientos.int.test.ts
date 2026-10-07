// Tarjeta «Seguimientos del Agente IA» contra Postgres real: cuenta lo que salió en el periodo (días de
// Mazatlán), quién contestó (72 h), quién avanzó de etapa y quién compró; los fallidos aparte; otra
// organización y fuera del periodo no cuentan. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("followUpStats (Dashboard)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let q: typeof import("./seguimientos");
  let stagesMod: typeof import("@/lib/contacts/funnel-stages");
  const ORG = "org_dseg";
  const OTRA = "org_dseg_b";
  const HOUR = 3_600_000;
  // Lunes 5-oct-2026 18:00 en Mazatlán (UTC-7) = 01:00 UTC del martes.
  const T = new Date("2026-10-06T01:00:00Z");
  let seq = 0;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    q = await import("./seguimientos");
    stagesMod = await import("@/lib/contacts/funnel-stages");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate follow_ups, messages, conversations, channels, contacts, funnel_stages, organization cascade`);
    for (const org of [ORG, OTRA]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
      await db.insert(s.channels).values({ id: `ch_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `acc_${org}`, displayName: "W" });
      await stagesMod.listFunnelStages(org);
    }
  });

  async function chat(opts: { org?: string; caso: string; at: Date; etapa?: string; status?: "delivered" | "failed"; reply?: Date; stage?: string; stageChangedAt?: Date }) {
    const org = opts.org ?? ORG;
    const n = ++seq;
    await db.insert(s.contacts).values({ id: `c${n}`, organizationId: org, firstName: "X", phoneE164: `+5255000000${n}`, stage: opts.stage ?? "inbox", stageChangedAt: opts.stageChangedAt ?? new Date(opts.at.getTime() - 48 * HOUR) });
    await db.insert(s.conversations).values({ id: `v${n}`, organizationId: org, contactId: `c${n}`, channelId: `ch_${org}`, lastMessageAt: opts.at });
    await db.insert(s.followUps).values({ id: `f${n}`, organizationId: org, conversationId: `v${n}`, contactId: `c${n}`, caso: opts.caso, timeZone: "America/Mazatlan", basedOnMessageAt: opts.at, ensayo: false });
    await db.insert(s.messages).values({
      id: `m${n}`, organizationId: org, conversationId: `v${n}`, direction: "out", source: "ai_agent", type: "text", body: "Hola", status: opts.status ?? "delivered",
      providerMessageId: `w${n}`, sentAt: opts.at, createdAt: opts.at, metadata: { seguimiento: { followUpId: `f${n}`, intento: 1, etapa: opts.etapa ?? "inbox" } },
    });
    if (opts.reply) {
      await db.insert(s.messages).values({ id: `r${n}`, organizationId: org, conversationId: `v${n}`, direction: "in", source: "contact", type: "text", body: "Sí", status: "received", providerMessageId: `wr${n}`, sentAt: opts.reply, createdAt: opts.reply });
    }
  }

  it("cuenta salieron, contestaron, avanzaron y compraron por caso; fallidos aparte; otra org y fuera del periodo no", async () => {
    const stages = await stagesMod.listFunnelStages(ORG);
    const venta = stages.find((x) => x.role === "venta_cerrada")!.key;
    const segunda = [...stages].sort((a, b) => a.position - b.position)[1].key;
    // Contestó a las 2 h y avanzó de etapa.
    await chat({ caso: "faltan_medidas", at: T, reply: new Date(T.getTime() + 2 * HOUR), stage: segunda, stageChangedAt: new Date(T.getTime() + 3 * HOUR) });
    // No contestó a tiempo (5 días después), pero compró.
    await chat({ caso: "faltan_medidas", at: T, reply: new Date(T.getTime() + 120 * HOUR), stage: venta, stageChangedAt: new Date(T.getTime() + 121 * HOUR) });
    // Precio: sin nada.
    await chat({ caso: "precio_sin_respuesta", at: T });
    // Falló: no cuenta como chat, sí como «no se entregó».
    await chat({ caso: "precio_sin_respuesta", at: T, status: "failed" });
    // Otra organización y fuera del periodo.
    await chat({ org: OTRA, caso: "precio_sin_respuesta", at: T });
    await chat({ caso: "precio_sin_respuesta", at: new Date("2026-09-20T18:00:00Z") });

    const out = await q.followUpStats(db, ORG, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(out).toMatchObject({ salieron: 3, fallaron: 1, chats: 3, contestaron: 1, avanzaron: 2, compraron: 1 });
    expect(out.porCaso).toEqual([
      { caso: "faltan_medidas", label: "Faltan medidas", chats: 2, contestaron: 1, avanzaron: 2, compraron: 1 },
      { caso: "precio_sin_respuesta", label: "Precio sin respuesta", chats: 1, contestaron: 0, avanzaron: 0, compraron: 0 },
    ]);
  });

  it("días de Mazatlán: 00:30 del día 1 local (07:30 UTC) cuenta en octubre; 23:30 del 30-sep local no", async () => {
    await chat({ caso: "objecion", at: new Date("2026-10-01T07:30:00Z") });
    await chat({ caso: "objecion", at: new Date("2026-10-01T06:30:00Z") });
    const out = await q.followUpStats(db, ORG, { desde: "2026-10-01", hasta: "2026-10-01" });
    expect(out.salieron).toBe(1);
  });
});
