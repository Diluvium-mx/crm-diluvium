// Señales del Embudo contra Postgres REAL. Solo corre con una base desechable
// migrada; cada caso trunca los datos compartidos porque Vitest serializa archivos.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type MessageInput = {
  conversationId?: string;
  organizationId?: string;
  direction: "in" | "out";
  source?: "contact" | "crm" | "business_app" | "other_api" | "ai_agent";
  type?: "text" | "system_note";
  status?: "queued" | "sent" | "delivered" | "read" | "failed" | "received";
  createdAt: Date;
  sentAt?: Date | null;
  importedAt?: Date | null;
  sentByUserId?: string | null;
};

describe.skipIf(!TEST_DATABASE_URL)("señales del Embudo (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let funnelSignalsForOrg: typeof import("./funnel-signals").funnelSignalsForOrg;

  const ORG = "org_funnel_signals";
  const OTHER_ORG = "org_funnel_signals_other";
  const USER = "user_funnel_signals";
  const CONTACT = "contact_funnel_signals";
  const CONVERSATION = "conversation_funnel_signals";
  const BASE = new Date("2026-09-25T18:00:00.000Z");
  let sequence = 0;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ funnelSignalsForOrg } = await import("./funnel-signals"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_agent_notices, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    sequence = 0;
    await db.insert(s.organization).values([
      { id: ORG, name: "Embudo", slug: "funnel-signals", createdAt: BASE },
      { id: OTHER_ORG, name: "Otro embudo", slug: "funnel-signals-other", createdAt: BASE },
    ]);
    await db.insert(s.user).values({
      id: USER,
      name: "Vendedora",
      email: "funnel-signals@example.test",
    });
    await db.insert(s.channels).values([
      {
        id: "channel_funnel_1",
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "account_funnel_1",
        displayName: "Canal uno",
      },
      {
        id: "channel_funnel_2",
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "account_funnel_2",
        displayName: "Canal dos",
      },
      {
        id: "channel_funnel_other",
        organizationId: OTHER_ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "account_funnel_other",
        displayName: "Canal ajeno",
      },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function seedConversation(input: {
    contactId?: string;
    conversationId?: string;
    organizationId?: string;
    channelId?: string;
    unreadCount?: number;
  } = {}) {
    const organizationId = input.organizationId ?? ORG;
    const contactId = input.contactId ?? CONTACT;
    const conversationId = input.conversationId ?? CONVERSATION;
    await db.insert(s.contacts).values({
      id: contactId,
      organizationId,
      firstName: contactId,
    });
    await db.insert(s.conversations).values({
      id: conversationId,
      organizationId,
      contactId,
      channelId:
        input.channelId ??
        (organizationId === ORG ? "channel_funnel_1" : "channel_funnel_other"),
      unreadCount: input.unreadCount ?? 0,
      lastMessageAt: BASE,
    });
  }

  async function seedSecondConversation(input: {
    contactId?: string;
    conversationId?: string;
    unreadCount?: number;
  } = {}) {
    await db.insert(s.conversations).values({
      id: input.conversationId ?? `${CONVERSATION}_2`,
      organizationId: ORG,
      contactId: input.contactId ?? CONTACT,
      channelId: "channel_funnel_2",
      unreadCount: input.unreadCount ?? 0,
      lastMessageAt: BASE,
    });
  }

  async function message(input: MessageInput) {
    sequence += 1;
    const source =
      input.source ?? (input.direction === "in" ? "contact" : "ai_agent");
    await db.insert(s.messages).values({
      id: `message_funnel_${sequence}`,
      organizationId: input.organizationId ?? ORG,
      conversationId: input.conversationId ?? CONVERSATION,
      direction: input.direction,
      source,
      type: input.type ?? "text",
      body: `Mensaje ${sequence}`,
      status:
        input.status ?? (input.direction === "in" ? "received" : "sent"),
      sentByUserId: input.sentByUserId ?? null,
      sentAt: input.sentAt === undefined ? input.createdAt : input.sentAt,
      importedAt: input.importedAt ?? null,
      createdAt: input.createdAt,
    });
  }

  async function notice(input: {
    kind: string;
    createdAt?: Date;
    resolvedAt?: Date | null;
    conversationId?: string;
    organizationId?: string;
  }) {
    sequence += 1;
    await db.insert(s.aiAgentNotices).values({
      id: `notice_funnel_${sequence}`,
      organizationId: input.organizationId ?? ORG,
      conversationId: input.conversationId ?? CONVERSATION,
      kind: input.kind,
      body: input.kind,
      createdAt: input.createdAt ?? BASE,
      resolvedAt: input.resolvedAt ?? null,
    });
  }

  const plus = (seconds: number) => new Date(BASE.getTime() + seconds * 1_000);

  it("omite un contacto sin señales en modo completo, lo incluye en ceros por ids y acepta una lista vacía", async () => {
    await seedConversation();

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
    expect(await funnelSignalsForOrg(ORG, [CONVERSATION])).toEqual({
      [CONTACT]: { unread: 0, pending: false, urgent: false },
    });
    expect(await funnelSignalsForOrg(ORG, [])).toEqual({});
  });

  it("suma los no leídos de todos los canales del contacto, incluso al apuntar a una sola conversación", async () => {
    await seedConversation({ unreadCount: 2 });
    await seedSecondConversation({ unreadCount: 5 });

    const expected = { [CONTACT]: { unread: 7, pending: false, urgent: false } };
    expect(await funnelSignalsForOrg(ORG)).toEqual(expected);
    expect(await funnelSignalsForOrg(ORG, [CONVERSATION])).toEqual(expected);
  });

  it("marca pending cuando el último mensaje relevante es entrante", async () => {
    await seedConversation();
    await message({ direction: "out", createdAt: plus(1) });
    await message({ direction: "in", createdAt: plus(2) });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.pending).toBe(true);
  });

  it("deja de estar pending después de una respuesta de ai_agent", async () => {
    await seedConversation();
    await message({ direction: "in", createdAt: plus(1) });
    await message({ direction: "out", source: "ai_agent", createdAt: plus(2) });

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
    expect((await funnelSignalsForOrg(ORG, [CONVERSATION]))[CONTACT]?.pending).toBe(false);
  });

  it("una respuesta que no salió (rechazada o en cola) no quita pending; al salir, sí", async () => {
    await seedConversation();
    await message({ direction: "in", createdAt: plus(1) });
    await message({ direction: "out", source: "crm", status: "failed", sentByUserId: USER, createdAt: plus(2) });
    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.pending).toBe(true);

    await message({ direction: "out", source: "crm", status: "queued", sentByUserId: USER, createdAt: plus(3) });
    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.pending).toBe(true);

    await message({ direction: "out", source: "crm", status: "sent", sentByUserId: USER, createdAt: plus(4) });
    expect((await funnelSignalsForOrg(ORG, [CONVERSATION]))[CONTACT]?.pending).toBe(false);
  });

  it("una system_note posterior al entrante no quita pending", async () => {
    await seedConversation();
    await message({ direction: "in", createdAt: plus(1) });
    await message({
      direction: "out",
      source: "crm",
      type: "system_note",
      status: "sent",
      createdAt: plus(2),
    });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.pending).toBe(true);
  });

  it("ignora para pending un último entrante importado", async () => {
    await seedConversation();
    await message({ direction: "out", source: "ai_agent", createdAt: plus(1) });
    await message({
      direction: "in",
      createdAt: plus(2),
      importedAt: plus(3),
    });

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
    expect((await funnelSignalsForOrg(ORG, [CONVERSATION]))[CONTACT]?.pending).toBe(false);
  });

  it.each([
    "cliente_pide_humano",
    "pasar_a_humano",
    "cotejar_deposito",
    "comprobante_dudoso",
    "envio",
    "agente_error",
  ])("marca urgent para un aviso abierto de kind %s", async (kind) => {
    await seedConversation();
    await notice({ kind });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
  });

  it.each(["respuesta_cortada", "guardia"])(
    "un aviso posterior %s no da por atendido un aviso urgente",
    async (kind) => {
      await seedConversation();
      await notice({ kind: "pasar_a_humano", createdAt: plus(1) });
      await notice({ kind, createdAt: plus(2) });

      expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
    },
  );

  it("una respuesta CRM humana, enviada y posterior al aviso quita urgent", async () => {
    await seedConversation();
    await notice({ kind: "pasar_a_humano", createdAt: plus(1) });
    await message({
      direction: "out",
      source: "crm",
      status: "sent",
      sentByUserId: USER,
      createdAt: plus(2),
    });

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
  });

  it("una respuesta business_app posterior al aviso quita urgent", async () => {
    await seedConversation();
    await notice({ kind: "cotejar_deposito", createdAt: plus(1) });
    await message({
      direction: "out",
      source: "business_app",
      status: "delivered",
      createdAt: plus(2),
    });

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
  });

  it("una respuesta humana anterior al aviso no quita urgent", async () => {
    await seedConversation();
    await message({
      direction: "out",
      source: "crm",
      status: "read",
      sentByUserId: USER,
      createdAt: plus(1),
    });
    await notice({ kind: "cliente_pide_humano", createdAt: plus(2) });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
  });

  it.each(["queued", "failed"] as const)(
    "una respuesta humana con status %s no quita urgent",
    async (status) => {
      await seedConversation();
      await notice({ kind: "envio", createdAt: plus(1) });
      await message({
        direction: "out",
        source: "crm",
        status,
        sentByUserId: USER,
        createdAt: plus(2),
      });

      expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
    },
  );

  it("una respuesta posterior de ai_agent no cuenta como humana y no quita urgent", async () => {
    await seedConversation();
    await notice({ kind: "pasar_a_humano", createdAt: plus(1) });
    await message({
      direction: "out",
      source: "ai_agent",
      status: "sent",
      createdAt: plus(2),
    });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
  });

  it("un agente_error resuelto ya no es urgent", async () => {
    await seedConversation();
    await notice({
      kind: "agente_error",
      createdAt: plus(1),
      resolvedAt: plus(2),
    });

    expect(await funnelSignalsForOrg(ORG)).toEqual({});
    expect((await funnelSignalsForOrg(ORG, [CONVERSATION]))[CONTACT]?.urgent).toBe(false);
  });

  it("una respuesta humana importada no quita urgent", async () => {
    await seedConversation();
    await notice({ kind: "comprobante_dudoso", createdAt: plus(1) });
    await message({
      direction: "out",
      source: "business_app",
      status: "read",
      importedAt: plus(3),
      createdAt: plus(2),
    });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]?.urgent).toBe(true);
  });

  it("puede estar urgent y pending al mismo tiempo", async () => {
    await seedConversation();
    await notice({ kind: "cliente_pide_humano", createdAt: plus(1) });
    await message({ direction: "in", createdAt: plus(2) });

    expect((await funnelSignalsForOrg(ORG))[CONTACT]).toEqual({
      unread: 0,
      pending: true,
      urgent: true,
    });
  });

  it("rechaza ids de otra organización y nunca mezcla sus señales", async () => {
    await seedConversation();
    await seedConversation({
      organizationId: OTHER_ORG,
      contactId: "contact_funnel_other",
      conversationId: "conversation_funnel_other",
    });
    await db
      .update(s.conversations)
      .set({ unreadCount: 9 })
      .where((await import("drizzle-orm")).eq(s.conversations.id, "conversation_funnel_other"));
    await notice({
      kind: "pasar_a_humano",
      organizationId: OTHER_ORG,
      conversationId: "conversation_funnel_other",
    });

    expect(await funnelSignalsForOrg(ORG, ["conversation_funnel_other"])).toEqual({});
    expect(await funnelSignalsForOrg(ORG)).toEqual({});
    expect(await funnelSignalsForOrg(OTHER_ORG)).toEqual({
      contact_funnel_other: { unread: 9, pending: false, urgent: true },
    });
  });
});
