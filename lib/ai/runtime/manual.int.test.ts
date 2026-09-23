// Acciones manuales del agente (bandeja) contra Postgres REAL: reactivar y
// enviar/descartar borradores. Solo con TEST_DATABASE_URL (base desechable).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("acciones manuales del agente (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let manual: typeof import("./manual");
  let state: typeof import("./state");
  const ORG = "org_m";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    manual = await import("./manual");
    state = await import("./state");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org", createdAt: new Date() },
      { id: "org_otra", name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: "u1", name: "Vendedor", email: "v@x.mx" });
    await db.insert(s.channels).values({
      id: "ch_m",
      organizationId: ORG,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: "zacc_m",
      displayName: "Diluvium",
      aiAgentMode: "borrador",
    });
    await db.insert(s.contacts).values({ id: "ct_m", organizationId: ORG, firstName: "C" });
    await db.insert(s.conversations).values({
      id: "cv_m",
      organizationId: ORG,
      contactId: "ct_m",
      channelId: "ch_m",
      agentState: "pausado_humano",
      agentStateChangedAt: new Date(Date.now() - 3_600_000),
    });
  });

  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, "cv_m")))[0];

  async function draft(status: "pendiente" | "obsoleto" = "pendiente") {
    const id = `d_${crypto.randomUUID()}`;
    await db.insert(s.aiAgentDrafts).values({
      id,
      organizationId: ORG,
      conversationId: "cv_m",
      bubbles: ["Hola", "¿Cuánto mide?"],
      status,
    });
    return id;
  }

  it("reactivar: vuelve a activo, limpia la pausa y mueve el corte a ahora", async () => {
    const now = new Date();
    expect(await manual.reactivateAgentInConversation(ORG, "cv_m", now)).toBe(true);
    const c = await conv();
    expect(c.agentState).toBe("activo");
    expect(c.agentPausedUntil).toBeNull();
    expect(c.agentStateChangedAt?.getTime()).toBe(now.getTime());
    expect(await manual.reactivateAgentInConversation(ORG, "cv_m", now)).toBe(false); // ya activo
  });

  it("reactivar no toca conversaciones de otra organización", async () => {
    expect(await manual.reactivateAgentInConversation("org_otra", "cv_m", new Date())).toBe(false);
    expect((await conv()).agentState).toBe("pausado_humano");
  });

  it("enviar borrador: manda sus burbujas con pausa y queda 'enviado'; un 2º clic no reenvía", async () => {
    const id = await draft();
    const sent: string[] = [];
    const sleeps: number[] = [];
    const send = async (p: { text: string; sentByUserId: string }) => {
      expect(p.sentByUserId).toBe("u1");
      sent.push(p.text);
      return { status: "sent" as const };
    };
    const opts = { organizationId: ORG, draftId: id, userId: "u1", now: new Date(), sendBubble: send, sleep: async (ms: number) => void sleeps.push(ms) };
    expect(await manual.approveDraft(opts)).toEqual({ sent: 2, confirmed: true });
    expect(sent).toEqual(["Hola", "¿Cuánto mide?"]);
    expect(sleeps).toEqual([1_500]);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d).toMatchObject({ status: "enviado", resolvedByUserId: "u1" });
    expect((await conv()).lastAgentReplyAt).not.toBeNull();
    await expect(manual.approveDraft(opts)).rejects.toBeInstanceOf(manual.DraftNotAvailableError);
    expect(sent).toHaveLength(2);
  });

  it("si la primera burbuja falla, el borrador vuelve a 'pendiente' para reintentar", async () => {
    const id = await draft();
    await expect(
      manual.approveDraft({
        organizationId: ORG,
        draftId: id,
        userId: "u1",
        now: new Date(),
        sendBubble: async () => {
          throw new Error("ventana cerrada");
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("ventana cerrada");
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("pendiente");
  });

  it("no se puede enviar un borrador obsoleto ni de otra organización; descartar lo cierra", async () => {
    const old = await draft("obsoleto");
    const base = { userId: "u1", now: new Date(), sendBubble: async () => ({ status: "sent" as const }), sleep: async () => undefined };
    await expect(manual.approveDraft({ ...base, organizationId: ORG, draftId: old })).rejects.toBeInstanceOf(
      manual.DraftNotAvailableError,
    );
    const id = await draft();
    await expect(manual.approveDraft({ ...base, organizationId: "org_otra", draftId: id })).rejects.toBeInstanceOf(
      manual.DraftNotAvailableError,
    );
    await manual.discardDraft({ organizationId: ORG, draftId: id, userId: "u1", now: new Date() });
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("descartado");
  });

  it("aprobar: el borrador queda 'enviando' mientras salen sus burbujas; si apagan el canal en la pausa, se detiene", async () => {
    const id = await draft();
    const seen: string[] = [];
    const sent: string[] = [];
    await manual.approveDraft({
      organizationId: ORG,
      draftId: id,
      userId: "u1",
      now: new Date(),
      sendBubble: async (p) => {
        const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
        seen.push(d.status);
        sent.push(p.text);
        return { status: "sent" as const };
      },
      sleep: async () => {
        await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_m"));
      },
    });
    expect(seen).toEqual(["enviando"]); // nunca "enviado" antes de mandar
    expect(sent).toEqual(["Hola"]); // la 2ª burbuja ya no salió
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("enviado"); // lo que salió, salió
  });

  it("aprobar con la 1ª burbuja sin confirmar: no manda la 2ª y el resto vuelve a la tarjeta con el motivo", async () => {
    const id = await draft();
    const r = await manual.approveDraft({
      organizationId: ORG,
      draftId: id,
      userId: "u1",
      now: new Date(),
      sendBubble: async () => ({ status: "pending" as const }),
      sleep: async () => undefined,
    });
    expect(r).toEqual({ sent: 1, confirmed: false });
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d).toMatchObject({ status: "pendiente", bubbles: ["¿Cuánto mide?"] });
    expect(d.reviewReason).toContain("no confirmó");
  });

  it("aprobar un borrador de UNA burbuja sin confirmar: queda 'enviando' para el barrido", async () => {
    const [id] = [`d_${crypto.randomUUID()}`];
    await db.insert(s.aiAgentDrafts).values({ id, organizationId: ORG, conversationId: "cv_m", bubbles: ["Hola"], status: "pendiente" });
    const r = await manual.approveDraft({
      organizationId: ORG,
      draftId: id,
      userId: "u1",
      now: new Date(),
      sendBubble: async () => ({ status: "pending" as const }),
      sleep: async () => undefined,
    });
    expect(r).toEqual({ sent: 1, confirmed: false });
    expect((await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id)))[0].status).toBe("enviando");
  });

  it("aprobar: si falla la 2ª burbuja, la 1ª cuenta y la 2ª vuelve a la tarjeta con el motivo", async () => {
    const id = await draft();
    let n = 0;
    await expect(
      manual.approveDraft({
        organizationId: ORG,
        draftId: id,
        userId: "u1",
        now: new Date(),
        sendBubble: async () => {
          n++;
          if (n === 2) throw new Error("se cayó el proveedor");
          return { status: "sent" as const };
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("se cayó el proveedor");
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d).toMatchObject({ status: "pendiente", bubbles: ["¿Cuánto mide?"] });
    expect(d.reviewReason).toContain("Se enviaron 1 de 2");
  });

  it("aprobar: si el cliente escribe o un vendedor responde entre burbujas, el resto vuelve a la tarjeta", async () => {
    for (const [who, expected] of [
      ["cliente", "El cliente escribió"],
      ["vendedor", "Un vendedor respondió"],
    ] as const) {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`truncate ai_agent_drafts, messages cascade`);
      const id = await draft();
      const sent: string[] = [];
      const r = await manual.approveDraft({
        organizationId: ORG,
        draftId: id,
        userId: "u1",
        now: new Date(),
        sendBubble: async (p) => {
          sent.push(p.text);
          return { status: "sent" as const };
        },
        sleep: async () => {
          await db.insert(s.messages).values({
            id: `m_${who}_${crypto.randomUUID()}`,
            organizationId: ORG,
            conversationId: "cv_m",
            direction: who === "cliente" ? "in" : "out",
            source: who === "cliente" ? "contact" : "crm",
            type: "text",
            body: "…",
            status: who === "cliente" ? "received" : "sent",
            sentByUserId: who === "cliente" ? null : "u1",
          });
        },
      });
      expect(r.sent).toBe(1);
      expect(sent).toEqual(["Hola"]);
      const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
      expect(d).toMatchObject({ status: "pendiente", bubbles: ["¿Cuánto mide?"] });
      expect(d.reviewReason).toContain(expected);
    }
  });

  it("aprobar: si el cliente escribe o un vendedor responde DURANTE el reclamo, no sale ni la 1ª burbuja", async () => {
    const { sql } = await import("drizzle-orm");
    try {
      for (const who of ["cliente", "vendedor"] as const) {
        await db.execute(sql`truncate ai_agent_drafts, messages cascade`);
        // El mensaje entra en la MISMA sentencia que reclama el borrador (pendiente → enviando):
        // una línea base tomada después del reclamo ya lo incluiría y lo absorbería.
        const row = who === "cliente" ? `'in', 'contact', 'text', '…', 'received', null` : `'out', 'crm', 'text', '…', 'sent', 'u1'`;
        await db.execute(
          sql.raw(`create or replace function test_msg_on_claim() returns trigger language plpgsql as $f$
            begin
              insert into messages (id, organization_id, conversation_id, direction, source, type, body, status, sent_by_user_id)
              values (gen_random_uuid()::text, new.organization_id, new.conversation_id, ${row});
              return new;
            end $f$`),
        );
        await db.execute(
          sql.raw(`create or replace trigger test_msg_on_claim after update on ai_agent_drafts for each row
            when (old.status = 'pendiente' and new.status = 'enviando') execute function test_msg_on_claim()`),
        );
        const id = await draft();
        const sent: string[] = [];
        const r = await manual.approveDraft({
          organizationId: ORG,
          draftId: id,
          userId: "u1",
          now: new Date(),
          sendBubble: async (p) => {
            sent.push(p.text);
            return { status: "sent" as const };
          },
          sleep: async () => undefined,
        });
        expect(r.sent).toBe(0);
        expect(sent).toEqual([]);
        const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
        expect(d).toMatchObject({ status: "pendiente", bubbles: ["Hola", "¿Cuánto mide?"] });
      }
    } finally {
      await db.execute(sql`drop trigger if exists test_msg_on_claim on ai_agent_drafts`);
      await db.execute(sql`drop function if exists test_msg_on_claim()`);
    }
  });

  it("si la 1ª burbuja falla y ya hay OTRO borrador pendiente, el aprobado queda obsoleto (sin chocar con el índice único)", async () => {
    const id = await draft();
    await expect(
      manual.approveDraft({
        organizationId: ORG,
        draftId: id,
        userId: "u1",
        now: new Date(),
        sendBubble: async () => {
          await draft(); // mientras tanto el agente guardó un borrador nuevo
          throw new Error("ventana cerrada");
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("ventana cerrada");
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("obsoleto");
  });

  it("barrido: un borrador atorado en 'enviando' se concilia con el hilo", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    const mk = async (id: string) =>
      db.insert(s.aiAgentDrafts).values({ id, organizationId: ORG, conversationId: "cv_m", bubbles: ["x"], status: "enviando", resolvedAt: old });
    // Sin saliente del agente → vuelve a pendiente para reintentar.
    await mk("d_sin");
    expect(await reconcileStuckDrafts(new Date())).toBe(1);
    expect((await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_sin")))[0].status).toBe("pendiente");
    // Con su saliente → enviado; y si ya hay otro pendiente, el que no salió queda obsoleto.
    await db.insert(s.messages).values({
      id: "m_ag",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "x",
      status: "sent",
      // sent_at lo pone sendTextMessage con el reloj de la app al mandar (≥ resolved_at).
      sentAt: new Date(old.getTime() + 1_000),
      createdAt: new Date(old.getTime() + 1_000),
    });
    await mk("d_ok");
    await reconcileStuckDrafts(new Date());
    expect((await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_ok")))[0].status).toBe("enviado");
  });

  it("barrido: con un saliente del agente aún en camino espera; si falló queda obsoleto (sin reenviar)", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    await db.insert(s.aiAgentDrafts).values({ id: "d_q", organizationId: ORG, conversationId: "cv_m", bubbles: ["x"], status: "enviando", resolvedAt: old });
    await db.insert(s.messages).values({
      id: "m_q",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "x",
      status: "queued",
      sentAt: new Date(old.getTime() + 1_000),
      createdAt: new Date(old.getTime() + 1_000),
    });
    await reconcileStuckDrafts(new Date());
    const status = async () => (await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_q")))[0].status;
    expect(await status()).toBe("enviando");
    await db.update(s.messages).set({ status: "failed", errorCode: "send_unconfirmed" }).where(eq(s.messages.id, "m_q"));
    await reconcileStuckDrafts(new Date());
    expect(await status()).toBe("obsoleto");
  });

  it("barrido: una respuesta ANTERIOR del agente (segundos antes del plan) no cuenta como burbuja del plan", async () => {
    const { reconcileStuckDrafts } = await import("./sweep");
    const old = new Date(Date.now() - 20 * 60_000);
    // Respuesta previa del agente 3 s antes del plan; el plan de 2 burbujas se guardó y el
    // worker se reinició antes de mandar la 1ª. Nada del plan salió: no se corta ninguna.
    await db.insert(s.messages).values({
      id: "m_prev",
      organizationId: ORG,
      conversationId: "cv_m",
      direction: "out",
      source: "ai_agent",
      type: "text",
      body: "respuesta anterior",
      status: "delivered",
      sentAt: new Date(old.getTime() - 3_000),
      createdAt: new Date(old.getTime() - 3_000),
    });
    await db.insert(s.aiAgentDrafts).values({
      id: "d_plan",
      organizationId: ORG,
      conversationId: "cv_m",
      bubbles: ["Sí incluye el envío", "¿Para cuántas entradas?"],
      status: "enviando",
      resolvedAt: old,
    });
    expect(await reconcileStuckDrafts(new Date())).toBe(1);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, "d_plan"));
    expect(d).toMatchObject({ status: "pendiente", bubbles: ["Sí incluye el envío", "¿Para cuántas entradas?"] });
    expect(d.reviewReason).toBeNull();
  });

  it("canal apagado: el borrador pendiente ya no sale y apagar lo deja obsoleto", async () => {
    const id = await draft();
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_m"));
    const sent: string[] = [];
    const base = { userId: "u1", now: new Date(), sleep: async () => undefined };
    await expect(
      manual.approveDraft({ ...base, organizationId: ORG, draftId: id, sendBubble: async (p) => { sent.push(p.text); return { status: "sent" as const }; } }),
    ).rejects.toBeInstanceOf(manual.DraftNotAvailableError);
    expect(sent).toEqual([]);
    // Lo que hace setChannelAgentMode(off): los pendientes del canal quedan obsoletos (solo de esa org).
    expect(await state.obsoleteChannelDrafts("org_otra", "ch_m", new Date())).toBe(0);
    expect(await state.obsoleteChannelDrafts(ORG, "ch_m", new Date())).toBe(1);
    const [d] = await db.select().from(s.aiAgentDrafts).where(eq(s.aiAgentDrafts.id, id));
    expect(d.status).toBe("obsoleto");
  });
});
