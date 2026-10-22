// Envío blindado (22-oct-2026, docs/fase-d-diseno.md §12) contra una base real (TEST_DATABASE_URL):
// el archivo sale desde la copia en Zernio si el bucket no lo entrega; sin ninguno, la corrida
// espera hasta 10 min; si WhatsApp no lo pudo bajar, sale una vez más desde el otro origen.
// Proveedor, bucket y fetch son dobles; la cola de BullMQ se sustituye (sin Redis).
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { MessagingProvider, SendMediaInput } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock("@/lib/queue/workflows", () => ({
  enqueueWorkflowRun: async () => true,
  reviveWorkflowRun: async () => "added",
}));

const COPY = "https://media.zernio.com/temp/123_tabla.png";

class ProbedStorage implements ObjectStorage {
  bucketUp = true;
  async putStream(_key: string, body: Readable) {
    for await (const _ of body) void _;
  }
  async exists() {
    return true;
  }
  async head() {
    return { bytes: 1, contentType: null };
  }
  async deleteObject() {}
  async getBytes(): Promise<Uint8Array> {
    throw new Error("no usado");
  }
  async signedGetUrl(key: string) {
    return `https://bucket.test/${key}?firma=1`;
  }
  async probeSignedUrl() {
    return this.bucketUp ? { ok: true as const } : { ok: false as const, reason: "respondió 403" };
  }
}

describe.skipIf(!TEST_DATABASE_URL)("envío blindado", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let ex: typeof import("./executor");
  let media: typeof import("@/lib/media-library/service");
  let rescue: typeof import("./media-rescue");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_blindado";
  const CONTACT = "c_blindado";
  const CONV = "conv_blindado";
  const storage = new ProbedStorage();
  let sent: SendMediaInput[];
  let zernioUp: boolean;

  const provider = {
    name: "zernio",
    verifyWebhook: () => true,
    readEnvelope: () => ({ eventId: "x", event: "x" }),
    normalize: () => ({ kind: "ignored", eventId: "x", event: "x", reason: "test" }),
    fetchMedia: async () => new Response(null),
    sendText: async () => ({ providerInternalId: "zt", providerMessageId: `wamid.t${Math.random()}` }),
    sendMedia: async (input: SendMediaInput) => {
      sent.push(input);
      return { providerInternalId: `z${sent.length}`, providerMessageId: `wamid.${sent.length}` };
    },
    sendTemplate: async () => {
      throw new Error("no se esperaba sendTemplate");
    },
    listTemplates: async () => [],
    createTemplate: async () => ({ providerTemplateId: null, status: "PENDING" }),
  } satisfies MessagingProvider;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ex = await import("./executor");
    media = await import("@/lib/media-library/service");
    rescue = await import("./media-rescue");
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    sent = [];
    storage.bucketUp = true;
    zernioUp = true;
    // La copia de Zernio se prueba con fetch: solo responde la URL de la copia.
    vi.stubGlobal("fetch", (async (input: URL | string) => {
      if (String(input) !== COPY) throw new Error(`fetch inesperado ${String(input)}`);
      return new Response("x", { status: zernioUp ? 206 : 404 });
    }) as typeof fetch);
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate workflow_runs, workflow_steps, workflows, media_assets, ai_config, ai_agent_notices, webhook_events, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_v", name: "Paty", email: "p@x.mx" });
    await db.insert(s.channels).values({ id: "ch_b", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana", lastName: "López", phoneE164: "+526681112233", stage: "prospecto" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: "ch_b",
      providerConversationId: "zconv",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
      lastMessageAt: new Date(),
      agentState: "activo",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function assetWithCopy(copyAge = 86_400_000) {
    const a = await media.storeUploadedAsset(storage, {
      organizationId: ORG,
      userId: null,
      title: "Tabla",
      fileName: "tabla.png",
      mimeType: "image/png",
      declaredBytes: 11,
      body: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])]),
    });
    await db.update(s.mediaAssets).set({ zernioCopyUrl: COPY, zernioCopyAt: new Date(Date.now() - copyAge) }).where(eq(s.mediaAssets.id, a.id));
    return a;
  }
  async function workflow(assetId: string) {
    const id = crypto.randomUUID();
    await db.insert(s.workflows).values({ id, organizationId: ORG, slug: `wf_${id.slice(0, 6)}`, name: "Tabla de tamaños", enabled: true, triggerCommand: "/tabla" });
    await db.insert(s.workflowSteps).values({ id: crypto.randomUUID(), organizationId: ORG, workflowId: id, position: 0, kind: "send_media", payload: { kind: "send_media", assetId, title: "Tabla", caption: "Tamaños" } });
    return id;
  }
  const run = (id: string) => db.select().from(s.workflowRuns).where(eq(s.workflowRuns.id, id)).then((r) => r[0]);
  const outs = () => db.select().from(s.messages).where(eq(s.messages.direction, "out"));
  const notices = () => db.select().from(s.aiAgentNotices).where(eq(s.aiAgentNotices.conversationId, CONV));

  it("el bucket no entrega (llaves cambiadas, 21-oct): la imagen sale desde la copia en Zernio", async () => {
    const a = await assetWithCopy();
    storage.bucketUp = false;
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: await workflow(a.id), conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => x.url)).toEqual([COPY]);
    const [m] = await outs();
    expect(m.metadata).toMatchObject({ origenArchivo: "zernio" });
    expect(m.attachments[0].storageKey).toContain(`org/${ORG}/library/`); // la burbuja se sigue viendo desde el bucket
  });

  it("ninguno entrega: la corrida espera en la fila (sin burbuja ni intento gastado) y sale cuando vuelve el bucket", async () => {
    const a = await assetWithCopy();
    storage.bucketUp = false;
    zernioUp = false;
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: await workflow(a.id), conversationId: CONV, trigger: "agent" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("deferred");
    const held = await run(start.runId);
    expect(held).toMatchObject({ status: "queued", stepCursor: 0, attempts: 0, errorCode: "media_unavailable" });
    expect(held.payload).toHaveProperty("archivoEnEsperaDesde");
    expect(await outs()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    // El barrido rápido (5 s) no la retoma antes del minuto; después sí.
    expect(await ex.staleQueuedRuns(new Date(Date.now() + 10_000), 5_000)).not.toContain(start.runId);
    expect(await ex.staleQueuedRuns(new Date(Date.now() + ex.MEDIA_RETRY_MS + 1_000), 5_000)).toContain(start.runId);
    storage.bucketUp = true;
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent).toHaveLength(1);
    expect(await run(start.runId)).toMatchObject({ status: "done", errorCode: null });
  });

  it("pasados 10 min sin poder preparar el archivo: no sale tarde; falla con su tarjeta", async () => {
    const a = await assetWithCopy();
    storage.bucketUp = false;
    zernioUp = false;
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: await workflow(a.id), conversationId: CONV, trigger: "agent" });
    await db
      .update(s.workflowRuns)
      .set({ payload: { archivoEnEsperaDesde: new Date(Date.now() - ex.MEDIA_HOLD_MS - 1_000).toISOString() } })
      .where(eq(s.workflowRuns.id, start.runId));
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("failed");
    expect(await run(start.runId)).toMatchObject({ status: "failed", errorCode: "media_unavailable" });
    expect(sent).toHaveLength(0);
    expect((await notices()).map((n) => n.body).join(" ")).toContain("ni el almacenamiento ni la copia de respaldo");
  });

  async function failedStatus(wamid: string) {
    const { ZernioProvider } = await import("@/lib/messaging/zernio");
    const ingest = await import("@/lib/messaging/ingest");
    const payload = { id: `st_${crypto.randomUUID()}`, event: "message.failed", message: { platformMessageId: wamid, error: { code: 131053, message: "Media upload error" } }, account: { id: "zacc", platform: "whatsapp" } };
    await db.insert(s.webhookEvents).values({ id: `zernio_${payload.id}`, provider: "zernio", event: payload.event, payload });
    await ingest.processWebhookEvent(new ZernioProvider({ apiKey: "k", webhookSecret: "s" }), `zernio_${payload.id}`, {
      onOutboundMediaFailed: (failed) => rescue.rescueFailedMedia({ provider, storage }, failed),
    });
  }

  it("WhatsApp no pudo bajar la imagen (131053): sale UNA vez más desde la copia, sin tarjeta; si también falla, tarjeta", async () => {
    const a = await assetWithCopy();
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: await workflow(a.id), conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent[0].url).toContain("bucket.test");
    const original = ex.stepMessageId(start.runId, 0);

    await failedStatus("wamid.1");
    expect(sent.map((x) => x.url)).toEqual([expect.stringContaining("bucket.test"), COPY]);
    expect(sent[1].caption).toBe("Tamaños");
    const rescueId = rescue.rescueMessageId(original);
    const byId = Object.fromEntries((await outs()).map((m) => [m.id, m]));
    expect(byId[original]).toMatchObject({ status: "failed", metadata: expect.objectContaining({ rescate: expect.objectContaining({ messageId: rescueId }) }) });
    expect(byId[rescueId]).toMatchObject({ status: "sent", metadata: expect.objectContaining({ rescateDe: original, origenArchivo: "zernio" }) });
    expect((await run(start.runId)).messageIds).toContain(rescueId);
    expect(await notices()).toHaveLength(0);

    // El rescate también falla: ya no hay otro; queda la tarjeta de siempre.
    await failedStatus("wamid.2");
    expect(sent).toHaveLength(2);
    expect((await notices()).map((n) => n.body)).toEqual([expect.stringContaining("No le llegó al cliente la imagen de Tabla de tamaños")]);
  });

  it("un aviso que llega pasados 10 min ya no se rescata (llegaría fuera de la plática): tarjeta", async () => {
    const a = await assetWithCopy();
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: await workflow(a.id), conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    await db.update(s.messages).set({ sentAt: new Date(Date.now() - rescue.RESCUE_WINDOW_MS - 1_000) }).where(eq(s.messages.id, ex.stepMessageId(start.runId, 0)));
    await failedStatus("wamid.1");
    expect(sent).toHaveLength(1);
    expect(await notices()).toHaveLength(1);
  });
});
