// Freno ante contestadores automáticos (7-oct-2026, caso Estafeta) contra Postgres REAL: el
// Agente IA no contesta la 3.ª vuelta seguida sin nada nuevo, se pausa hasta «Activar», deja el
// aviso 🤖 una sola vez (tarjeta amarilla en el Embudo), la fila del Historial y deja los
// seguimientos como sugerencia; «Activar» atiende el aviso y vuelve a contar desde cero. Una
// persona real no se frena. Modelos y WhatsApp son dobles. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

const NO_ENTENDI = "Perdón, no estoy seguro de haber entendido bien. ¿Podrías preguntar dando más detalle por favor?";
const UNSUPPORTED = { unsupported: { code: 131051, type: "unknown", title: "Message type unknown", details: "Message type is currently not supported." } };

describe.skipIf(!TEST_DATABASE_URL)("freno ante contestadores automáticos (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let eq: typeof import("drizzle-orm").eq;
  let run: typeof import("./run");
  let manual: typeof import("./manual");
  let pause: typeof import("./pause");
  let options: typeof import("./options");
  let contestador: typeof import("./contestador");
  let send: typeof import("@/lib/messaging/send");
  let executor: typeof import("@/lib/workflows/executor");
  let signals: typeof import("@/lib/contacts/funnel-signals");
  let followups: typeof import("@/lib/followups/store");

  const ORG = "org_cb";
  const CONV = "conv_cb";
  const CONTACT = "ct_cb";
  const JOB = { organizationId: ORG, conversationId: CONV };
  const HOUR = 3_600_000;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    run = await import("./run");
    manual = await import("./manual");
    pause = await import("./pause");
    options = await import("./options");
    contestador = await import("./contestador");
    send = await import("@/lib/messaging/send");
    executor = await import("@/lib/workflows/executor");
    signals = await import("@/lib/contacts/funnel-signals");
    followups = await import("@/lib/followups/store");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    t = Date.now() - 2 * HOUR;
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`truncate change_history, ai_config_changes, ai_usage, ai_agent_drafts, ai_agent_notices, ai_knowledge, ai_config, messages, conversations, channels, contacts, organization, "user" cascade`,
    );
    options.clearBotOptionsCache();
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-cb", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u_vendedor", name: "Daniel", email: "d@x.mx" });
    await db.insert(s.channels).values({ id: "ch_cb", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_cb", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "+525552708300", phoneE164: "+525552708300" });
    await db.insert(s.conversations).values({
      id: CONV,
      organizationId: ORG,
      contactId: CONTACT,
      channelId: "ch_cb",
      providerConversationId: "zconv_cb",
      windowExpiresAt: new Date(Date.now() + 23 * HOUR),
      lastMessageAt: new Date(),
    });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL DE PRUEBA: eres Angela." });
    await db.update(s.funnelStages).set({ modelSlot: 2 }).where(eq(s.funnelStages.organizationId, ORG));
  });

  // Reloj de la conversación: cada mensaje 20 s después del anterior. Tras una respuesta real del
  // Agente IA (sale con la hora de ahora), `alDia()` hace que lo siguiente llegue después de ella.
  let seq = 0;
  let t = 0;
  const alDia = () => {
    t = Math.max(t, Date.now());
  };
  async function msg(opts: { direction: "in" | "out"; body: string; source?: "contact" | "crm" | "ai_agent"; metadata?: Record<string, unknown> }) {
    seq++;
    t += 20_000;
    const at = new Date(t);
    const source = opts.source ?? (opts.direction === "in" ? "contact" : "ai_agent");
    await db.insert(s.messages).values({
      id: `m_cb_${seq}`,
      organizationId: ORG,
      conversationId: CONV,
      direction: opts.direction,
      source,
      type: "text",
      body: opts.body,
      providerMessageId: `wamid.cb.${seq}`,
      status: opts.direction === "in" ? "received" : "sent",
      sentByUserId: source === "crm" ? "u_vendedor" : null,
      metadata: opts.metadata ?? null,
      sentAt: at,
      createdAt: at,
    });
  }
  const estafeta = async () => {
    await msg({ direction: "in", body: NO_ENTENDI });
    await msg({ direction: "in", body: "[Unsupported message]", metadata: UNSUPPORTED });
  };

  let replies = 0;
  function makeDeps() {
    const delivered: string[] = [];
    const calls: { modelId: string; input: CallModelInput }[] = [];
    const provider = {
      name: "zernio",
      sendText: async ({ text }: { text: string }) => {
        delivered.push(text);
        return { providerInternalId: `z_${crypto.randomUUID()}`, providerMessageId: `wamid.out.${crypto.randomUUID()}` };
      },
    } as unknown as import("@/lib/messaging/provider").MessagingProvider;
    const deps: import("./run").RunDeps = {
      now: () => new Date(),
      callModel: async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
        calls.push({ modelId, input });
        return {
          modelId,
          provider: "anthropic",
          providerModelId: modelId,
          text: `Respuesta ${++replies}: la compuerta cuesta $5,500 MXN.`,
          usage: { inputTokens: 1_000, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
          finishReason: "stop",
          toolCalls: [],
        };
      },
      sendBubble: (p) => send.sendAgentText(provider, p),
      sleep: async () => undefined,
      resolveImage: async (key) => `https://bucket.test/${key}?sig=1`,
      startWorkflow: (input) => executor.startWorkflowRun(input),
      isModelAvailable: () => true,
    };
    return { deps, calls, delivered };
  }

  const conv = async () => (await db.select().from(s.conversations).where(eq(s.conversations.id, CONV)))[0];
  const notices = async () => (await db.select().from(s.aiAgentNotices).where(eq(s.aiAgentNotices.conversationId, CONV))).filter((n) => n.kind === "contestador");

  it("caso Estafeta: la 3.ª vuelta seguida con el mismo «no entendí» no se contesta; pausa, aviso, Historial y seguimientos como sugerencia; «Activar» vuelve a contar", async () => {
    await msg({ direction: "in", body: "[Unsupported message]", metadata: UNSUPPORTED });
    await msg({ direction: "out", body: "Hola, ¿en qué le podemos ayudar con las compuertas anti inundaciones?" });
    await estafeta();
    await msg({ direction: "out", body: "Claro. ¿Qué desea conocer con más detalle?" });
    await estafeta();
    await msg({ direction: "out", body: "¿Usted tiene problemas de inundaciones?" });
    await estafeta(); // 2.ª repetición: todavía se contesta
    const second = makeDeps();
    expect((await run.runAgent(JOB, second.deps)).kind).toBe("sent");
    alDia();

    await estafeta(); // 3.ª vuelta seguida sin nada nuevo
    const third = makeDeps();
    expect(await run.runAgent(JOB, third.deps)).toEqual({ kind: "skipped", reason: "contestador_automatico" });
    expect(third.calls).toHaveLength(0); // no se paga otra llamada
    expect(third.delivered).toEqual([]);
    expect(await conv()).toMatchObject({ agentState: "pausado_humano", agentPausedUntil: null });
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0].body).toBe(contestador.AUTO_RESPONDER_NOTICE);
    expect((await signals.funnelSignalsForOrg(ORG))[CONTACT]).toMatchObject({ urgent: true });
    const history = await db.select().from(s.changeHistory).where(eq(s.changeHistory.subjectId, CONV));
    expect(history.map((h) => [h.action, h.userId])).toEqual([["pausa_bucle", null]]);
    // Un seguimiento no sale solo (despertaría otra vez al contestador): queda como sugerencia.
    const c = await conv();
    expect(await followups.manualPauseOf(ORG, CONV, c.agentState, c.agentStateChangedAt)).toBe(true);

    // Otra corrida (barrido, cola) o la siguiente vuelta no repiten el aviso ni llaman al modelo.
    await estafeta();
    const again = makeDeps();
    expect((await run.runAgent(JOB, again.deps)).kind).toBe("skipped");
    expect(again.calls).toHaveLength(0);
    expect(await notices()).toHaveLength(1);

    // «Activar»: la tarjeta del Embudo deja de estar amarilla y la cuenta empieza de cero.
    await manual.reactivateAgentInConversation(ORG, CONV, new Date(t + 1_000), "u_vendedor");
    expect((await signals.funnelSignalsForOrg(ORG))[CONTACT]?.urgent ?? false).toBe(false);
    await estafeta(); // llega después de «Activar»
    expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
  });

  it("una persona que contesta lo mismo corto se sigue contestando, y tras «Activar» solo cuentan las vueltas nuevas", async () => {
    for (const body of ["sí", "sí", "sí"]) {
      await msg({ direction: "in", body });
      expect((await run.runAgent(JOB, makeDeps().deps)).kind).toBe("sent");
      alDia();
    }
    // Un vendedor en medio corta la cuenta: el Agente IA (reactivado) sigue contestando.
    for (const step of ["vendedor", "repite", "repite", "repite"]) {
      if (step === "vendedor") {
        await msg({ direction: "out", body: "Le atiendo yo.", source: "crm" });
        await pause.pauseForHumanReply(ORG, CONV, new Date(t), null, { action: "pausa_auto" });
        await manual.reactivateAgentInConversation(ORG, CONV, new Date(t + 1_000), "u_vendedor");
        continue;
      }
      await msg({ direction: "in", body: NO_ENTENDI });
      if (step === "repite") expect(await run.runAgent(JOB, makeDeps().deps)).toEqual({ kind: "sent", bubbles: 1 });
      alDia();
    }
    expect((await conv()).agentState).toBe("activo");
    expect(await notices()).toHaveLength(0);
  });
});
