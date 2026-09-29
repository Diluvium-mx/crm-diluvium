// Estado del Agente IA en segundo plano para el indicador del Detalle contra Postgres REAL:
// espera con mensajes sin leer, leyendo con el candado, al día / error por la última lectura,
// un contacto con dos chats y nada de otra organización. Solo corre con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("indicador del lector: estado de un contacto (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./lector-status-store");

  const ORG = "org_ind";
  const OTRA = "org_ind_otra";
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const sinCandado = async () => new Set<string>();

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./lector-status-store");
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });
  beforeEach(async () => {
    await db.execute(d.sql`truncate ai_usage, messages, conversations, channels, contacts, organization cascade`);
    for (const org of [ORG, OTRA]) {
      await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
      await db.insert(s.channels).values([
        { id: `ch1_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `z1_${org}`, displayName: "N1" },
        { id: `ch2_${org}`, organizationId: org, type: "whatsapp", provider: "zernio", providerAccountId: `z2_${org}`, displayName: "N2" },
      ]);
    }
    await db.insert(s.contacts).values({ id: "ct", organizationId: ORG, firstName: "Cliente" });
    await db.insert(s.conversations).values({ id: "cv1", organizationId: ORG, contactId: "ct", channelId: `ch1_${ORG}`, lastMessageAt: ago(60), detalleLeidoHasta: ago(60) });
  });

  const usage = (conversationId: string, at: Date, outcome: string) =>
    db.insert(s.aiUsage).values({ id: crypto.randomUUID(), organizationId: ORG, conversationId, stage: "detalle", provider: "openai", modelId: "gpt-5.6-luna", latencyMs: 1, outcome, createdAt: at });

  it("al día con la hora de su última lectura; nada si nunca lo leyó; error si la última falló", async () => {
    expect((await store.loadLectorStatus(ORG, "ct", now, sinCandado)).status).toBeNull();
    await usage("cv1", ago(50), "detalle_aplicado");
    expect((await store.loadLectorStatus(ORG, "ct", now, sinCandado)).status).toEqual({ kind: "al_dia", at: ago(50).toISOString() });
    await usage("cv1", ago(10), "error");
    expect((await store.loadLectorStatus(ORG, "ct", now, sinCandado)).status?.kind).toBe("error");
  });

  it("mensaje sin leer → en espera (con la cuenta del barrido); candado del lector → leyendo; dos chats del contacto", async () => {
    await db.insert(s.conversations).values({ id: "cv2", organizationId: ORG, contactId: "ct", channelId: `ch2_${ORG}`, lastMessageAt: ago(1), detalleLeidoHasta: ago(30) });
    await db.insert(s.messages).values({ id: "m1", organizationId: ORG, conversationId: "cv2", direction: "in", source: "contact", type: "text", body: "hola", status: "received", createdAt: ago(1), sentAt: ago(1) });
    const v = await store.loadLectorStatus(ORG, "ct", now, sinCandado);
    expect(v.conversationIds.sort()).toEqual(["cv1", "cv2"]);
    expect(v.status).toMatchObject({ kind: "espera" });
    expect(v.status?.kind === "espera" && v.status.etaSeconds).toBeGreaterThan(100);
    const leyendo = await store.loadLectorStatus(ORG, "ct", now, async (ids) => new Set(ids.filter((i) => i === "cv2")));
    expect(leyendo.status).toEqual({ kind: "leyendo" });
    // Redis caído: como si nadie leyera (nunca rompe el Detalle).
    const caido = await store.loadLectorStatus(ORG, "ct", now, async () => {
      throw new Error("redis caído");
    });
    expect(caido.status?.kind).toBe("espera");
  });

  it("otra organización: no ve los chats ni el estado de este contacto", async () => {
    await usage("cv1", ago(50), "detalle_aplicado");
    expect(await store.loadLectorStatus(OTRA, "ct", now, sinCandado)).toEqual({ status: null, conversationIds: [] });
  });
});
