// Tests de integración de los mensajes programados (A6) contra Postgres REAL:
// validaciones al programar/editar/reintentar (store.ts) y el envío del worker
// (dispatch.ts) con un proveedor FALSO. Solo corren con TEST_DATABASE_URL
// apuntando a una base DESECHABLE con las migraciones aplicadas; borran sus
// datos al empezar. Nunca apuntarlos a staging ni prod.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MessagingProvider, SendResult } from "@/lib/messaging/provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type SendCall = { kind: "text" | "template"; idempotencyKey: string };

function fakeProvider(behavior: { reject?: boolean } = {}) {
  const calls: SendCall[] = [];
  let seq = 0;
  const send = async (kind: SendCall["kind"], idempotencyKey: string): Promise<SendResult> => {
    calls.push({ kind, idempotencyKey });
    if (behavior.reject) {
      const { SendFailedError } = await import("@/lib/messaging/provider");
      throw new SendFailedError("131047", "rechazado por prueba", "rejected");
    }
    seq++;
    return { providerInternalId: `pint_${seq}_${idempotencyKey}`, providerMessageId: `wamid.test_${seq}_${idempotencyKey}` };
  };
  const provider = {
    name: "zernio",
    verifyWebhook: () => true,
    readEnvelope: () => {
      throw new Error("no usado");
    },
    normalize: () => {
      throw new Error("no usado");
    },
    sendText: (input: { idempotencyKey: string }) => send("text", input.idempotencyKey),
    sendTemplate: (input: { idempotencyKey: string }) => send("template", input.idempotencyKey),
    listTemplates: async () => [],
    createTemplate: async () => {
      throw new Error("no usado");
    },
    fetchMedia: async () => new Response(null),
  } as unknown as MessagingProvider;
  return { provider, calls };
}

describe.skipIf(!TEST_DATABASE_URL)("mensajes programados (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let store: typeof import("./store");
  let dispatch: typeof import("./dispatch");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_sched";
  const OTHER_ORG = "org_sched_otra";
  const USER = "u_sched";
  const CONV = "conv_sched";
  const TEMPLATE = "tpl_sched";
  const NOW = new Date("2026-09-22T18:00:00Z");
  const HOUR = 3_600_000;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    store = await import("./store");
    dispatch = await import("./dispatch");
    ({ eq } = await import("drizzle-orm"));
  });

  async function setWindow(expiresAt: Date | null) {
    await db.update(s.conversations).set({ windowExpiresAt: expiresAt }).where(eq(s.conversations.id, CONV));
  }

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate scheduled_messages, messages, conversations, templates, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "sched", createdAt: new Date() },
      { id: OTHER_ORG, name: "Otra", slug: "sched-otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: USER, name: "Carlos", email: "carlos@sched.mx" });
    await db.insert(s.channels).values({
      id: "ch_sched",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_sched",
      displayName: "Diluvium",
    });
    await db.insert(s.contacts).values({ id: "c_sched", organizationId: ORG, firstName: "Ana", phoneE164: "+526681234567" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: "c_sched",
      channelId: "ch_sched",
      providerConversationId: "zconv_sched",
      windowExpiresAt: new Date(NOW.getTime() + 20 * HOUR),
    });
    await db.insert(s.templates).values({
      id: TEMPLATE,
      organizationId: ORG,
      channelId: "ch_sched",
      name: "seguimiento",
      language: "es_MX",
      body: "Hola {{1}}, ¿pudo revisar la cotización?",
      status: "APPROVED",
    });
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const base = { organizationId: ORG, userId: USER, conversationId: CONV, cancelIfInbound: true, now: NOW };

  describe("programar (store)", () => {
    it("texto dentro de la ventana a la hora de envío: se guarda; fuera de ventana o sin ventana: solo plantilla", async () => {
      const row = await store.createScheduled({ ...base, kind: "text", text: "  Le escribo mañana  ", sendAt: at(2 * HOUR) });
      expect(row).toMatchObject({ status: "scheduled", kind: "text", body: "Le escribo mañana", createdByUserId: USER });

      await expect(store.createScheduled({ ...base, kind: "text", text: "tarde", sendAt: at(21 * HOUR) })).rejects.toThrow(
        /solo se puede programar una plantilla/,
      );
      await setWindow(null);
      await expect(store.createScheduled({ ...base, kind: "text", text: "x", sendAt: at(HOUR) })).rejects.toThrow(/plantilla/);
    });

    it("límites de hora y organización", async () => {
      await expect(store.createScheduled({ ...base, kind: "text", text: "x", sendAt: at(30_000) })).rejects.toThrow(/1 minuto/);
      await expect(store.createScheduled({ ...base, kind: "text", text: "x", sendAt: at(61 * 24 * HOUR) })).rejects.toThrow(/60 días/);
      await expect(
        store.createScheduled({ ...base, organizationId: OTHER_ORG, kind: "text", text: "x", sendAt: at(HOUR) }),
      ).rejects.toThrow(/Conversación no encontrada/);
    });

    it("plantilla: aprobada, del canal, con todas sus variables; guarda la vista previa", async () => {
      const row = await store.createScheduled({ ...base, kind: "template", templateId: TEMPLATE, templateParams: ["Ana"], sendAt: at(48 * HOUR) });
      expect(row).toMatchObject({ kind: "template", body: "Hola Ana, ¿pudo revisar la cotización?", templateParams: ["Ana"] });

      await expect(
        store.createScheduled({ ...base, kind: "template", templateId: TEMPLATE, templateParams: [" "], sendAt: at(HOUR) }),
      ).rejects.toThrow(/1 variable/);
      await db.update(s.templates).set({ status: "PENDING" }).where(eq(s.templates.id, TEMPLATE));
      await expect(
        store.createScheduled({ ...base, kind: "template", templateId: TEMPLATE, templateParams: ["Ana"], sendAt: at(HOUR) }),
      ).rejects.toThrow(/no está aprobada/);
    });

    it("editar: solo pendientes; reinicia programmed_at y revalida la ventana", async () => {
      const row = await store.createScheduled({ ...base, kind: "text", text: "hola", sendAt: at(HOUR) });
      const later = at(10 * 60_000);
      const { after } = await store.updateScheduled({ organizationId: ORG, id: row.id, sendAt: at(3 * HOUR), cancelIfInbound: false, text: "hola 2", now: later });
      expect(after).toMatchObject({ body: "hola 2", cancelIfInbound: false });
      expect(after.sendAt.getTime()).toBe(at(3 * HOUR).getTime());
      expect(after.programmedAt.getTime()).toBe(later.getTime());

      await expect(store.updateScheduled({ organizationId: ORG, id: row.id, sendAt: at(22 * HOUR), cancelIfInbound: true, now: later })).rejects.toThrow(
        /plantilla/,
      );
      await store.cancelScheduled(ORG, row.id, later);
      await expect(store.updateScheduled({ organizationId: ORG, id: row.id, sendAt: at(2 * HOUR), cancelIfInbound: true, now: later })).rejects.toThrow(
        /ya no se puede editar/,
      );
    });

    it("cancelar, descartar y lo que se ve arriba del composer", async () => {
      const a = await store.createScheduled({ ...base, kind: "text", text: "a", sendAt: at(HOUR) });
      const b = await store.createScheduled({ ...base, kind: "text", text: "b", sendAt: at(2 * HOUR) });
      const c = await store.createScheduled({ ...base, kind: "text", text: "c", sendAt: at(3 * HOUR) });
      await db.update(s.scheduledMessages).set({ status: "failed", errorCode: "x", errorMessage: "falló" }).where(eq(s.scheduledMessages.id, b.id));
      await db.update(s.scheduledMessages).set({ status: "cancelled", cancelReason: "cliente_escribio" }).where(eq(s.scheduledMessages.id, c.id));

      expect((await store.listScheduledForConversation(ORG, CONV)).map((v) => v.body)).toEqual(["a", "b", "c"]);
      expect(await store.listScheduledForConversation(OTHER_ORG, CONV)).toEqual([]);

      const cancelled = await store.cancelScheduled(ORG, a.id);
      expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "manual" });
      const dismissed = await store.cancelScheduled(ORG, b.id);
      expect(dismissed.status).toBe("failed");
      await store.cancelScheduled(ORG, c.id);
      expect(await store.listScheduledForConversation(ORG, CONV)).toEqual([]);

      const d = await store.createScheduled({ ...base, kind: "text", text: "d", sendAt: at(HOUR) });
      await db.update(s.scheduledMessages).set({ status: "sending" }).where(eq(s.scheduledMessages.id, d.id));
      await expect(store.cancelScheduled(ORG, d.id)).rejects.toThrow(/Ya se está enviando/);
    });

    it("reintentar: solo fallidos, se manda ya; texto con la ventana cerrada no", async () => {
      const row = await store.createScheduled({ ...base, kind: "text", text: "x", sendAt: at(HOUR) });
      await expect(store.retryScheduled(ORG, row.id, NOW)).rejects.toThrow(/Solo se puede reintentar/);
      await db.update(s.scheduledMessages).set({ status: "failed", errorCode: "late", errorMessage: "y" }).where(eq(s.scheduledMessages.id, row.id));
      const retryAt = at(5 * 60_000);
      const retried = await store.retryScheduled(ORG, row.id, retryAt);
      expect(retried).toMatchObject({ status: "scheduled", errorCode: null, errorMessage: null });
      expect(retried.sendAt.getTime()).toBe(retryAt.getTime());

      await db.update(s.scheduledMessages).set({ status: "failed", errorCode: "late" }).where(eq(s.scheduledMessages.id, row.id));
      await setWindow(at(-HOUR));
      await expect(store.retryScheduled(ORG, row.id, retryAt)).rejects.toThrow(/ventana de 24 h está cerrada/);
    });
  });

  describe("disparar (dispatch del worker)", () => {
    // Programado "en el pasado" directamente en la base: el worker corre con la
    // hora real, así que la ventana se abre alrededor de ahora.
    async function due(opts: { kind?: "text" | "template"; cancelIfInbound?: boolean; programmedAt?: Date } = {}) {
      await db
        .insert(s.member)
        .values({ id: "m_sched", organizationId: ORG, userId: USER, role: "agent", createdAt: new Date() })
        .onConflictDoNothing();
      const sendAt = new Date(Date.now() - 1_000);
      await setWindow(new Date(Date.now() + 20 * HOUR));
      const id = crypto.randomUUID();
      await db.insert(s.scheduledMessages).values({
        id,
        organizationId: ORG,
        conversationId: CONV,
        createdByUserId: USER,
        kind: opts.kind ?? "text",
        body: opts.kind === "template" ? "Hola Ana, ¿pudo revisar la cotización?" : "Buenos días",
        templateId: opts.kind === "template" ? TEMPLATE : null,
        templateParams: opts.kind === "template" ? ["Ana"] : [],
        sendAt,
        programmedAt: opts.programmedAt ?? new Date(Date.now() - HOUR),
        cancelIfInbound: opts.cancelIfInbound ?? true,
      });
      return { id, sendAtMs: sendAt.getTime() };
    }

    async function inbound(sentAt: Date) {
      await db.insert(s.messages).values({
        id: crypto.randomUUID(),
        organizationId: ORG,
        conversationId: CONV,
        direction: "in",
        source: "contact",
        type: "text",
        body: "ya no, gracias",
        status: "received",
        sentAt,
      });
    }

    async function row(id: string) {
      const [r] = await db.select().from(s.scheduledMessages).where(eq(s.scheduledMessages.id, id));
      return r;
    }

    it("envía texto a nombre de quien lo programó y queda 'sent' con su mensaje", async () => {
      const { provider, calls } = fakeProvider();
      const job = await due();
      expect(await dispatch.dispatchScheduled(provider, job.id, job.sendAtMs)).toBe("sent");
      expect(calls).toHaveLength(1);
      const r = await row(job.id);
      expect(r.status).toBe("sent");
      const [m] = await db.select().from(s.messages).where(eq(s.messages.id, r.messageId!));
      expect(m).toMatchObject({ direction: "out", sentByUserId: USER, body: "Buenos días" });
    });

    it("toma atómica: un job con otra hora o repetido no vuelve a enviar", async () => {
      const { provider, calls } = fakeProvider();
      const job = await due();
      expect(await dispatch.dispatchScheduled(provider, job.id, job.sendAtMs + 60_000)).toBe("skipped");
      expect(calls).toHaveLength(0);
      const results = await Promise.all([
        dispatch.dispatchScheduled(provider, job.id, job.sendAtMs),
        dispatch.dispatchScheduled(provider, job.id, job.sendAtMs),
      ]);
      expect(results.sort()).toEqual(["sent", "skipped"]);
      expect(calls).toHaveLength(1);
    });

    it("se cancela solo si el cliente escribió DESPUÉS de programarlo (y la casilla está activa)", async () => {
      const { provider, calls } = fakeProvider();
      const programmedAt = new Date(Date.now() - HOUR);
      await inbound(new Date(programmedAt.getTime() - 60_000)); // antes de programar: no cuenta
      const first = await due({ programmedAt });
      expect(await dispatch.dispatchScheduled(provider, first.id, first.sendAtMs)).toBe("sent");

      await inbound(new Date(Date.now() - 30 * 60_000)); // después de programar
      const second = await due({ programmedAt });
      expect(await dispatch.dispatchScheduled(provider, second.id, second.sendAtMs)).toBe("cancelled");
      expect(await row(second.id)).toMatchObject({ status: "cancelled", cancelReason: "cliente_escribio" });

      const third = await due({ programmedAt, cancelIfInbound: false });
      expect(await dispatch.dispatchScheduled(provider, third.id, third.sendAtMs)).toBe("sent");
      expect(calls).toHaveLength(2);
    });

    it("texto con la ventana cerrada al disparar → falla visible (window_closed), sin llamar al proveedor", async () => {
      const { provider, calls } = fakeProvider();
      const job = await due();
      await setWindow(new Date(Date.now() - 1_000));
      expect(await dispatch.dispatchScheduled(provider, job.id, job.sendAtMs)).toBe("failed");
      expect(await row(job.id)).toMatchObject({ status: "failed", errorCode: "window_closed" });
      expect(calls).toHaveLength(0);
    });

    it("plantilla con la ventana cerrada sí se envía; rechazo del proveedor queda como provider_rejected", async () => {
      const ok = fakeProvider();
      const job = await due({ kind: "template" });
      await setWindow(new Date(Date.now() - 1_000));
      expect(await dispatch.dispatchScheduled(ok.provider, job.id, job.sendAtMs)).toBe("sent");
      expect(ok.calls).toEqual([expect.objectContaining({ kind: "template" })]);

      const bad = fakeProvider({ reject: true });
      const other = await due({ kind: "template" });
      expect(await dispatch.dispatchScheduled(bad.provider, other.id, other.sendAtMs)).toBe("failed");
      expect(await row(other.id)).toMatchObject({ status: "failed", errorCode: "provider_rejected" });
    });

    it("si quien lo programó ya no está activo, se cancela a la vista sin enviar", async () => {
      const { provider, calls } = fakeProvider();
      await db.insert(s.member).values({ id: "m_sched", organizationId: ORG, userId: USER, role: "agent", createdAt: new Date() });
      await db.update(s.user).set({ banned: true }).where(eq(s.user.id, USER));
      const job = await due();
      expect(await dispatch.dispatchScheduled(provider, job.id, job.sendAtMs)).toBe("cancelled");
      expect(await row(job.id)).toMatchObject({ status: "cancelled", cancelReason: "autor_inactivo" });
      expect(calls).toHaveLength(0);
      expect((await store.listScheduledForConversation(ORG, CONV)).map((v) => v.cancelReason)).toEqual(["autor_inactivo"]);
    });

    it("más de 2 h tarde (worker detenido) no se manda solo: falla visible y se puede reintentar", async () => {
      const { provider, calls } = fakeProvider();
      const job = await due();
      const late = new Date(job.sendAtMs + 2 * HOUR + 60_000);
      expect(await dispatch.dispatchScheduled(provider, job.id, job.sendAtMs, late)).toBe("failed");
      expect(await row(job.id)).toMatchObject({ status: "failed", errorCode: "late" });
      expect(calls).toHaveLength(0);
      expect((await store.listScheduledForConversation(ORG, CONV))[0].canRetry).toBe(true);
    });

    it("un rechazo de WhatsApp se reintenta desde la burbuja, no desde la franja (sin duplicar)", async () => {
      const bad = fakeProvider({ reject: true });
      const job = await due();
      expect(await dispatch.dispatchScheduled(bad.provider, job.id, job.sendAtMs)).toBe("failed");
      expect((await store.listScheduledForConversation(ORG, CONV))[0].canRetry).toBe(false);
      await expect(store.retryScheduled(ORG, job.id)).rejects.toThrow(/desde el mensaje en el chat/);
    });

    it("barrido: un 'sending' atorado sin saliente pasa a fallido SIN reintento; uno reciente no se toca", async () => {
      const old = await due();
      const fresh = await due();
      await db.update(s.scheduledMessages).set({ status: "sending", updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.scheduledMessages.id, old.id));
      await db.update(s.scheduledMessages).set({ status: "sending", updatedAt: new Date() }).where(eq(s.scheduledMessages.id, fresh.id));
      expect(await dispatch.failStuckSending()).toBe(1);
      expect(await row(old.id)).toMatchObject({ status: "failed", errorCode: "interrupted" });
      expect((await row(fresh.id)).status).toBe("sending");
      // No se sabe si salió: reintentar con otra clave podría duplicarlo.
      const view = (await store.listScheduledForConversation(ORG, CONV)).find((v) => v.id === old.id);
      expect(view?.canRetry).toBe(false);
      await expect(store.retryScheduled(ORG, old.id)).rejects.toThrow(/No se sabe si salió/);
    });

    it("barrido: si el worker cayó DESPUÉS de enviar, el atorado se concilia como enviado (no se reenvía)", async () => {
      const job = await due();
      const claimedAt = new Date(Date.now() - 12 * 60_000);
      await db.update(s.scheduledMessages).set({ status: "sending", updatedAt: claimedAt }).where(eq(s.scheduledMessages.id, job.id));
      // El saliente que sí se creó antes de la caída (mismo autor y texto, desde la toma).
      await db.insert(s.messages).values({
        id: "m_ya_salio",
        organizationId: ORG,
        conversationId: CONV,
        direction: "out",
        source: "crm",
        type: "text",
        body: "Buenos días",
        status: "sent",
        sentByUserId: USER,
        sentAt: claimedAt,
      });
      expect(await dispatch.failStuckSending()).toBe(1);
      expect(await row(job.id)).toMatchObject({ status: "sent", messageId: "m_ya_salio" });
    });

    it("barrido: no enlaza el saliente de OTRO programado igual, ni uno muy posterior a la toma", async () => {
      const a = await due();
      const b = await due();
      const claimedAt = new Date(Date.now() - 12 * 60_000);
      await db.update(s.scheduledMessages).set({ status: "sending", updatedAt: claimedAt }).where(eq(s.scheduledMessages.id, a.id));
      const out = (id: string, sentAt: Date) => ({
        id,
        organizationId: ORG,
        conversationId: CONV,
        direction: "out" as const,
        source: "crm" as const,
        type: "text" as const,
        body: "Buenos días",
        status: "sent" as const,
        sentByUserId: USER,
        sentAt,
      });
      // El de B (ya enlazado a B) y uno escrito a mano 10 min después: ninguno es de A.
      await db.insert(s.messages).values([out("m_de_b", claimedAt), out("m_a_mano", new Date(claimedAt.getTime() + 10 * 60_000))]);
      await db.update(s.scheduledMessages).set({ status: "sent", messageId: "m_de_b" }).where(eq(s.scheduledMessages.id, b.id));
      expect(await dispatch.failStuckSending()).toBe(1);
      expect(await row(a.id)).toMatchObject({ status: "failed", errorCode: "interrupted" });
    });

    it("un error inesperado (pudo haber salido) no ofrece Reintentar; 'late' sí", async () => {
      const job = await due();
      await db.update(s.scheduledMessages).set({ status: "failed", errorCode: "unexpected", errorMessage: "x" }).where(eq(s.scheduledMessages.id, job.id));
      expect((await store.listScheduledForConversation(ORG, CONV))[0].canRetry).toBe(false);
      await expect(store.retryScheduled(ORG, job.id)).rejects.toThrow(/No se sabe si salió/);
      await db.update(s.scheduledMessages).set({ errorCode: "late" }).where(eq(s.scheduledMessages.id, job.id));
      expect((await store.listScheduledForConversation(ORG, CONV))[0].canRetry).toBe(true);
    });

    it("dueScheduled: solo los programados vencidos más allá del margen", async () => {
      const job = await due();
      await db.update(s.scheduledMessages).set({ sendAt: new Date(Date.now() - 2 * 60_000) }).where(eq(s.scheduledMessages.id, job.id));
      await due(); // vencido hace 1 s: dentro del margen
      const rows = await store.dueScheduled(new Date(), 30_000);
      expect(rows.map((r) => r.id)).toEqual([job.id]);
    });
  });
});
