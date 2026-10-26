// Chat sin Agente IA (26-oct-2026, chat propio del dueño) contra Postgres REAL: dos chats iguales con un
// mensaje del cliente sin contestar ni leer; el del contacto marcado `sin_agente_ia` queda fuera de todo
// (programar la respuesta, barrido de huérfanos y alarma, la respuesta misma, lector y su indicador) y el
// otro sigue igual. Los modelos son falsos y fallan si se llaman. Solo corre con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Chat sin Agente IA (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let lector: typeof import("./lector");
  let lectorWorker: typeof import("./lector-worker");
  let sweep: typeof import("./sweep");
  let schedule: typeof import("./schedule");
  let run: typeof import("./run");
  let hooks: typeof import("./hooks");
  let lectorStatus: typeof import("@/lib/agente-ia/lector-status-store");

  const ORG = "org_sin_ia";
  const CH = "ch_sin_ia";
  const MIN = 60_000;
  // NORMAL: un cliente cualquiera. PROPIO: el contacto marcado (chat propio del dueño).
  const NORMAL = { contact: "contact_normal", conv: "conv_normal" };
  const PROPIO = { contact: "contact_propio", conv: "conv_propio" };
  const ago = (ms: number) => new Date(Date.now() - ms);

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    lector = await import("./lector");
    lectorWorker = await import("./lector-worker");
    sweep = await import("./sweep");
    schedule = await import("./schedule");
    run = await import("./run");
    hooks = await import("./hooks");
    lectorStatus = await import("@/lib/agente-ia/lector-status-store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate ai_usage, ai_agent_notices, ai_config, messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-sin-ia", createdAt: new Date() });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_sin_ia", displayName: "Diluvium", aiAgentMode: "auto" });
    const wrote = ago(10 * MIN);
    for (const [i, c] of [NORMAL, PROPIO].entries()) {
      await db.insert(s.contacts).values({ id: c.contact, organizationId: ORG, firstName: "Cliente", phoneE164: `+52668111000${i}`, sinAgenteIa: c === PROPIO });
      await db.insert(s.conversations).values({
        id: c.conv,
        organizationId: ORG,
        contactId: c.contact,
        channelId: CH,
        providerConversationId: `zconv_${c.conv}`,
        lastMessageAt: wrote,
        lastInboundAt: wrote,
        windowExpiresAt: new Date(wrote.getTime() + 24 * 60 * MIN),
      });
      await db.insert(s.messages).values({
        id: `m_${c.conv}`,
        organizationId: ORG,
        conversationId: c.conv,
        direction: "in",
        source: "contact",
        type: "text",
        body: "¿Cuánto cuesta para 96 cm?",
        providerMessageId: `wamid.${c.conv}`,
        status: "received",
        sentAt: wrote,
        createdAt: wrote,
      });
    }
  });

  const noModel = async (): Promise<never> => {
    throw new Error("el modelo no debe llamarse en un chat sin Agente IA");
  };
  const kv: import("./queue").KvPort = {
    setNxPx: async () => true,
    setEx: async () => undefined,
    getDel: async () => null,
    delIfEquals: async () => undefined,
  };

  it("lector: el barrido no lo toma y ni «Despertar» lo lee (sin llamar al modelo ni dejar gasto)", async () => {
    const due = (await lectorWorker.findDueConversations(new Date())).map((r) => r.conversationId);
    expect(due).toContain(NORMAL.conv);
    expect(due).not.toContain(PROPIO.conv);
    const deps = { now: () => new Date(), callModel: noModel, resolveImage: async () => null, kv };
    expect(await lector.runLector(ORG, PROPIO.conv, deps, { force: true, despertar: true })).toEqual({ kind: "nada_nuevo" });
    expect(await db.select().from(s.aiUsage)).toHaveLength(0);
  });

  it("indicador del Detalle: sin línea (nunca «leerá el chat…»); el otro chat sí la tiene", async () => {
    const noLocks = async () => new Set<string>();
    expect(await lectorStatus.loadLectorStatus(ORG, PROPIO.contact, new Date(), noLocks)).toEqual({ status: null, conversationIds: [] });
    expect((await lectorStatus.loadLectorStatus(ORG, NORMAL.contact, new Date(), noLocks)).status).not.toBeNull();
  });

  it("respuesta: no se programa al llegar el mensaje ni la recoge el barrido (tampoco cuenta para la alarma)", async () => {
    const added: string[] = [];
    const queue: import("./queue").AgentQueuePort = {
      getJob: async () => undefined,
      add: async (data) => void added.push(data.conversationId),
    };
    for (const c of [NORMAL, PROPIO]) {
      await hooks.onInboundCustomerMessage({ organizationId: ORG, conversationId: c.conv, receivedAt: ago(10 * MIN), messageId: `m_${c.conv}` }, { queue, kv });
    }
    expect(added).toEqual([NORMAL.conv]);
    expect(await schedule.debounceDelayFor(ORG, PROPIO.conv, new Date())).toBeNull();
    expect(await schedule.debounceDelayFor(ORG, NORMAL.conv, new Date())).not.toBeNull();
    const orphans = (await sweep.findOrphanConversations(new Date())).map((r) => r.conversationId);
    expect(orphans).toEqual([NORMAL.conv]);
  });

  it("respuesta: si de todos modos corre (job viejo, «Reintentar»), se salta antes de leer nada", async () => {
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel: noModel,
      sendBubble: noModel,
      sleep: async () => undefined,
      resolveImage: async () => null,
      startWorkflow: noModel,
      isModelAvailable: () => true,
    };
    expect(await run.runAgent({ organizationId: ORG, conversationId: PROPIO.conv }, deps)).toEqual({ kind: "skipped", reason: "sin_agente_ia" });
    expect(await db.select().from(s.aiUsage)).toHaveLength(0);
  });
});
