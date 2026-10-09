// Ejecutor de workflows contra una base real (TEST_DATABASE_URL). El proveedor
// y el bucket son dobles; la cola de BullMQ se sustituye (sin Redis).
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { MessagingProvider, SendMediaInput, SendTextInput } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

// Sin Redis en los tests: encolar es un no-op (la fila queda "queued").
vi.mock("@/lib/queue/workflows", () => ({
  enqueueWorkflowRun: async () => true,
  reviveWorkflowRun: async () => "added",
}));

class MemoryStorage implements ObjectStorage {
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
}

describe.skipIf(!TEST_DATABASE_URL)("executor de workflows", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let ex: typeof import("./executor");
  let media: typeof import("@/lib/media-library/service");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_wf";
  const CONTACT = "c_wf";
  const CONV = "conv_wf";
  const storage = new MemoryStorage();
  let sent: Array<{ kind: "text" | "media"; input: SendTextInput | SendMediaInput }>;
  let rejectNext: Error | null;

  const provider = {
    name: "zernio",
    verifyWebhook: () => true,
    readEnvelope: () => ({ eventId: "x", event: "x" }),
    normalize: () => ({ kind: "ignored", eventId: "x", event: "x", reason: "test" }),
    fetchMedia: async () => new Response(null),
    sendText: async (input: SendTextInput) => {
      if (rejectNext) {
        const e = rejectNext;
        rejectNext = null;
        throw e;
      }
      sent.push({ kind: "text", input });
      return { providerInternalId: `z${sent.length}`, providerMessageId: `wamid.${sent.length}` };
    },
    sendMedia: async (input: SendMediaInput) => {
      sent.push({ kind: "media", input });
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
    ({ eq } = await import("drizzle-orm"));
  });

  beforeEach(async () => {
    sent = [];
    rejectNext = null;
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate workflow_runs, workflow_steps, workflows, media_assets, ai_config, ai_agent_notices, webhook_events, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_v", name: "Paty", email: "p@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_wf",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc",
      displayName: "Diluvium",
      aiAgentMode: "auto",
    });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Ana", lastName: "López", phoneE164: "+526681112233", stage: "prospecto" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: "ch_wf",
      providerConversationId: "zconv",
      windowExpiresAt: new Date(Date.now() + 20 * 3_600_000),
      lastMessageAt: new Date(),
      agentState: "activo",
    });
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function asset() {
    return media.storeUploadedAsset(storage, {
      organizationId: ORG,
      userId: null,
      title: "Tabla",
      fileName: "tabla.png",
      mimeType: "image/png",
      declaredBytes: 11,
      // Un PNG de verdad (firma + relleno): la Biblioteca revisa los bytes (S2).
      body: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])]),
    });
  }
  async function workflow(steps: import("@/lib/db/schema/automation").WorkflowStepPayload[], opts: Partial<typeof s.workflows.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    await db.insert(s.workflows).values({ id, organizationId: ORG, slug: `wf_${id.slice(0, 6)}`, name: "WF", enabled: true, ...opts });
    await db.insert(s.workflowSteps).values(steps.map((payload, position) => ({ id: crypto.randomUUID(), organizationId: ORG, workflowId: id, position, kind: payload.kind, payload })));
    return id;
  }
  const run = (id: string) => db.select().from(s.workflowRuns).where(eq(s.workflowRuns.id, id)).then((r) => r[0]);
  const contact = () => db.select().from(s.contacts).where(eq(s.contacts.id, CONTACT)).then((r) => r[0]);
  const conv = () => db.select().from(s.conversations).where(eq(s.conversations.id, CONV)).then((r) => r[0]);

  it("comando del vendedor: texto con variables + imagen; sale como crm con el vendedor y queda el rastro", async () => {
    const a = await asset();
    const wf = await workflow([
      { kind: "send_text", text: "Hola {{nombre}}, soy {{vendedor}}. Te comparto la tabla." },
      { kind: "send_media", assetId: a.id, title: "Tabla", caption: "Tabla de tamaños" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(start.status).toBe("queued");
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => x.kind)).toEqual(["text", "media"]);
    expect((sent[0].input as SendTextInput).text).toBe("Hola Ana López, soy Paty. Te comparto la tabla.");
    expect((sent[1].input as SendMediaInput).url).toContain("firma=1");
    const r = await run(start.runId);
    expect(r).toMatchObject({ status: "done", stepCursor: 2 });
    expect(r.messageIds).toHaveLength(2);
    const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(outs.every((m) => m.source === "crm" && m.sentByUserId === "u_v")).toBe(true);
    // Un segundo job del mismo run no lo vuelve a ejecutar (ya no está "queued").
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("not_claimed");
    expect(sent).toHaveLength(2);
  });

  it("canal que no está en auto (borrador u off cuentan igual: apagado): el agente/palabra clave no ejecutan; el comando humano sí", async () => {
    const wf = await workflow([{ kind: "send_text", text: "x" }]);
    await db.update(s.channels).set({ aiAgentMode: "borrador" }).where(eq(s.channels.id, "ch_wf"));
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent" })).toMatchObject({ status: "skipped", reason: ex.SKIP_CHANNEL_OFF });
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_wf"));
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" })).toMatchObject({ status: "skipped", reason: ex.SKIP_CHANNEL_OFF });
    const human = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(human.status).toBe("queued");
    expect(await ex.executeWorkflowRun(human.runId, { provider, storage })).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("archivo faltante o workflow deshabilitado: no se manda nada y queda el motivo", async () => {
    const sinArchivo = await workflow([{ kind: "send_media", assetId: null, title: "Tabla" }]);
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: sinArchivo, conversationId: CONV, trigger: "command" })).toMatchObject({ status: "skipped", reason: ex.SKIP_MISSING_MEDIA });
    const apagado = await workflow([{ kind: "send_text", text: "x" }], { enabled: false });
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: apagado, conversationId: CONV, trigger: "command" })).toMatchObject({ status: "skipped", reason: ex.SKIP_DISABLED });
    expect(sent).toHaveLength(0);
  });

  it("si un vendedor responde a la mitad, la corrida del agente se cancela y no manda lo que falta", async () => {
    const wf = await workflow([
      { kind: "send_text", text: "uno" },
      { kind: "send_text", text: "dos" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", now: new Date(Date.now() - 1_000) });
    // Humano escribe después de creada la corrida.
    await db.insert(s.messages).values({
      id: "m_h",
      organizationId: ORG,
      conversationId: CONV,
      direction: "out",
      source: "crm",
      type: "text",
      body: "yo me encargo",
      status: "sent",
      createdAt: new Date(),
    });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("cancelled");
    expect(sent).toHaveLength(0);
    expect(await run(start.runId)).toMatchObject({ status: "cancelled", errorCode: "respuesta_humana" });
  });

  it("fuera de la ventana de 24 h la corrida falla con ventana_24h y no deja mensajes", async () => {
    await db.update(s.conversations).set({ windowExpiresAt: new Date(Date.now() - 1_000) }).where(eq(s.conversations.id, CONV));
    const wf = await workflow([{ kind: "send_text", text: "x" }]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("failed");
    expect(await run(start.runId)).toMatchObject({ status: "failed", errorCode: ex.FAIL_WINDOW });
    expect(sent).toHaveLength(0);
  });

  it("rechazo del proveedor en el 2º paso: el 1º ya salió, el cursor lo recuerda y la corrida queda failed con el código", async () => {
    const { ZernioSendError } = await import("@/lib/messaging/zernio");
    const wf = await workflow([
      { kind: "send_text", text: "uno" },
      { kind: "send_text", text: "dos" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    // El primer envío pasa; el segundo lo rechaza WhatsApp.
    const orig = provider.sendText;
    let n = 0;
    provider.sendText = async (input) => {
      n++;
      if (n === 2) throw new ZernioSendError(400, "rate_limited", "límite", "rejected");
      return orig(input);
    };
    try {
      expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("failed");
    } finally {
      provider.sendText = orig;
    }
    const r = await run(start.runId);
    expect(r).toMatchObject({ status: "failed", errorCode: "rate_limited", stepCursor: 1 });
    // El id del 2º paso se anota ANTES de mandar (su fila quedó "failed"): 2 ids, 1 enviado.
    expect(r.messageIds).toEqual([ex.stepMessageId(start.runId, 0), ex.stepMessageId(start.runId, 1)]);
    expect(sent).toHaveLength(1);
  });

  it("disparo por etapa: no marca leídos los mensajes del cliente y avisa en el hilo si falla por ventana cerrada", async () => {
    await db.insert(s.messages).values({ id: "m_in", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "¿aguanta 1 metro?", status: "received" });
    await db.update(s.conversations).set({ unreadCount: 1 }).where(eq(s.conversations.id, CONV));
    const wf = await workflow([{ kind: "send_text", text: "datos" }]);
    const ok = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "stage", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(ok.runId, { provider, storage })).toBe("done");
    expect((await conv()).unreadCount).toBe(1); // la pregunta del cliente sigue sin leer
    // Ahora con la ventana cerrada: falla y deja aviso interno visible.
    await db.update(s.conversations).set({ windowExpiresAt: new Date(Date.now() - 1_000) }).where(eq(s.conversations.id, CONV));
    const wf2 = await workflow([{ kind: "send_text", text: "datos" }]);
    const bad = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf2, conversationId: CONV, trigger: "stage", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(bad.runId, { provider, storage })).toBe("failed");
    const notes = await db.select().from(s.messages).where(eq(s.messages.type, "system_note"));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatch(/No se envió .*ventana de 24 h/);
    expect((await conv()).unreadCount).toBe(2); // el aviso sube como no leído
  });

  it("Probar: un workflow deshabilitado corre con allowDisabled solo como comando", async () => {
    const wf = await workflow([{ kind: "send_text", text: "x" }], { enabled: false });
    expect((await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", allowDisabled: true })).status).toBe("queued");
    expect((await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", allowDisabled: true })).status).toBe("skipped");
  });

  it("pasos Esperar: un / del vendedor no espera (sale de inmediato y en orden); agente y palabra clave sí esperan", async () => {
    const wf = await workflow([{ kind: "wait", seconds: 30 }, { kind: "send_text", text: "tabla" }, { kind: "wait", seconds: 5 }, { kind: "send_text", text: "fin" }], {
      triggerKeywords: ["medidas"],
    });
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const cmd = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(cmd.runId, { provider, storage, sleep })).toBe("done");
    expect(waits).toEqual([]);
    expect(sent.map((x) => (x.input as SendTextInput).text)).toEqual(["tabla", "fin"]);

    const kw = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" });
    expect(await ex.executeWorkflowRun(kw.runId, { provider, storage, sleep })).toBe("done");
    const agent = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "m_in_1" });
    expect(await ex.executeWorkflowRun(agent.runId, { provider, storage, sleep })).toBe("done");
    expect(waits).toEqual([30_000, 5_000, 30_000, 5_000]);
  });

  it("barrido rápido: una corrida queued de más de 5 s sin job se lista para re-encolar; la recién creada no", async () => {
    const { QUICK_SWEEP_GRACE_MS } = await import("@/worker/workflows");
    const wf = await workflow([{ kind: "send_text", text: "x" }]);
    const old = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", now: new Date(Date.now() - 6_000) });
    const fresh = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    const ids = await ex.staleQueuedRuns(new Date(), QUICK_SWEEP_GRACE_MS);
    expect(ids).toContain(old.runId);
    expect(ids).not.toContain(fresh.runId);
  });

  it("envío sin confirmar (timeout del proveedor): la corrida se detiene y avisa al vendedor", async () => {
    const { ZernioSendError } = await import("@/lib/messaging/zernio");
    const wf = await workflow([
      { kind: "send_text", text: "datos" },
      { kind: "send_text", text: "segundo" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    const orig = provider.sendText;
    provider.sendText = async () => {
      throw new ZernioSendError(0, "network", "timeout", "unknown");
    };
    try {
      expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("failed");
    } finally {
      provider.sendText = orig;
    }
    expect(await run(start.runId)).toMatchObject({ status: "failed", errorCode: ex.FAIL_UNCONFIRMED, stepCursor: 1 });
    expect((await contact()).stage).toBe("prospecto");
    const notes = await db.select().from(s.messages).where(eq(s.messages.type, "system_note"));
    expect(notes[0].body).toMatch(/no confirmó/);
  });

  it("reinicio del worker a la mitad: con el lease vencido se retoma por cursor sin repetir lo enviado", async () => {
    const wf = await workflow([
      { kind: "send_text", text: "uno" },
      { kind: "send_text", text: "dos" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    // El worker murió tras el primer paso (cursor 1), hace 3 minutos.
    await db.update(s.workflowRuns).set({ status: "running", stepCursor: 1, startedAt: new Date(Date.now() - 3 * 60_000), attempts: 1 }).where(eq(s.workflowRuns.id, start.runId));
    expect(await ex.staleRunningRuns()).toContain(start.runId);
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => (x.input as SendTextInput).text)).toEqual(["dos"]);
    // Con reintentos agotados ya no se retoma: falla.
    const other = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    await db.update(s.workflowRuns).set({ status: "running", startedAt: new Date(Date.now() - 3 * 60_000), attempts: 4 }).where(eq(s.workflowRuns.id, other.runId));
    expect(await ex.failStuckRuns()).toBe(1);
  });

  it("caída ENTRE el 2xx del proveedor y el avance del cursor: el reintento encuentra la fila (id determinista por paso) y no reenvía", async () => {
    const wf = await workflow([
      { kind: "send_text", text: "uno" },
      { kind: "send_text", text: "dos" },
    ]);
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent).toHaveLength(2);
    const run = (await db.select().from(s.workflowRuns).where(eq(s.workflowRuns.id, start.runId)))[0];
    expect(run.messageIds).toEqual([ex.stepMessageId(start.runId, 0), ex.stepMessageId(start.runId, 1)]);
    // El worker murió justo después de mandar "dos" y ANTES de guardar cursor 2: la
    // fila del paso 1 ya existe; al retomar por lease vencido no se vuelve a mandar.
    await db.update(s.workflowRuns).set({ status: "running", stepCursor: 1, startedAt: new Date(Date.now() - 3 * 60_000), attempts: 1 }).where(eq(s.workflowRuns.id, start.runId));
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect(sent).toHaveLength(2);
    expect((await db.select().from(s.messages).where(eq(s.messages.conversationId, CONV))).filter((m) => m.direction === "out")).toHaveLength(2);
  });

  it("Bloque B 3a: reinicio tras una imagen de /banco que quedó FALLIDA: al retomar no cuenta como enviada; se detiene, la etapa no pasa a Cerca de compra y queda el motivo", async () => {
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios", name: "Datos bancarios", triggerCommand: "/banco" });
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    // El worker murió después de que la imagen (id determinista del paso 0) quedó fallida.
    const imgId = ex.stepMessageId(start.runId, 0);
    await db.insert(s.messages).values({ id: imgId, organizationId: ORG, conversationId: CONV, direction: "out", source: "crm", type: "image", status: "failed", errorCode: "131053", errorMessage: "Media upload error", sentByUserId: "u_v" });
    await db.update(s.workflowRuns).set({ status: "running", stepCursor: 0, messageIds: [imgId], startedAt: new Date(Date.now() - 3 * 60_000), attempts: 1 }).where(eq(s.workflowRuns.id, start.runId));
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("failed");
    expect(await run(start.runId)).toMatchObject({ status: "failed", errorCode: "131053" });
    expect((await contact()).stage).toBe("prospecto");
    expect(sent).toHaveLength(0);
    const notes = (await db.select().from(s.messages).where(eq(s.messages.conversationId, CONV))).filter((m) => m.type === "system_note");
    expect(notes.map((n) => n.body)).toEqual(['No se envió "Datos bancarios": WhatsApp no pudo subir el archivo.']);
  });

  it("Bloque B 3b: WhatsApp acepta la imagen de /banco y luego avisa que falló (131053): tarjeta con el motivo y el comando; la etapa no se regresa", async () => {
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios", name: "Datos bancarios", triggerCommand: "/banco" });
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    expect((await contact()).stage).toBe("cerca_compra");
    const { ZernioProvider } = await import("@/lib/messaging/zernio");
    const ingest = await import("@/lib/messaging/ingest");
    const payload = { id: `st_${crypto.randomUUID()}`, event: "message.failed", message: { platformMessageId: "wamid.1", error: { code: 131053, message: "Media upload error" } }, account: { id: "zacc", platform: "whatsapp" } };
    await db.insert(s.webhookEvents).values({ id: `zernio_${payload.id}`, provider: "zernio", event: payload.event, payload });
    await ingest.processWebhookEvent(new ZernioProvider({ apiKey: "k", webhookSecret: "s" }), `zernio_${payload.id}`);
    const notices = await db.select().from(s.aiAgentNotices).where(eq(s.aiAgentNotices.conversationId, CONV));
    expect(notices.map((n) => n.body)).toEqual(["No le llegó al cliente la imagen de Datos bancarios: WhatsApp no pudo subir el archivo. Vuelve a mandarla con /banco."]);
    expect(notices[0].messageId).toBe(ex.stepMessageId(start.runId, 0));
    expect((await contact()).stage).toBe("cerca_compra");
  });

  it("Bloque B 1: un 429 de Zernio en la imagen NO falla la corrida: espera y la manda con la MISMA clave", async () => {
    const { ZernioSendError } = await import("@/lib/messaging/zernio");
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios" });
    const start = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent" });
    const orig = provider.sendMedia;
    const keys: string[] = [];
    provider.sendMedia = async (input) => {
      keys.push(input.idempotencyKey);
      if (keys.length === 1) throw new ZernioSendError(429, "429", "Too many requests", undefined, 1);
      return orig(input);
    };
    try {
      expect(await ex.executeWorkflowRun(start.runId, { provider, storage })).toBe("done");
    } finally {
      provider.sendMedia = orig;
    }
    expect(keys).toEqual([ex.stepMessageId(start.runId, 0), ex.stepMessageId(start.runId, 0)]);
    expect(sent).toHaveLength(1);
    expect((await contact()).stage).toBe("cerca_compra");
    const [img] = await db.select().from(s.messages).where(eq(s.messages.id, ex.stepMessageId(start.runId, 0)));
    expect(img).toMatchObject({ status: "sent", errorCode: null });
    expect((img.metadata as { envio?: { esperas?: number } }).envio?.esperas).toBe(1);
  });

  it("palabra clave: una sola vez por contacto (marca invisible); por comando se manda siempre", async () => {
    const wf = await workflow([{ kind: "send_text", text: "tabla" }]);
    const a = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" });
    expect(a.status).toBe("queued");
    expect(await ex.executeWorkflowRun(a.runId, { provider, storage })).toBe("done");
    expect((await contact()).keywordWorkflowsSent).toEqual([wf]);
    expect((await contact()).tags).toEqual([]); // sin etiqueta visible
    const b = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" });
    expect(b).toMatchObject({ status: "skipped", reason: ex.SKIP_ALREADY_SENT });
    // Dos mensajes seguidos: la segunda corrida ya estaba en cola antes de la marca → la rechaza al reclamar.
    await db.update(s.contacts).set({ keywordWorkflowsSent: [] }).where(eq(s.contacts.id, CONTACT));
    const c = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" });
    await db.update(s.contacts).set({ keywordWorkflowsSent: [wf] }).where(eq(s.contacts.id, CONTACT));
    expect(await ex.executeWorkflowRun(c.runId, { provider, storage })).toBe("cancelled");
    expect(sent).toHaveLength(1);
    // El comando del vendedor no mira la marca.
    const d = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(d.runId, { provider, storage })).toBe("done");
    expect(sent).toHaveLength(2);
  });

  it("dos corridas de la misma conversación no se intercalan: la segunda espera (busy) mientras la primera corre", async () => {
    const wfA = await workflow([{ kind: "send_text", text: "tabla" }]);
    const wfB = await workflow([{ kind: "send_text", text: "banco" }]);
    const a = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wfA, conversationId: CONV, trigger: "command" });
    const b = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wfB, conversationId: CONV, trigger: "command" });
    await db.update(s.workflowRuns).set({ status: "running", startedAt: new Date() }).where(eq(s.workflowRuns.id, a.runId));
    expect(await ex.executeWorkflowRun(b.runId, { provider, storage })).toBe("busy");
    await db.update(s.workflowRuns).set({ status: "done" }).where(eq(s.workflowRuns.id, a.runId));
    expect(await ex.executeWorkflowRun(b.runId, { provider, storage })).toBe("done");
  });

  it("deshabilitar el workflow o apagar el canal mientras la corrida espera: no se ejecuta ningún paso", async () => {
    const wf = await workflow([{ kind: "send_text", text: "x" }]);
    const a = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword" });
    await db.update(s.workflows).set({ enabled: false }).where(eq(s.workflows.id, wf));
    expect(await ex.executeWorkflowRun(a.runId, { provider, storage })).toBe("cancelled");
    expect(await run(a.runId)).toMatchObject({ status: "skipped", errorCode: ex.SKIP_DISABLED });
    await db.update(s.workflows).set({ enabled: true }).where(eq(s.workflows.id, wf));
    const b = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent" });
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_wf"));
    expect(await ex.executeWorkflowRun(b.runId, { provider, storage })).toBe("cancelled");
    expect(sent).toHaveLength(0);
  });

  it("regla del CRM: datos_bancarios (/banco o agente) deja al contacto en Cerca de compra, solo hacia adelante; la etapa del vendedor no se regresa", async () => {
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios" });
    const c1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(c1.runId, { provider, storage })).toBe("done");
    expect(await contact()).toMatchObject({ stage: "cerca_compra", stageChangedBy: "sistema" });
    // El vendedor ya lo puso en Compra: /banco otra vez no lo regresa.
    await db.update(s.contacts).set({ stage: "compra", stageChangedBy: "vendedor" }).where(eq(s.contacts.id, CONTACT));
    const c2 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent" });
    expect(await ex.executeWorkflowRun(c2.runId, { provider, storage })).toBe("done");
    expect(await contact()).toMatchObject({ stage: "compra", stageChangedBy: "vendedor" });
  });

  it("Columnas del Embudo: /banco mueve a la etapa con papel 'Cerca de compra' aunque se renombre o el papel cambie de columna", async () => {
    const fs = await import("@/lib/contacts/funnel-stages");
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios" });
    // Renombrada: misma clave, /banco sigue llegando ahí.
    const cerca = (await fs.listFunnelStages(ORG)).find((x) => x.key === "cerca_compra")!;
    await fs.updateFunnelStage(ORG, cerca.id, { name: "Pago pendiente" });
    const c1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(c1.runId, { provider, storage })).toBe("done");
    expect((await contact()).stage).toBe("cerca_compra");
    // El papel pasa a una etapa NUEVA (antes de Compra): /banco (desde una etapa anterior) mueve a esa.
    await db.update(s.contacts).set({ stage: "inbox", stageChangedBy: null }).where(eq(s.contacts.id, CONTACT));
    const interesado = (await fs.listFunnelStages(ORG)).find((x) => x.key === "interesado")!;
    const nueva = await fs.createFunnelStage(ORG, { name: "Esperando pago", afterId: interesado.id });
    await fs.setFunnelStageRole(ORG, nueva.id, "cerca_compra");
    const c2 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(c2.runId, { provider, storage })).toBe("done");
    expect(await contact()).toMatchObject({ stage: "esperando_pago", stageChangedBy: "sistema" });
  });

  it("la regla de /banco no re-dispara workflows 'al entrar a Cerca de compra' (sin CLABE doble); una etapa movida por el agente dispara corridas 'agent', no humanas", async () => {
    const a = await asset();
    const banco = await workflow([{ kind: "send_media", assetId: a.id, title: "Banco", caption: "Datos" }], { slug: "datos_bancarios", triggerStage: "cerca_compra" });
    const c1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: banco, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(c1.runId, { provider, storage })).toBe("done");
    expect((await contact()).stage).toBe("cerca_compra");
    expect(sent).toHaveLength(1); // ni una segunda corrida por la etapa
    expect(await db.select().from(s.workflowRuns)).toHaveLength(1);
    // El agente mueve a "compra" con un workflow "al entrar a compra": la corrida sale como "agent".
    const { moveStageForward } = await import("@/lib/contacts/stage");
    const wfCompra = await workflow([{ kind: "send_text", text: "gracias por tu compra" }], { triggerStage: "compra" });
    expect(await moveStageForward({ organizationId: ORG, contactId: CONTACT, to: "compra", by: "agente" })).toEqual({ from: "cerca_compra" });
    const r = (await db.select().from(s.workflowRuns)).find((x) => x.workflowId === wfCompra)!;
    expect(r.trigger).toBe("agent");
  });

  it("otra organización no puede disparar ni ejecutar workflows ajenos", async () => {
    const wf = await workflow([{ kind: "send_text", text: "x" }]);
    await expect(ex.startWorkflowRun({ organizationId: "otra", workflowId: wf, conversationId: CONV, trigger: "command" })).rejects.toThrow(/no encontrado/);
  });

  it("barrido: corridas atoradas en running se dan por fallidas; queued viejas se listan para re-encolar", async () => {
    const wf = await workflow([{ kind: "wait", seconds: 1 }]);
    const a = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command" });
    await db.update(s.workflowRuns).set({ status: "running", startedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.workflowRuns.id, a.runId));
    expect(await ex.failStuckRuns()).toBe(1);
    expect(await run(a.runId)).toMatchObject({ status: "failed", errorCode: ex.FAIL_STUCK });
    const b = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", now: new Date(Date.now() - 60_000) });
    expect(await ex.staleQueuedRuns()).toContain(b.runId);
  });
  // ── «Máximo de envíos por chat» (29-sep-2026, decisiones del dueño) ─────────────
  it("máximo por chat: cuenta la FOTO aunque salga dentro de otro workflow; palabra clave y Agente IA no lo pasan; el comando del vendedor sí", async () => {
    const maxChat = await import("./max-per-chat");
    const a = await asset();
    const precio = await workflow([
      { kind: "send_text", text: "Tenemos varios tamaños" },
      { kind: "send_media", assetId: a.id, title: "Tabla", caption: "Estos son los tamaños que manejamos" },
    ]);
    const tabla = await workflow([{ kind: "send_media", assetId: a.id, title: "Tabla", caption: "Aquí le comparto una foto de los tamaños" }], { maxSendsPerChat: 2 });
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "precio", status: "received" });
    // 1.ª foto: dentro de «Precio 2» (palabra clave).
    const p1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: precio, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_1" });
    expect(await ex.executeWorkflowRun(p1.runId, { provider, storage })).toBe("done");
    expect(await maxChat.sendsInChat(ORG, CONV, tabla)).toBe(1);
    // 2.ª foto: la Tabla por el Agente IA.
    const t1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1" });
    expect(t1.status).toBe("queued");
    expect(await ex.executeWorkflowRun(t1.runId, { provider, storage })).toBe("done");
    expect(await maxChat.sendsInChat(ORG, CONV, tabla)).toBe(2);
    // Ya van 2: ni el Agente IA ni la palabra clave la vuelven a mandar.
    await db.insert(s.messages).values({ id: "in_2", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "¿me la pasa otra vez?", status: "received" });
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "agent", triggerMessageId: "in_2" })).toMatchObject({ status: "skipped", reason: ex.SKIP_MAX_PER_CHAT });
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_2" })).toMatchObject({ status: "skipped", reason: ex.SKIP_MAX_PER_CHAT });
    // El comando del vendedor (/tamaños) sí la manda, y suma.
    const cmd = await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v" });
    expect(await ex.executeWorkflowRun(cmd.runId, { provider, storage })).toBe("done");
    expect(await maxChat.sendsInChat(ORG, CONV, tabla)).toBe(3);
    expect(sent.filter((x) => x.kind === "media")).toHaveLength(3);
    // Un envío que falló no cuenta.
    const { and, sql } = await import("drizzle-orm");
    await db.update(s.messages).set({ status: "failed" }).where(and(eq(s.messages.conversationId, CONV), sql`jsonb_array_length(${s.messages.attachments}) > 0`));
    expect(await maxChat.sendsInChat(ORG, CONV, tabla)).toBe(0);
  });

  it("máximo por chat: se revisa también al ARRANCAR (dos corridas en cola con la misma foto: la segunda se salta)", async () => {
    const a = await asset();
    const tabla = await workflow([{ kind: "send_media", assetId: a.id, title: "Tabla" }]);
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "medidas", status: "received" });
    const r1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_1" });
    const r2 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: tabla, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1" });
    expect([r1.status, r2.status]).toEqual(["queued", "queued"]);
    await db.update(s.workflows).set({ maxSendsPerChat: 1 }).where(eq(s.workflows.id, tabla));
    expect(await ex.executeWorkflowRun(r1.runId, { provider, storage })).toBe("done");
    expect(await ex.executeWorkflowRun(r2.runId, { provider, storage })).toBe("cancelled");
    expect(await run(r2.runId)).toMatchObject({ status: "skipped", errorCode: ex.SKIP_MAX_PER_CHAT });
    expect(sent.filter((x) => x.kind === "media")).toHaveLength(1);
  });

  it("máximo por chat sin archivos: cuenta sus corridas que mandaron algo; con una en cola ya no se crea otra", async () => {
    const maxChat = await import("./max-per-chat");
    const wf = await workflow([{ kind: "send_text", text: "Hacemos envíos a todo México" }], { maxSendsPerChat: 1 });
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "envíos?", status: "received" });
    const r1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1" });
    expect(r1.status).toBe("queued");
    expect(await maxChat.sendsInChat(ORG, CONV, wf)).toBe(0);
    expect(await maxChat.sendsInChat(ORG, CONV, wf, { includeLive: true })).toBe(1);
    await db.insert(s.messages).values({ id: "in_2", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "¿y envíos?", status: "received" });
    expect(await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_2" })).toMatchObject({ status: "skipped", reason: ex.SKIP_MAX_PER_CHAT });
    expect(await ex.executeWorkflowRun(r1.runId, { provider, storage })).toBe("done");
    expect(await maxChat.sendsInChat(ORG, CONV, wf)).toBe(1);
  });

  it("una sola respuesta de inicio (30-sep-2026): se revisa también al ARRANCAR — dos respuestas de inicio en cola, la segunda se omite", async () => {
    const info = await workflow([{ kind: "send_text", text: "Claro, es una barrera…" }]);
    const precio = await workflow([{ kind: "send_text", text: "Ahorita tenemos cualquier tamaño en $5,500." }]);
    await db.insert(s.messages).values([
      { id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "Quiero más información", status: "received" },
      { id: "in_2", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "Hola costos", status: "received" },
    ]);
    const r1 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: info, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_1" });
    const r2 = await ex.startWorkflowRun({ organizationId: ORG, workflowId: precio, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_2" });
    expect([r1.status, r2.status]).toEqual(["queued", "queued"]);
    const { inArray } = await import("drizzle-orm");
    await db.update(s.workflows).set({ triggerStartOnly: true }).where(inArray(s.workflows.id, [info, precio]));
    expect(await ex.executeWorkflowRun(r1.runId, { provider, storage })).toBe("done");
    expect(await ex.executeWorkflowRun(r2.runId, { provider, storage })).toBe("cancelled");
    expect(await run(r2.runId)).toMatchObject({ status: "skipped", errorCode: ex.SKIP_OTHER_START });
    expect(sent.map((x) => (x.input as SendTextInput).text)).toEqual(["Claro, es una barrera…"]);
  });


  // ── Texto del Agente IA como pie del archivo (1-oct-2026, dueño) ──────────────
  const PIE = "Claro, aquí le comparto el video de instalación de la mini compuerta.";
  async function videoRun(steps: (a: { id: string }) => import("@/lib/db/schema/automation").WorkflowStepPayload[]) {
    const a = await asset();
    const wf = await workflow(steps(a));
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "muéstreme el video", status: "received" });
    const r = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1", payload: { pieDelAgente: PIE } });
    expect(r.status).toBe("queued");
    return { wf, runId: r.runId };
  }

  // ── «Es la respuesta» de solo archivos pedido por el Agente IA (9-oct-2026, «Dónde medir») ──
  it("«es la respuesta» de solo archivos pedido por el Agente IA: el archivo lleva el pie del workflow (tras su espera) y contesta SOLO su mensaje, con la marca de revisión y su hora", async () => {
    const waits: number[] = [];
    const a = await asset();
    const wf = await workflow(
      [
        { kind: "wait", seconds: 18 },
        { kind: "send_media", assetId: a.id, title: "Video", caption: "Le comparto un video de como debe medir su entrada" },
      ],
      { isAnswer: true },
    );
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "¿cómo mido?", status: "received" });
    const r = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1" });
    expect(await ex.executeWorkflowRun(r.runId, { provider, storage, sleep: async (ms: number) => void waits.push(ms) })).toBe("done");
    expect(waits).toEqual([18_000]);
    expect(sent.map((x) => [x.kind, (x.input as SendMediaInput).caption])).toEqual([["media", "Le comparto un video de como debe medir su entrada"]]);
    const [out] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(out.metadata).toMatchObject({ contestaA: "in_1", revisaAgente: true, revisaDesde: expect.any(String) });
    expect(out.metadata ?? {}).not.toHaveProperty("respondeHasta");
    // Sigue pendiente hasta que el Agente IA lo revise (complemento, run.ts).
    const { pendingInbound } = await import("@/lib/ai/runtime/context");
    expect((await pendingInbound(ORG, CONV)).map((m) => m.id)).toEqual(["in_1"]);
  });

  it("corrida del Agente IA que YA traía su pie (encolada antes del 9-oct) en un workflow «es la respuesta»: sale como antes, con su texto y sin pedir revisión", async () => {
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Video", caption: "Pie del workflow" }], { isAnswer: true });
    await db.insert(s.messages).values({ id: "in_1", organizationId: ORG, conversationId: CONV, direction: "in", source: "contact", type: "text", body: "¿cómo mido?", status: "received" });
    const r = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1", payload: { pieDelAgente: PIE } });
    expect(await ex.executeWorkflowRun(r.runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => (x.input as SendMediaInput).caption)).toEqual([PIE]);
    const [out] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(out.metadata).toMatchObject({ respondeHasta: expect.any(String) });
    expect(out.metadata ?? {}).not.toHaveProperty("contestaA");
    const { pendingInbound } = await import("@/lib/ai/runtime/context");
    expect(await pendingInbound(ORG, CONV)).toEqual([]);
  });

  it("pie del Agente IA: su texto reemplaza el pie del workflow en el primer archivo (UN mensaje) y contesta lo que leyó", async () => {
    const { runId } = await videoRun((a) => [
      { kind: "send_media", assetId: a.id, title: "Video", caption: "Aquí le comparto un video de la instalación de las mini compuertas" },
      { kind: "send_media", assetId: a.id, title: "Foto", caption: "Así queda" },
    ]);
    expect(await ex.executeWorkflowRun(runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => [x.kind, (x.input as SendMediaInput).caption])).toEqual([
      ["media", PIE],
      ["media", "Así queda"],
    ]);
    const outs = await db.select().from(s.messages).where(eq(s.messages.direction, "out")).orderBy(s.messages.createdAt);
    expect(outs[0]).toMatchObject({ body: PIE, source: "ai_agent" });
    // Es la respuesta del agente: contesta hasta su mensaje leído (no es "relleno" de workflow).
    expect(outs[0].metadata).toMatchObject({ respondeHasta: expect.any(String) });
    expect(outs[1].metadata ?? {}).not.toHaveProperty("respondeHasta");
    const { pendingInbound } = await import("@/lib/ai/runtime/context");
    expect(await pendingInbound(ORG, CONV)).toEqual([]);
  });

  it("pie del Agente IA con la Tabla (espera antes de la imagen): la espera no corre y la imagen lleva el texto; por palabra clave la espera sigue", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const { wf, runId } = await videoRun((a) => [
      { kind: "wait", seconds: 18 },
      { kind: "send_media", assetId: a.id, title: "Tabla", caption: "Aquí le comparto una foto de los tamaños disponibles" },
    ]);
    expect(await ex.executeWorkflowRun(runId, { provider, storage, sleep })).toBe("done");
    expect(waits).toEqual([]);
    expect(sent.map((x) => [x.kind, (x.input as SendMediaInput).caption])).toEqual([["media", PIE]]);
    const [out] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(out.metadata).toMatchObject({ respondeHasta: expect.any(String) });

    const kw = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "keyword", triggerMessageId: "in_1" });
    expect(await ex.executeWorkflowRun(kw.runId, { provider, storage, sleep })).toBe("done");
    expect(waits).toEqual([18_000]);
    expect((sent[1].input as SendMediaInput).caption).toBe("Aquí le comparto una foto de los tamaños disponibles");
  });

  it("pie del Agente IA: no es una variable {{…}} y solo lo usan las corridas del agente", async () => {
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Video", caption: "Video {{pieDelAgente}}" }]);
    const cmd = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "command", triggeredByUserId: "u_v", payload: { pieDelAgente: PIE } });
    expect(await ex.executeWorkflowRun(cmd.runId, { provider, storage })).toBe("done");
    expect((sent[0].input as SendMediaInput).caption).toBe("Video");
  });

  it("pie del Agente IA: si la corrida ya no sale al arrancar, su texto sale SOLO (el cliente no se queda sin respuesta)", async () => {
    const { wf, runId } = await videoRun((a) => [{ kind: "send_media", assetId: a.id, title: "Video", caption: "Pie del workflow" }]);
    await db.update(s.workflows).set({ enabled: false }).where(eq(s.workflows.id, wf));
    expect(await ex.executeWorkflowRun(runId, { provider, storage })).toBe("cancelled");
    expect(await run(runId)).toMatchObject({ status: "skipped", errorCode: ex.SKIP_DISABLED });
    expect(sent.map((x) => [x.kind, (x.input as SendTextInput).text])).toEqual([["text", PIE]]);
    const [out] = await db.select().from(s.messages).where(eq(s.messages.direction, "out"));
    expect(out).toMatchObject({ body: PIE, source: "ai_agent", metadata: expect.objectContaining({ respondeHasta: expect.any(String) }) });
    // Un reintento del job no lo repite.
    await db.update(s.workflowRuns).set({ status: "queued" }).where(eq(s.workflowRuns.id, runId));
    expect(await ex.executeWorkflowRun(runId, { provider, storage })).toBe("cancelled");
    expect(sent).toHaveLength(1);
  });

  it("pie del Agente IA: con el agente pausado no sale nada; si el workflow ya no empieza con archivo, el texto sale antes", async () => {
    const first = await videoRun((a) => [{ kind: "send_media", assetId: a.id, title: "Video" }]);
    await db.update(s.conversations).set({ agentState: "pausado_humano" }).where(eq(s.conversations.id, CONV));
    expect(await ex.executeWorkflowRun(first.runId, { provider, storage })).toBe("cancelled");
    expect(sent).toEqual([]);

    await db.update(s.conversations).set({ agentState: "activo" }).where(eq(s.conversations.id, CONV));
    const a = await asset();
    const wf = await workflow([{ kind: "send_media", assetId: a.id, title: "Video" }]);
    const r = await ex.startWorkflowRun({ organizationId: ORG, workflowId: wf, conversationId: CONV, trigger: "agent", triggerMessageId: "in_1", payload: { pieDelAgente: PIE } });
    // Alguien le agregó un texto al inicio mientras esperaba en cola.
    await db.update(s.workflowSteps).set({ position: 1 }).where(eq(s.workflowSteps.workflowId, wf));
    await db.insert(s.workflowSteps).values({ id: crypto.randomUUID(), organizationId: ORG, workflowId: wf, position: 0, kind: "send_text", payload: { kind: "send_text", text: "Mire:" } });
    expect(await ex.executeWorkflowRun(r.runId, { provider, storage })).toBe("done");
    expect(sent.map((x) => [x.kind, x.kind === "text" ? (x.input as SendTextInput).text : (x.input as SendMediaInput).caption ?? null])).toEqual([
      ["text", PIE],
      ["text", "Mire:"],
      ["media", null],
    ]);
  });

  it("pie del Agente IA: si el archivo no sale, el aviso al vendedor lleva el texto que iba con él", async () => {
    const { runId } = await videoRun((a) => [{ kind: "send_media", assetId: a.id, title: "Video" }]);
    await db.update(s.conversations).set({ windowExpiresAt: new Date(Date.now() - 60_000) }).where(eq(s.conversations.id, CONV));
    expect(await ex.executeWorkflowRun(runId, { provider, storage })).toBe("failed");
    const notices = await db.select().from(s.aiAgentNotices);
    expect(notices.map((n) => n.body).join("\n")).toContain(`Iba con el texto del Agente IA: «${PIE}»`);
  });

});
