// Cliente de prueba de staging (30-oct-2026) contra Postgres REAL: se crea solo (ventana siempre abierta),
// lo que escribe entra como un webhook de Zernio, lo que se le manda no toca la red y «Empezar de nuevo» lo deja
// limpio. En producción no existe. Solo con TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.REDIS_URL;
process.env.ZERNIO_API_KEY ??= "k_prueba";
process.env.ZERNIO_WEBHOOK_SECRET ??= "s_prueba";

const queued = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/queue/inbound", () => ({
  enqueueInbound: async (id: string) => {
    queued.ids.push(id);
    return true;
  },
}));

const ORG = "org_sim";

describe.skipIf(!TEST_DATABASE_URL)("Cliente de prueba de staging (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./simulador-store");
  let sim: typeof import("./simulador");
  let ingest: typeof import("./ingest");
  let send: typeof import("./send");
  let messaging: typeof import("./index");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./simulador-store");
    sim = await import("./simulador");
    ingest = await import("./ingest");
    send = await import("./send");
    messaging = await import("./index");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    queued.ids = [];
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    await db.execute(d.sql`truncate webhook_events, messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-sim", createdAt: new Date() });
  });

  const conv = async () => (await db.select().from(s.conversations).where(d.eq(s.conversations.id, sim.SIMULADOR.conversationId)))[0];
  const msgs = async () => db.select().from(s.messages).where(d.eq(s.messages.conversationId, sim.SIMULADOR.conversationId)).orderBy(s.messages.createdAt);

  it("se crea solo, idempotente, de prueba, con el Agente IA encendido y la ventana siempre abierta", async () => {
    expect(await store.asegurarClienteDePrueba(ORG)).toBe(sim.SIMULADOR.conversationId);
    expect(await store.asegurarClienteDePrueba(ORG)).toBe(sim.SIMULADOR.conversationId);
    const [ch] = await db.select().from(s.channels).where(d.eq(s.channels.organizationId, ORG));
    expect(ch).toMatchObject({ id: sim.SIMULADOR.channelId, isTest: true, aiAgentMode: "auto", providerAccountId: sim.SIMULADOR.accountId });
    expect((await conv()).windowExpiresAt?.getUTCFullYear()).toBe(2100);
    expect(await db.select().from(s.contacts).where(d.eq(s.contacts.organizationId, ORG))).toHaveLength(1);
  });

  it("lo que escribe como cliente entra como un webhook de Zernio; la ventana sigue abierta", async () => {
    await store.escribirComoCliente(ORG, "Hola, ¿cuánto cuesta para 96 cm?");
    expect(queued.ids).toHaveLength(1);
    await ingest.processWebhookEvent(messaging.messagingProvider(), queued.ids[0]);
    const m = await msgs();
    expect(m.map((x) => [x.direction, x.source, x.body])).toEqual([["in", "contact", "Hola, ¿cuánto cuesta para 96 cm?"]]);
    expect((await conv()).windowExpiresAt?.getUTCFullYear()).toBe(2100);
    expect(await db.select().from(s.contacts).where(d.eq(s.contacts.organizationId, ORG))).toHaveLength(1);
  });

  it("lo que se le manda sale «enviado» sin tocar la red", async () => {
    await store.asegurarClienteDePrueba(ORG);
    const r = await send.sendTextMessage(messaging.messagingProvider(), { organizationId: ORG, conversationId: sim.SIMULADOR.conversationId, text: "Claro, son $5,500." });
    expect(r.status).toBe("sent");
    const [m] = await msgs();
    expect(m.providerMessageId).toMatch(/^wamid\.sim\./);
  });

  it("«Empezar de nuevo» borra su chat y lo deja como nuevo", async () => {
    await store.asegurarClienteDePrueba(ORG);
    await send.sendTextMessage(messaging.messagingProvider(), { organizationId: ORG, conversationId: sim.SIMULADOR.conversationId, text: "Hola" });
    await db.update(s.contacts).set({ stage: "interesado" }).where(d.eq(s.contacts.id, sim.SIMULADOR.contactId));
    await store.reiniciarClienteDePrueba(ORG);
    expect(await msgs()).toEqual([]);
    const [c] = await db.select().from(s.contacts).where(d.eq(s.contacts.id, sim.SIMULADOR.contactId));
    expect(c.stage).not.toBe("interesado");
    expect((await conv()).windowExpiresAt?.getUTCFullYear()).toBe(2100);
  });

  it("en producción no existe", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    try {
      expect(await store.asegurarClienteDePrueba(ORG)).toBeNull();
      await expect(store.escribirComoCliente(ORG, "hola")).rejects.toThrow("solo existe en staging");
      expect(await db.select().from(s.channels)).toEqual([]);
    } finally {
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
    }
  });
});
