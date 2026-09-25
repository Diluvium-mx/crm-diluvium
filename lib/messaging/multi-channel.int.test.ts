// Enrutamiento multi-canal contra Postgres REAL. El proveedor y el bucket son
// dobles: ninguna llamada sale a Zernio ni a almacenamiento externo.
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MessagingProvider,
  SendMediaInput,
  SendTemplateInput,
  SendTextInput,
} from "./provider";
import type { ObjectStorage } from "@/lib/storage/s3";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

// El test ejecuta la corrida directamente; Redis no participa.
vi.mock("@/lib/queue/workflows", () => ({
  enqueueWorkflowRun: async () => true,
  reviveWorkflowRun: async () => "added",
}));

type ProviderCall =
  | { kind: "text"; input: SendTextInput }
  | { kind: "media"; input: SendMediaInput }
  | { kind: "template"; input: SendTemplateInput };

class MemoryStorage implements ObjectStorage {
  async putStream(_key: string, body: Readable) {
    for await (const _ of body) void _;
  }
  async exists() {
    return true;
  }
  async head() {
    return { bytes: 3, contentType: "image/png" };
  }
  async deleteObject() {}
  async getBytes(): Promise<Uint8Array> {
    throw new Error("no usado");
  }
  async signedGetUrl(key: string) {
    return `https://bucket.test/${key}?firma=multi`;
  }
}

describe.skipIf(!TEST_DATABASE_URL)("mensajería con varios canales (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let send: typeof import("./send");
  let ingest: typeof import("./ingest");
  let dispatch: typeof import("@/lib/scheduled/dispatch");
  let executor: typeof import("@/lib/workflows/executor");
  let calls: ProviderCall[];
  let provider: MessagingProvider;
  const storage = new MemoryStorage();

  const ORG = "org_multi";
  const USER = "u_multi";
  const NOW = new Date("2026-09-25T18:00:00Z");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    send = await import("./send");
    ingest = await import("./ingest");
    dispatch = await import("@/lib/scheduled/dispatch");
    executor = await import("@/lib/workflows/executor");
    const { ZernioProvider } = await import("./zernio");
    const normalizer = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
    provider = {
      name: "zernio",
      verifyWebhook: () => true,
      readEnvelope: normalizer.readEnvelope.bind(normalizer),
      normalize: normalizer.normalize.bind(normalizer),
      fetchMedia: async () => new Response(null),
      sendText: async (input) => {
        calls.push({ kind: "text", input });
        const n = calls.length;
        return { providerInternalId: `zmsg_text_${n}`, providerMessageId: `wamid.MULTI.TEXT.${n}` };
      },
      sendMedia: async (input) => {
        calls.push({ kind: "media", input });
        const n = calls.length;
        return { providerInternalId: `zmsg_media_${n}`, providerMessageId: `wamid.MULTI.MEDIA.${n}` };
      },
      sendTemplate: async (input) => {
        calls.push({ kind: "template", input });
        const n = calls.length;
        return { providerInternalId: `zmsg_template_${n}`, providerMessageId: `wamid.MULTI.TEMPLATE.${n}` };
      },
      listTemplates: async () => [],
      createTemplate: async () => ({ providerTemplateId: null, status: "PENDING" }),
    };
  });

  beforeEach(async () => {
    calls = [];
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, media_assets, scheduled_messages, webhook_events, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Multi", slug: "multi", createdAt: new Date() });
    await db.insert(s.user).values({ id: USER, name: "Vendedora", email: "multi@test.mx" });
    await db.insert(s.member).values({ id: "member_multi", organizationId: ORG, userId: USER, role: "agent", createdAt: new Date() });
    await db.insert(s.channels).values([
      {
        id: "ch_1",
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "zacc_1",
        displayName: "Canal uno",
      },
      {
        id: "ch_2",
        organizationId: ORG,
        type: "whatsapp",
        provider: "zernio",
        providerAccountId: "zacc_2",
        displayName: "Canal dos",
      },
    ]);
    await db.insert(s.contacts).values([
      { id: "contact_1", organizationId: ORG, firstName: "Uno", phoneE164: "+526682410001" },
      { id: "contact_2", organizationId: ORG, firstName: "Dos", phoneE164: "+526672410002" },
    ]);
    await db.insert(s.conversations).values([
      {
        id: "conv_1",
        organizationId: ORG,
        contactId: "contact_1",
        channelId: "ch_1",
        providerConversationId: "zc1",
        windowExpiresAt: new Date(NOW.getTime() + 20 * 3_600_000),
        lastMessageAt: NOW,
      },
      {
        id: "conv_2",
        organizationId: ORG,
        contactId: "contact_2",
        channelId: "ch_2",
        providerConversationId: "zc2",
        windowExpiresAt: new Date(NOW.getTime() + 20 * 3_600_000),
        lastMessageAt: NOW,
      },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("texto, media, plantilla, programado y workflow usan la cuenta de su conversación", async () => {
    await db.insert(s.templates).values([
      {
        id: "tpl_1",
        organizationId: ORG,
        channelId: "ch_1",
        name: "bienvenida_uno",
        language: "es_MX",
        body: "Hola",
        status: "APPROVED",
      },
      {
        id: "tpl_2",
        organizationId: ORG,
        channelId: "ch_2",
        name: "bienvenida_dos",
        language: "es_MX",
        body: "Hola dos",
        status: "APPROVED",
      },
    ]);
    await db.insert(s.mediaAssets).values({
      id: "asset_multi",
      organizationId: ORG,
      kind: "image",
      title: "Imagen",
      fileName: "imagen.png",
      mimeType: "image/png",
      bytes: 3,
      storageKey: `org/${ORG}/library/asset_multi-imagen.png`,
    });

    await send.sendTextMessage(provider, {
      organizationId: ORG,
      conversationId: "conv_1",
      sentByUserId: USER,
      text: "Texto uno",
      now: NOW,
    });
    await send.sendMediaMessage(provider, storage, {
      organizationId: ORG,
      conversationId: "conv_2",
      sentByUserId: USER,
      assetId: "asset_multi",
      caption: "Media dos",
      now: NOW,
    });
    await send.sendTemplateMessage(provider, {
      organizationId: ORG,
      conversationId: "conv_1",
      sentByUserId: USER,
      templateId: "tpl_1",
      variableValues: [],
      now: NOW,
    });

    const beforeRejected = calls.length;
    await expect(
      send.sendTemplateMessage(provider, {
        organizationId: ORG,
        conversationId: "conv_2",
        sentByUserId: USER,
        templateId: "tpl_1",
        variableValues: [],
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "template_not_found" });
    expect(calls).toHaveLength(beforeRejected);

    const sendAt = new Date(NOW.getTime() - 1_000);
    await db.insert(s.scheduledMessages).values({
      id: "scheduled_conv_2",
      organizationId: ORG,
      conversationId: "conv_2",
      createdByUserId: USER,
      kind: "text",
      body: "Programado dos",
      sendAt,
      programmedAt: new Date(NOW.getTime() - 60_000),
      cancelIfInbound: false,
    });
    expect(await dispatch.dispatchScheduled(provider, "scheduled_conv_2", sendAt.getTime(), NOW)).toBe("sent");

    await db.insert(s.workflows).values({
      id: "wf_multi",
      organizationId: ORG,
      slug: "wf_multi",
      name: "Workflow multi",
      enabled: true,
    });
    await db.insert(s.workflowSteps).values({
      id: "wf_step_multi",
      organizationId: ORG,
      workflowId: "wf_multi",
      position: 0,
      kind: "send_text",
      payload: { kind: "send_text", text: "Workflow uno" },
    });
    const run = await executor.startWorkflowRun({
      organizationId: ORG,
      workflowId: "wf_multi",
      conversationId: "conv_1",
      trigger: "command",
      triggeredByUserId: USER,
      now: NOW,
    });
    expect(await executor.executeWorkflowRun(run.runId, { provider, storage, now: () => NOW })).toBe("done");

    expect(calls.map(({ kind, input }) => [kind, input.providerAccountId, input.providerConversationId])).toEqual([
      ["text", "zacc_1", "zc1"],
      ["media", "zacc_2", "zc2"],
      ["template", "zacc_1", "zc1"],
      ["text", "zacc_2", "zc2"],
      ["text", "zacc_1", "zc1"],
    ]);
  });

  it("seis entrantes concurrentes se normalizan, no se duplican y cada respuesta vuelve por su canal", async () => {
    // Se quitan las conversaciones base para que todos los contactos nazcan por webhook.
    await db.delete(s.conversations);
    await db.delete(s.contacts);
    const samples = [
      { phone: "5216682411001", canonical: "+526682411001", account: "zacc_1", channel: "ch_1" },
      { phone: "+5216672411002", canonical: "+526672411002", account: "zacc_2", channel: "ch_2" },
      { phone: "+525512341003", canonical: "+525512341003", account: "zacc_1", channel: "ch_1" },
      { phone: "523312341004", canonical: "+523312341004", account: "zacc_2", channel: "ch_2" },
      { phone: "+528112341005", canonical: "+528112341005", account: "zacc_1", channel: "ch_1" },
      { phone: "+14155552671", canonical: "+14155552671", account: "zacc_2", channel: "ch_2" },
    ];
    const payloads = samples.map((sample, index) => ({
      id: `evt_multi_in_${index}`,
      event: "message.received",
      timestamp: new Date(NOW.getTime() + index * 1_000).toISOString(),
      message: {
        id: `zmsg_multi_in_${index}`,
        conversationId: `zconv_multi_${index}`,
        platform: "whatsapp",
        platformMessageId: `wamid.MULTI.IN.${index}`,
        direction: "incoming",
        text: `hola ${index}`,
        attachments: [],
        sender: { id: sample.phone, name: `Cliente ${index}`, phoneNumber: sample.phone },
        sentAt: new Date(NOW.getTime() + index * 1_000).toISOString(),
      },
      conversation: { id: `zconv_multi_${index}`, participantId: sample.phone, participantName: `Cliente ${index}` },
      account: { id: sample.account, platform: "whatsapp" },
    }));
    await db.insert(s.webhookEvents).values(
      payloads.map((raw) => ({ id: `zernio_${raw.id}`, provider: "zernio" as const, event: raw.event, payload: raw })),
    );
    await Promise.all(payloads.map((raw) => ingest.processWebhookEvent(provider, `zernio_${raw.id}`)));

    const contacts = await db.select().from(s.contacts);
    const conversations = await db.select().from(s.conversations);
    const messages = await db.select().from(s.messages);
    expect(contacts).toHaveLength(6);
    expect(messages).toHaveLength(6);
    expect(conversations).toHaveLength(6);
    expect(contacts.map((c) => c.phoneE164).sort()).toEqual(samples.map((smp) => smp.canonical).sort());
    expect(contacts.every((c) => !c.phoneE164?.startsWith("+521"))).toBe(true);
    expect(new Set(contacts.map((c) => c.phoneE164)).size).toBe(6);

    for (const [index, sample] of samples.entries()) {
      const conv = conversations.find((row) => row.providerConversationId === `zconv_multi_${index}`);
      expect(conv?.channelId).toBe(sample.channel);
    }
    expect(conversations.filter((c) => c.channelId === "ch_1")).toHaveLength(3);
    expect(conversations.filter((c) => c.channelId === "ch_2")).toHaveLength(3);

    calls = [];
    await Promise.all(
      conversations.map((conversation) =>
        send.sendTextMessage(provider, {
          organizationId: ORG,
          conversationId: conversation.id,
          sentByUserId: USER,
          text: `respuesta a ${conversation.providerConversationId}`,
          now: new Date(NOW.getTime() + 60_000),
        }),
      ),
    );
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.kind).toBe("text");
      const index = Number(call.input.providerConversationId.replace("zconv_multi_", ""));
      expect(call.input.providerAccountId).toBe(samples[index].account);
    }
  });
});
