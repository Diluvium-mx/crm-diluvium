// Integración del tiempo real: los triggers de la migración 0007 hacen NOTIFY
// en inbox_events y subscribeToInbox reparte por organización. Contra Postgres
// REAL (TEST_DATABASE_URL): valida el SQL del trigger y el aislamiento.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InboxEvent } from "./types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("tiempo real de la bandeja (LISTEN/NOTIFY, Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let subscribeToInbox: typeof import("./events").subscribeToInbox;
  const ORG_A = "org_a";
  const ORG_B = "org_b";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ subscribeToInbox } = await import("./events"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "A", slug: "a", createdAt: new Date() },
      { id: ORG_B, name: "B", slug: "b", createdAt: new Date() },
    ]);
    for (const org of [ORG_A, ORG_B]) {
      await db.insert(s.channels).values({
        id: `ch_${org}`,
        organizationId: org,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: `zacc_${org}`,
        displayName: "D",
      });
      await db.insert(s.contacts).values({ id: `c_${org}`, organizationId: org, firstName: "C", phoneE164: `+521${org}` });
    }
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  // Espera hasta `n` eventos o hasta el timeout.
  function collect(): { events: InboxEvent[]; wait: (n: number, ms?: number) => Promise<void> } {
    const events: InboxEvent[] = [];
    const wait = (n: number, ms = 2000) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (events.length >= n) return resolve();
          if (Date.now() - started > ms) return reject(new Error(`solo llegaron ${events.length} de ${n} eventos`));
          setTimeout(tick, 20);
        };
        tick();
      });
    return { events, wait };
  }

  it("un mensaje nuevo emite message.upserted a su organización, no a otra", async () => {
    const a = collect();
    const b = collect();
    const offA = await subscribeToInbox(ORG_A, (e) => a.events.push(e));
    const offB = await subscribeToInbox(ORG_B, (e) => b.events.push(e));
    try {
      await db.insert(s.conversations).values({ id: "conv_a", organizationId: ORG_A, contactId: "c_org_a", channelId: "ch_org_a" });
      await db.insert(s.messages).values({
        id: "m_a",
        organizationId: ORG_A,
        conversationId: "conv_a",
        direction: "in",
        source: "contact",
        type: "text",
        body: "hola",
        status: "received",
        sentAt: new Date(),
      });
      // conv_a: conversation.updated (insert) + message.upserted (insert).
      await a.wait(2);
      expect(a.events).toContainEqual({ type: "message.upserted", conversationId: "conv_a", messageId: "m_a" });
      expect(a.events).toContainEqual({ type: "conversation.updated", conversationId: "conv_a" });
      // La organización B no recibió NADA.
      expect(b.events).toHaveLength(0);
    } finally {
      offA();
      offB();
    }
  });

  it("borrar un mensaje (eco que gana la carrera) emite message.deleted", async () => {
    const a = collect();
    const off = await subscribeToInbox(ORG_A, (e) => a.events.push(e));
    try {
      await db.insert(s.conversations).values({ id: "conv_d", organizationId: ORG_A, contactId: "c_org_a", channelId: "ch_org_a" });
      await db.insert(s.messages).values({
        id: "m_d",
        organizationId: ORG_A,
        conversationId: "conv_d",
        direction: "out",
        source: "crm",
        type: "text",
        body: "x",
        status: "queued",
        sentAt: new Date(),
      });
      await db.delete(s.messages).where((await import("drizzle-orm")).eq(s.messages.id, "m_d"));
      // conv.updated (insert) + message.upserted (insert) + message.deleted (delete).
      await a.wait(3);
      expect(a.events).toContainEqual({ type: "message.deleted", conversationId: "conv_d", messageId: "m_d" });
    } finally {
      off();
    }
  });
});
