// Borrar y exportar un contacto (derechos ARCO, 7-oct-2026) contra Postgres REAL (TEST_DATABASE_URL):
// borrar se lleva todo lo del contacto y nada de otro contacto ni de otra organización; el gasto de
// IA se conserva con la conversación en null; el Historial queda sin datos personales; los archivos
// de la Biblioteca nunca se tocan; un archivo que no se pudo borrar se reporta y se reintenta.
// Exportar arma el zip (datos.json, chat.txt y SOLO los archivos del cliente) y no deja ver
// contactos de otra organización.
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { InboxEvent } from "@/lib/inbox/types";
import type { ObjectStorage } from "@/lib/storage/s3";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "secreto-de-pruebas-arco-0123456789";

const session = vi.hoisted(() => ({
  current: { organizationId: "org_arco_a", userId: "u_arco_daniel", role: "agent" } as { organizationId: string; userId: string; role: string } | null,
}));
vi.mock("@/lib/auth/active-organization", () => ({
  requireActiveMembership: async () => {
    if (!session.current) throw new Error("No autenticado.");
    return session.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// Bucket en memoria: qué hay, qué se borró y qué llaves fallan al borrar.
const bucket = vi.hoisted(() => {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const failKeys = new Set<string>();
  const storage: ObjectStorage = {
    putStream: async () => undefined,
    exists: async (key) => objects.has(key),
    head: async (key) => (objects.has(key) ? { bytes: objects.get(key)?.byteLength ?? 0, contentType: null } : null),
    deleteObject: async (key) => {
      if (failKeys.has(key)) throw new Error("bucket caído");
      deleted.push(key);
      objects.delete(key);
    },
    signedGetUrl: async () => "https://bucket.test/firmada",
    getBytes: async (key) => objects.get(key) ?? new Uint8Array(),
    async *listObjects(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) yield { key, lastModified: new Date() };
    },
    getStream: async (key) => {
      const data = objects.get(key);
      if (!data) throw new Error("no existe");
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        }),
        bytes: data.byteLength,
      };
    },
  };
  return { objects, deleted, failKeys, storage };
});
vi.mock("@/lib/storage/s3", () => {
  class StorageNotConfiguredError extends Error {}
  return { objectStorage: () => bucket.storage, StorageNotConfiguredError };
});
// Cola del Agente IA sin Redis: se anota qué job se sacó (jobId = conversationId).
const queue = vi.hoisted(() => ({ canceled: [] as string[] }));
vi.mock("@/lib/ai/runtime/queue", () => ({
  bullAgentQueuePort: () => ({}),
  withQueueTimeout: <T,>(op: Promise<T>) => op,
  cancelAgentRun: async (_queue: unknown, conversationId: string) => {
    queue.canceled.push(conversationId);
    return true;
  },
}));

const ORG_A = "org_arco_a";
const ORG_B = "org_arco_b";
const DANIEL = "u_arco_daniel";
const ANA = "u_arco_ana";
const JUAN = "c_arco_juan";
const OTRO = "c_arco_otro";
const AJENO = "c_arco_ajeno";
const CONV_JUAN = "v_arco_juan";
const CONV_OTRO = "v_arco_otro";
const CONV_AJENO = "v_arco_ajeno";

const KEY_INE = `org/${ORG_A}/messages/m_arco_2/0-INE.pdf`;
const KEY_INE_THUMB = `${KEY_INE}.thumb.png`;
const KEY_PENDING = `org/${ORG_A}/messages/m_arco_3/0-audio.ogg`;
const KEY_LIBRARY = `org/${ORG_A}/library/asset1-tabla.jpg`;
const KEY_CHAT = `org/${ORG_A}/chat/2026-10-03/up1-cotizacion.pdf`;
const KEY_OTRO = `org/${ORG_A}/messages/m_arco_o1/0-x.jpg`;

describe.skipIf(!TEST_DATABASE_URL)("borrar y exportar un contacto (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let service: typeof import("./delete");
  let actions: typeof import("@/lib/actions/contact-arco");
  let getChangeHistory: typeof import("@/lib/actions/historial").getChangeHistory;
  let exportRoute: typeof import("@/app/api/contactos/[contactId]/exportar/route");
  let subscribeToInbox: typeof import("@/lib/inbox/events").subscribeToInbox;
  let resetHub: typeof import("@/lib/inbox/events").__resetInboxHubForTests;

  const deps = () => ({
    storage: () => bucket.storage,
    cancelAgentJob: async (conversationId: string) => {
      queue.canceled.push(conversationId);
    },
  });

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    service = await import("./delete");
    actions = await import("@/lib/actions/contact-arco");
    ({ getChangeHistory } = await import("@/lib/actions/historial"));
    exportRoute = await import("@/app/api/contactos/[contactId]/exportar/route");
    ({ subscribeToInbox, __resetInboxHubForTests: resetHub } = await import("@/lib/inbox/events"));
  });

  afterAll(async () => {
    await resetHub?.();
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG_A, userId: DANIEL, role: "agent" };
    bucket.objects.clear();
    bucket.deleted.length = 0;
    bucket.failKeys.clear();
    queue.canceled.length = 0;
    // Primero las organizaciones (su cascade se lleva los comentarios, que no dejan borrar al autor).
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.delete(s.user).where(d.inArray(s.user.id, [DANIEL, ANA]));
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Diluvium", slug: "arco-a", createdAt: new Date() },
      { id: ORG_B, name: "Otra", slug: "arco-b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values([
      { id: DANIEL, name: "Daniel", email: "arco-daniel@example.test" },
      { id: ANA, name: "Ana", email: "arco-ana@example.test" },
    ]);
    await db.insert(s.member).values([
      { id: "m_arco_daniel", organizationId: ORG_A, userId: DANIEL, role: "agent", createdAt: new Date() },
      { id: "m_arco_ana", organizationId: ORG_B, userId: ANA, role: "agent", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values([
      { id: "ch_arco_a", organizationId: ORG_A, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_arco_a", displayName: "WhatsApp Diluvium" },
      { id: "ch_arco_b", organizationId: ORG_B, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_arco_b", displayName: "WhatsApp Otra" },
    ]);
    await db.insert(s.contacts).values([
      { id: JUAN, organizationId: ORG_A, firstName: "Juan", lastName: "Pérez", phoneE164: "+5216681234567", email: "juan@example.test", stage: "prospecto", temperature: "caliente", tieneInundaciones: "si", numEntradas: 1, montoCotizacion: "12500.50" },
      { id: OTRO, organizationId: ORG_A, firstName: "Otra", phoneE164: "+5216689999999", stage: "prospecto" },
      { id: AJENO, organizationId: ORG_B, firstName: "Ajeno", phoneE164: "+5216687777777", stage: "prospecto" },
    ]);
    await db.insert(s.conversations).values([
      { id: CONV_JUAN, organizationId: ORG_A, contactId: JUAN, channelId: "ch_arco_a", providerConversationId: "zconv_arco_juan" },
      { id: CONV_OTRO, organizationId: ORG_A, contactId: OTRO, channelId: "ch_arco_a", providerConversationId: "zconv_arco_otro" },
      { id: CONV_AJENO, organizationId: ORG_B, contactId: AJENO, channelId: "ch_arco_b", providerConversationId: "zconv_arco_ajeno" },
    ]);
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 17, minute)); // 10:MM en Mazatlán
    await db.insert(s.messages).values([
      { id: "m_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "in", source: "contact", type: "text", body: "Hola, soy Juan Pérez", status: "received", providerMessageId: "wamid.arco1", providerInternalId: "zmsg_arco1", sentAt: at(12) },
      {
        id: "m_arco_2", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "in", source: "contact", type: "document", status: "received", providerMessageId: "wamid.arco2", sentAt: at(13),
        attachments: [{ type: "document", url: "https://z/2", fileName: "INE.pdf", mimeType: "application/pdf", storageKey: KEY_INE, thumbnailKey: KEY_INE_THUMB, sizeBytes: 8 }],
      },
      {
        id: "m_arco_3", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "in", source: "contact", type: "audio", status: "received", providerMessageId: "wamid.arco3", sentAt: at(14),
        attachments: [{ type: "audio", url: "https://z/3", providerMediaId: "media3" }], transcripcion: "Mañana le mando las medidas",
      },
      {
        id: "m_arco_4", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "out", source: "crm", type: "image", status: "sent", providerMessageId: "wamid.arco4", sentAt: at(15), sentByUserId: DANIEL,
        attachments: [{ type: "image", url: "", fileName: "tabla.jpg", storageKey: KEY_LIBRARY, sizeBytes: 9 }],
      },
      {
        id: "m_arco_5", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "out", source: "crm", type: "document", status: "sent", providerMessageId: "wamid.arco5", sentAt: at(16), sentByUserId: DANIEL,
        attachments: [{ type: "document", url: "", fileName: "cotizacion.pdf", storageKey: KEY_CHAT, sizeBytes: 9 }],
      },
      { id: "m_arco_6", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "out", source: "ai_agent", type: "text", body: "Hola Juan, soy Ángela", status: "sent", providerMessageId: "wamid.arco6", sentAt: at(17) },
      { id: "m_arco_7", organizationId: ORG_A, conversationId: CONV_JUAN, direction: "out", source: "ai_agent", type: "system_note", body: "Aviso interno para el vendedor", status: "sent", sentAt: at(18) },
      {
        id: "m_arco_o1", organizationId: ORG_A, conversationId: CONV_OTRO, direction: "in", source: "contact", type: "image", status: "received", providerMessageId: "wamid.arco_o1", sentAt: at(20),
        attachments: [{ type: "image", url: "https://z/o1", storageKey: KEY_OTRO, sizeBytes: 3 }],
      },
      { id: "m_arco_b1", organizationId: ORG_B, conversationId: CONV_AJENO, direction: "in", source: "contact", type: "text", body: "Hola", status: "received", providerMessageId: "wamid.arco_b1", sentAt: at(21) },
    ]);
    for (const key of [KEY_INE, KEY_INE_THUMB, KEY_PENDING, KEY_LIBRARY, KEY_CHAT, KEY_OTRO]) {
      bucket.objects.set(key, new TextEncoder().encode(key === KEY_INE ? "PDF-JUAN" : "x"));
    }
    await db.insert(s.contactEntradas).values({ id: "e_arco_1", organizationId: ORG_A, contactId: JUAN, posicion: 1, anchoCm: 120 });
    await db.insert(s.contactComentarios).values({ id: "cm_arco_1", organizationId: ORG_A, contactId: JUAN, authorUserId: DANIEL, body: "Llamar mañana" });
    await db.insert(s.followUps).values({ id: "f_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, contactId: JUAN, caso: "faltan_medidas", timeZone: "America/Mazatlan", basedOnMessageAt: at(17) });
    await db.insert(s.scheduledMessages).values({ id: "sch_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, createdByUserId: DANIEL, kind: "text", body: "Recordatorio", sendAt: new Date(Date.now() + 86_400_000) });
    await db.insert(s.adClicks).values({ id: "ad_arco_1", organizationId: ORG_A, contactId: JUAN, conversationId: CONV_JUAN, messageId: "m_arco_1", origin: "webhook", raw: {}, clickedAt: at(12), headline: "Compuertas" });
    await db.insert(s.workflows).values({ id: "wf_arco_1", organizationId: ORG_A, slug: "banco", name: "Banco" });
    await db.insert(s.workflowRuns).values({ id: "wr_arco_1", organizationId: ORG_A, workflowId: "wf_arco_1", conversationId: CONV_JUAN, contactId: JUAN, trigger: "agent" });
    await db.insert(s.aiAgentDrafts).values({ id: "dr_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, bubbles: ["hola"], status: "descartado" });
    await db.insert(s.aiAgentNotices).values({ id: "nt_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, messageId: "m_arco_6", kind: "guardia", body: "Revisa el monto" });
    await db.insert(s.aiUsage).values([
      { id: "us_arco_1", organizationId: ORG_A, conversationId: CONV_JUAN, messageId: "m_arco_1", stage: "cerebro", provider: "anthropic", modelId: "claude-sonnet-5", latencyMs: 100, costUsd: 0.01 },
      { id: "us_arco_2", organizationId: ORG_A, conversationId: CONV_JUAN, stage: "detalle", provider: "openai", modelId: "gpt-5.6-luna", latencyMs: 50, costUsd: 0.002 },
      { id: "us_arco_o", organizationId: ORG_A, conversationId: CONV_OTRO, messageId: "m_arco_o1", stage: "cerebro", provider: "anthropic", modelId: "claude-sonnet-5", latencyMs: 80, costUsd: 0.02 },
    ]);
    await db.insert(s.comprobantes).values([
      { id: "cp_arco_1", organizationId: ORG_A, contactId: JUAN, conversationId: CONV_JUAN, messageId: "m_arco_2", monto: "5000", referencia: "ABC123", banco: "BBVA" },
      { id: "cp_arco_o", organizationId: ORG_A, contactId: OTRO, conversationId: CONV_OTRO, messageId: "m_arco_o1", monto: "100", referencia: "XYZ", banco: "BBVA" },
    ]);
    await db.insert(s.webhookEvents).values([
      { id: "we_arco_1", provider: "zernio", event: "message.received", organizationId: ORG_A, payload: { message: { id: "zmsg_arco1", platformMessageId: "wamid.arco1", conversationId: "zconv_arco_juan", text: "Hola, soy Juan Pérez", sender: { phoneNumber: "+5216681234567" } }, conversation: { id: "zconv_arco_juan" } } },
      { id: "we_arco_2", provider: "zernio", event: "message.read", organizationId: ORG_A, payload: { message: { platformMessageId: "wamid.arco2" } } },
      { id: "we_arco_3", provider: "zernio", event: "reaction.received", organizationId: ORG_A, payload: { reaction: { platformMessageId: "wamid.arco6", emoji: "👍" } } },
      { id: "we_arco_4", provider: "zernio", event: "message.received", organizationId: ORG_A, payload: { platformMessageId: "wamid.arco3", messageId: "wamid.arco3" } },
      { id: "we_arco_otro", provider: "zernio", event: "message.received", organizationId: ORG_A, payload: { message: { platformMessageId: "wamid.arco_o1" }, conversation: { id: "zconv_arco_otro" } } },
      // Mismo wamid pero de OTRA organización: no se toca.
      { id: "we_arco_b", provider: "zernio", event: "message.received", organizationId: ORG_B, payload: { message: { platformMessageId: "wamid.arco1" } } },
    ]);
    await db.insert(s.changeHistory).values([
      { id: "hc_arco_p1", organizationId: ORG_A, userId: DANIEL, kind: "pausas", action: "pausar", subject: "Juan Pérez", subjectId: CONV_JUAN },
      { id: "hc_arco_p2", organizationId: ORG_A, userId: DANIEL, kind: "pausas", action: "pausar", subject: "Otra", subjectId: CONV_OTRO },
    ]);
  });

  const count = async (table: PgTable, where: SQL | undefined) => (await db.select({ n: d.count() }).from(table).where(where))[0]?.n ?? 0;

  describe("borrar", () => {
    it("se lleva todo lo del contacto y deja intactos al otro contacto y a la otra organización", async () => {
      const outcome = await service.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: JUAN }, deps());
      expect(outcome).toEqual({ status: "deleted", counts: { chats: 1, mensajes: 6, archivos: 2 }, pendingFiles: [] });
      expect(queue.canceled).toEqual([CONV_JUAN]);

      expect(await count(s.contacts, d.eq(s.contacts.id, JUAN))).toBe(0);
      expect(await count(s.conversations, d.eq(s.conversations.contactId, JUAN))).toBe(0);
      expect(await count(s.messages, d.eq(s.messages.conversationId, CONV_JUAN))).toBe(0);
      expect(await count(s.contactEntradas, d.eq(s.contactEntradas.contactId, JUAN))).toBe(0);
      expect(await count(s.contactComentarios, d.eq(s.contactComentarios.contactId, JUAN))).toBe(0);
      expect(await count(s.followUps, d.eq(s.followUps.contactId, JUAN))).toBe(0);
      expect(await count(s.scheduledMessages, d.eq(s.scheduledMessages.id, "sch_arco_1"))).toBe(0);
      expect(await count(s.adClicks, d.eq(s.adClicks.contactId, JUAN))).toBe(0);
      expect(await count(s.workflowRuns, d.eq(s.workflowRuns.id, "wr_arco_1"))).toBe(0);
      expect(await count(s.aiAgentDrafts, d.eq(s.aiAgentDrafts.id, "dr_arco_1"))).toBe(0);
      expect(await count(s.aiAgentNotices, d.eq(s.aiAgentNotices.id, "nt_arco_1"))).toBe(0);
      expect(await count(s.comprobantes, d.eq(s.comprobantes.id, "cp_arco_1"))).toBe(0);
      // Lo crudo de sus webhooks se fue; el del otro contacto y el de la otra organización no.
      const webhooks = (await db.select({ id: s.webhookEvents.id }).from(s.webhookEvents).where(d.like(s.webhookEvents.id, "we_arco_%"))).map((r) => r.id).sort();
      expect(webhooks).toEqual(["we_arco_b", "we_arco_otro"]);

      // Bucket: sus archivos (con miniatura y lo que se descargó sin anotarse) sí; la Biblioteca y el otro contacto no.
      expect([...bucket.deleted].sort()).toEqual([KEY_CHAT, KEY_INE, KEY_INE_THUMB, KEY_PENDING].sort());
      expect(bucket.objects.has(KEY_LIBRARY)).toBe(true);
      expect(bucket.objects.has(KEY_OTRO)).toBe(true);

      // El otro contacto y la otra organización, completos.
      expect(await count(s.contacts, d.inArray(s.contacts.id, [OTRO, AJENO]))).toBe(2);
      expect(await count(s.messages, d.inArray(s.messages.id, ["m_arco_o1", "m_arco_b1"]))).toBe(2);
      expect(await count(s.comprobantes, d.eq(s.comprobantes.id, "cp_arco_o"))).toBe(1);
      expect(await count(s.workflows, d.eq(s.workflows.id, "wf_arco_1"))).toBe(1);
    });

    it("conserva el gasto de IA con la conversación y el mensaje en null", async () => {
      await service.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: JUAN }, deps());
      const usage = await db
        .select({ id: s.aiUsage.id, conversationId: s.aiUsage.conversationId, messageId: s.aiUsage.messageId, costUsd: s.aiUsage.costUsd })
        .from(s.aiUsage)
        .where(d.like(s.aiUsage.id, "us_arco_%"))
        .orderBy(s.aiUsage.id);
      expect(usage).toEqual([
        { id: "us_arco_1", conversationId: null, messageId: null, costUsd: 0.01 },
        { id: "us_arco_2", conversationId: null, messageId: null, costUsd: 0.002 },
        { id: "us_arco_o", conversationId: CONV_OTRO, messageId: "m_arco_o1", costUsd: 0.02 },
      ]);
    });

    it("deja la fila en el Historial con quién y cuándo, sin nombre ni teléfono completo", async () => {
      await service.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: JUAN }, deps());
      const rows = await db.select().from(s.changeHistory).where(d.eq(s.changeHistory.organizationId, ORG_A));
      const borrado = rows.find((r) => r.kind === "contacto_borrado");
      expect(borrado).toMatchObject({ action: "borrar", userId: DANIEL, authorName: "Daniel", subject: "4567", newValue: "1 chat · 6 mensajes · 2 archivos" });
      // Ninguna fila de la organización conserva su nombre ni su número (la pausa vieja perdió el nombre).
      const text = JSON.stringify(rows);
      expect(text).not.toContain("Juan");
      expect(text).not.toContain("6681234567");
      expect(rows.find((r) => r.id === "hc_arco_p1")?.subject).toBeNull();
      expect(rows.find((r) => r.id === "hc_arco_p2")?.subject).toBe("Otra");

      // Y se ve bien en Agente IA › Historial.
      const history = await getChangeHistory({ type: "contacto_borrado" });
      expect(history.ok && history.rows).toEqual([
        expect.objectContaining({
          type: "contacto_borrado",
          who: "Daniel",
          what: "Borró un contacto (teléfono terminado en 4567) con sus chats y archivos",
          after: "1 chat · 6 mensajes · 2 archivos",
          automatic: false,
        }),
      ]);
    });

    it("avisa en vivo SOLO a su organización, con un solo aviso (sin uno por mensaje)", async () => {
      const seenA: InboxEvent[] = [];
      const seenB: InboxEvent[] = [];
      const offA = await subscribeToInbox(ORG_A, (e) => seenA.push(e));
      const offB = await subscribeToInbox(ORG_B, (e) => seenB.push(e));
      try {
        await service.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: JUAN }, deps());
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        offA();
        offB();
      }
      expect(seenA.filter((e) => e.type !== "reload")).toEqual([{ type: "contact.deleted", contactId: JUAN, conversationIds: [CONV_JUAN] }]);
      expect(seenB.filter((e) => e.type !== "reload")).toEqual([]);
    });

    it("rechaza un contacto de otra organización (no encontrado) y no toca nada", async () => {
      const outcome = await service.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: AJENO }, deps());
      expect(outcome).toEqual({ status: "not_found" });
      const viaAction = await actions.deleteContact({ contactId: AJENO, confirmacion: "BORRAR" });
      expect(viaAction).toEqual({ ok: false, message: "Ese contacto ya no existe (quizá alguien más lo borró)." });
      expect(await count(s.contacts, d.eq(s.contacts.id, AJENO))).toBe(1);
      expect(await count(s.messages, d.eq(s.messages.id, "m_arco_b1"))).toBe(1);
      expect(bucket.deleted).toEqual([]);
      expect(queue.canceled).toEqual([]);
    });

    it("pide escribir BORRAR", async () => {
      expect(await actions.deleteContact({ contactId: JUAN, confirmacion: "borra" })).toEqual({ ok: false, message: "Escribe BORRAR para confirmar." });
      expect(await count(s.contacts, d.eq(s.contacts.id, JUAN))).toBe(1);
    });

    it("un archivo que no se pudo borrar se reporta (con el contacto ya borrado) y se reintenta", async () => {
      bucket.failKeys.add(KEY_INE);
      const result = await actions.deleteContact({ contactId: JUAN, confirmacion: " Borrar " });
      expect(result).toMatchObject({ ok: true, pendingFiles: 1 });
      expect(await count(s.contacts, d.eq(s.contacts.id, JUAN))).toBe(0);
      expect(bucket.objects.has(KEY_INE)).toBe(true);
      const token = result.ok ? result.retryToken : null;
      expect(token).toEqual(expect.any(String));

      // Otro usuario (u otra organización) no lo puede usar.
      session.current = { organizationId: ORG_B, userId: ANA, role: "agent" };
      expect(await actions.retryContactFilesDeletion(token ?? "")).toEqual({ ok: false, message: "Ese reintento ya no es válido." });

      session.current = { organizationId: ORG_A, userId: DANIEL, role: "agent" };
      expect(await actions.retryContactFilesDeletion(token ?? "")).toMatchObject({ ok: true, pendingFiles: 1 });
      bucket.failKeys.clear();
      expect(await actions.retryContactFilesDeletion(token ?? "")).toEqual({ ok: true, pendingFiles: 0, retryToken: null });
      expect(bucket.objects.has(KEY_INE)).toBe(false);
      expect(bucket.objects.has(KEY_LIBRARY)).toBe(true);
    });

    it("cuenta lo que se borraría (ventana de confirmación) solo dentro de la organización", async () => {
      expect(await actions.getContactArcoSummary(JUAN)).toEqual({
        ok: true,
        summary: {
          chats: 1,
          mensajes: 6,
          archivos: 2,
          seguimientos: 1,
          programados: 1,
          exportar: { archivos: 1, bytes: 8, maxBytes: 200 * 1024 * 1024, demasiado: false },
        },
      });
      expect(await actions.getContactArcoSummary(AJENO)).toEqual({ ok: false, message: "Ese contacto ya no existe." });
    });
  });

  describe("exportar", () => {
    const get = (contactId: string, query = "") =>
      exportRoute.GET(new Request(`http://localhost/api/contactos/${contactId}/exportar${query}`), { params: Promise.resolve({ contactId }) });

    it("zip con datos.json, chat.txt y SOLO los archivos que mandó el cliente", async () => {
      const res = await get(JUAN);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
      expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="contacto-juan-perez-\d{4}-\d{2}-\d{2}\.zip"/);
      const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
      expect(Object.keys(files)).toEqual(["datos.json", "chat.txt", "archivos/2026-10-03_1013_1-INE.pdf"]);
      expect(strFromU8(files["archivos/2026-10-03_1013_1-INE.pdf"])).toBe("PDF-JUAN");

      const datos = JSON.parse(strFromU8(files["datos.json"])) as import("./export-data").DatosJson;
      expect(datos.contacto).toMatchObject({
        nombre: "Juan",
        apellido: "Pérez",
        telefono: "+5216681234567",
        correo: "juan@example.test",
        etapa: "Prospecto",
        temperatura: "Caliente",
        origen: { anuncio: "Compuertas" },
        detalle: { tieneInundaciones: "Sí", numeroDeEntradas: 1, entradas: [expect.objectContaining({ posicion: 1, anchoCm: 120 })], montoCotizacionMxn: 12500.5 },
      });
      const mensajes = datos.conversaciones[0].mensajes;
      expect(mensajes.map((m) => `${m.fecha.slice(11, 16)} ${m.quien}`)).toEqual([
        "10:12 Cliente",
        "10:13 Cliente",
        "10:14 Cliente",
        "10:15 Vendedor",
        "10:16 Vendedor",
        "10:17 Agente IA",
      ]);
      expect(mensajes[1].adjuntos).toEqual([{ tipo: "documento", nombre: "INE.pdf", archivo: "archivos/2026-10-03_1013_1-INE.pdf" }]);
      expect(mensajes[2].transcripcion).toBe("Mañana le mando las medidas");
      expect(mensajes[3].adjuntos).toEqual([{ tipo: "foto", nombre: "tabla.jpg", archivo: null }]);

      const chat = strFromU8(files["chat.txt"]);
      expect(chat).toContain("[2026-10-03 10:12] Cliente: Hola, soy Juan Pérez");
      expect(chat).toContain("[2026-10-03 10:13] Cliente: [documento: archivos/2026-10-03_1013_1-INE.pdf]");
      expect(chat).toContain("[2026-10-03 10:17] Agente IA: Hola Juan, soy Ángela");
      expect(chat).not.toContain("Aviso interno");
    });

    it("sin archivos si se pide; con el tope pasado avisa (413) y no arma el zip", async () => {
      const lite = unzipSync(new Uint8Array(await (await get(JUAN, "?sinArchivos=1")).arrayBuffer()));
      expect(Object.keys(lite)).toEqual(["datos.json", "chat.txt"]);

      await db
        .update(s.messages)
        .set({ attachments: [{ type: "document", url: "https://z/2", fileName: "INE.pdf", storageKey: KEY_INE, sizeBytes: 300 * 1024 * 1024 }] })
        .where(d.eq(s.messages.id, "m_arco_2"));
      const tooBig = await get(JUAN);
      expect(tooBig.status).toBe(413);
      expect(await tooBig.text()).toBe("Los archivos que mandó el cliente pesan 300 MB y el máximo es 200 MB. Descarga sin archivos.");
    });

    it("no deja ver contactos de otra organización (404) ni sin sesión (401)", async () => {
      expect((await get(AJENO)).status).toBe(404);
      expect((await get("no-existe")).status).toBe(404);
      session.current = { organizationId: ORG_B, userId: ANA, role: "agent" };
      expect((await get(JUAN)).status).toBe(404);
      session.current = null;
      expect((await get(JUAN)).status).toBe(401);
    });
  });
});
