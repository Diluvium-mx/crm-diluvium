// Alarma "Agente IA callado" contra Postgres REAL (Bloque C): qué cuenta como "esperando al
// Agente IA" (mismas exclusiones que su barrido), que llegue a los dos vigilantes
// (inboundHealth) y la pastilla/franja con datos del CRM. Bloque E: solo alarma lo de la
// última hora; lo atrasado es un dato. Solo con TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Agente IA callado (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;
  let silence: typeof import("./bot-silence");
  let health: typeof import("./inbound-health");

  const ORG = "org_bc";
  const OTRA = "org_bc_otra";
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // Martes 29-sep-2026 12:00 en Mazatlán (UTC−7).
  const NOW = new Date("2026-09-29T19:00:00Z");
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);
  // El horario del 27–28 sep: fuera de horario un martes al mediodía.
  const MIE_JUE_NOCHE = { days: [3, 4], from: "20:00", to: "06:00" };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ({ sql, eq } = await import("drizzle-orm"));
    silence = await import("./bot-silence");
    health = await import("./inbound-health");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  let seq = 0;
  async function seedOrg(org: string, channel: string, mode: "auto" | "off" = "auto") {
    await db.insert(s.organization).values({ id: org, name: org, slug: org, createdAt: new Date() });
    await db.insert(s.channels).values({
      id: channel,
      organizationId: org,
      type: "whatsapp",
      provider: "zernio",
      providerAccountId: `zacc_${channel}`,
      displayName: "WhatsApp Diluvium",
      aiAgentMode: mode,
    });
    await db.insert(s.aiConfig).values({ organizationId: org, modeloFiltro: "gpt-5.6-luna", modeloCerebro: "claude-sonnet-5", goal: "GOAL: eres Angela." });
  }

  /** Conversación con el último mensaje del cliente hace `minutes` minutos. */
  async function waiting(id: string, minutes: number, opts: { org?: string; channel?: string; importedAt?: Date; windowOpen?: boolean } = {}) {
    const org = opts.org ?? ORG;
    seq++;
    await db.insert(s.contacts).values({ id: `ct_${id}`, organizationId: org, firstName: "Cliente", phoneE164: `+5266811${String(seq).padStart(5, "0")}` });
    await db.insert(s.conversations).values({
      id,
      organizationId: org,
      contactId: `ct_${id}`,
      channelId: opts.channel ?? "ch_bc",
      providerConversationId: `zconv_${id}`,
      windowExpiresAt: opts.windowOpen === false ? ago(1) : new Date(NOW.getTime() + 23 * HOUR),
      lastMessageAt: ago(minutes),
    });
    return msg(id, { direction: "in", minutes, org, importedAt: opts.importedAt });
  }

  async function msg(conversationId: string, opts: { direction: "in" | "out"; minutes: number; org?: string; source?: "ai_agent" | "crm"; importedAt?: Date }) {
    seq++;
    const id = `m_bc_${seq}`;
    await db.insert(s.messages).values({
      id,
      organizationId: opts.org ?? ORG,
      conversationId,
      direction: opts.direction,
      source: opts.direction === "in" ? "contact" : (opts.source ?? "ai_agent"),
      type: "text",
      body: "hola",
      attachments: [],
      providerMessageId: `wamid.bc.${seq}`,
      status: opts.direction === "in" ? "received" : "sent",
      sentAt: ago(opts.minutes),
      createdAt: ago(opts.minutes),
      importedAt: opts.importedAt ?? null,
    });
    return id;
  }

  beforeEach(async () => {
    await db.execute(
      sql`truncate ai_usage, ai_agent_drafts, ai_agent_notices, ai_config_changes, ai_config, webhook_events, messages, conversations, channels, contacts, organization cascade`,
    );
    await seedOrg(ORG, "ch_bc");
    // Los 3 que esperan de verdad (40, 25 y 18 min sin respuesta).
    await waiting("c1", 40);
    await waiting("c2", 25);
    await waiting("c3", 18);
  });

  const check = () => silence.checkBotSilence({ now: NOW, env: {} });

  it("24/7, canal Encendido, 3 clientes esperando más de 15 min y el bot sin mandar nada → ALERTA (solo conteos y horas)", async () => {
    const report = await check();
    expect(report.problems).toEqual([
      "el Agente IA no está contestando: 3 cliente(s) escribieron en la última hora y esperan respuesta hace más de 15 min " +
        "(el más antiguo desde las 11:20, Mazatlán); última respuesta del Agente IA: ninguna en 24 h",
    ]);
    expect(report.metrics).toEqual({ waiting: 3, backlog: 0, silentOrganizations: 1, lastReplyMinutesAgo: null });
  });

  it("Bloque E: 74 chats atrasados (de 2 a 20 h) + noche sin que el Agente IA mande nada → NO suena; son un dato", async () => {
    await db.execute(sql`truncate messages, conversations, contacts cascade`);
    for (let i = 0; i < 74; i++) await waiting(`viejo${i}`, 120 + i * 15);
    const report = await check();
    expect(report.problems).toEqual([]);
    expect(report.metrics).toEqual({ waiting: 0, backlog: 74, silentOrganizations: 0, lastReplyMinutesAgo: null });
    expect((await silence.loadBotStatus(ORG, NOW))?.lines).toContainEqual({
      label: "Atrasados (más de 1 h)",
      value: "74 chats esperan a un vendedor",
      tone: "neutral",
    });

    // Llegan 3 clientes nuevos y nadie les contesta en más de 15 min → SUENA (cuenta solo los 3).
    await waiting("nuevo1", 16);
    await waiting("nuevo2", 30);
    await waiting("nuevo3", 59);
    const again = await check();
    expect(again.problems).toHaveLength(1);
    expect(again.problems[0]).toMatch(/^el Agente IA no está contestando: 3 cliente\(s\) escribieron en la última hora/);
    expect(again.metrics).toMatchObject({ waiting: 3, backlog: 74, silentOrganizations: 1 });
  });

  it("mismas exclusiones que el bot: pausado, tarjeta de error, importado, ya decidido, reciente, contestado, ventana cerrada, antes de encender", async () => {
    // Pausado por un vendedor.
    await waiting("c_pausa", 30);
    await db.update(s.conversations).set({ agentState: "pausado_humano" }).where(eq(s.conversations.id, "c_pausa"));
    // Tarjeta de error sin atender.
    await waiting("c_error", 30);
    await db.insert(s.aiAgentNotices).values({ id: "n_bc", organizationId: ORG, conversationId: "c_error", kind: "agente_error", body: "falló", createdAt: ago(29) });
    // Copiado del historial del celular.
    await waiting("c_importado", 30, { importedAt: ago(1) });
    // El agente ya decidió no contestar (p. ej. "gracias").
    const atendido = await waiting("c_atendido", 30);
    await db.insert(s.aiUsage).values({ id: "u_bc", organizationId: ORG, conversationId: "c_atendido", messageId: atendido, stage: "filtro", provider: "openai", modelId: "gpt-5.6-luna", latencyMs: 10, outcome: "skipped" });
    // Menos de 15 min esperando.
    await waiting("c_reciente", 5);
    // Ya contestada por el bot (hace 25 min: no cuenta como "respuesta en los últimos 15").
    await waiting("c_respondida", 30);
    await msg("c_respondida", { direction: "out", minutes: 25 });
    // Ventana de 24 h cerrada.
    await waiting("c_ventana", 30, { windowOpen: false });
    // Escrito antes de encender el canal.
    await db.update(s.channels).set({ aiAgentModeChangedAt: ago(20) }).where(eq(s.channels.id, "ch_bc"));

    const report = await check();
    // c1 (40 min) quedó antes del encendido; c2 (25) también; solo c3 (18) es posterior.
    expect(report.metrics.waiting).toBe(1);
    expect(report.problems).toEqual([]);

    // Sin el corte del encendido: c1, c2 y c3 (las exclusiones siguen fuera).
    await db.update(s.channels).set({ aiAgentModeChangedAt: null }).where(eq(s.channels.id, "ch_bc"));
    const again = await check();
    expect(again.metrics.waiting).toBe(3);
    expect(again.problems).toHaveLength(1);
  });

  it("solo 2 esperando no alerta", async () => {
    await db.update(s.conversations).set({ agentState: "pausado_humano" }).where(eq(s.conversations.id, "c3"));
    const report = await check();
    expect(report.metrics.waiting).toBe(2);
    expect(report.problems).toEqual([]);
  });

  it("si el bot contestó en otra conversación en los últimos 15 min, no está callado", async () => {
    await waiting("c_otro", 20);
    await msg("c_otro", { direction: "out", minutes: 5 });
    const report = await check();
    expect(report.problems).toEqual([]);
    expect(report.metrics.lastReplyMinutesAgo).toBe(5);
  });

  it("un saliente de un VENDEDOR no cuenta como respuesta del bot", async () => {
    await waiting("c_otro", 20);
    await msg("c_otro", { direction: "out", minutes: 5, source: "crm" });
    expect((await check()).problems).toHaveLength(1);
  });

  it("fuera del horario del bot (mié–jue 20:00–06:00, martes al mediodía): no alerta 'callado'", async () => {
    await db.update(s.aiConfig).set({ botSchedule: MIE_JUE_NOCHE }).where(eq(s.aiConfig.organizationId, ORG));
    expect((await check()).problems).toEqual([]);
  });

  it("horario cambiado hace 5 min en Opciones (el bot está repartiendo lo pendiente): todavía no alerta", async () => {
    await db.insert(s.aiConfigChanges).values({ id: "chg_bc", organizationId: ORG, field: "schedule", oldValue: "mié–jue", newValue: "24/7", createdAt: ago(5) });
    expect((await check()).problems).toEqual([]);
    // Otra opción cambiada no cuenta.
    await db.update(s.aiConfigChanges).set({ field: "responseDelaySeconds" }).where(eq(s.aiConfigChanges.id, "chg_bc"));
    expect((await check()).problems).toHaveLength(1);
  });

  it("canal Apagado: no alerta 'callado' (lo muestran la pastilla y la franja)", async () => {
    await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_bc"));
    expect((await check()).problems).toEqual([]);
  });

  it("llega a los DOS vigilantes: inboundHealth (worker y /api/health/inbound) lo reporta", async () => {
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => 10, checkZernio: false, now: NOW });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" | ")).toMatch(/el Agente IA no está contestando: 3 cliente\(s\)/);
    expect(report.metrics.bot).toEqual({ waiting: 3, backlog: 0, silentOrganizations: 1, lastReplyMinutesAgo: null });
  });

  describe("pastilla 'Agente IA' y franja (datos del CRM, sin Zernio)", () => {
    it("callado → rojo; otra organización no se mezcla", async () => {
      await seedOrg(OTRA, "ch_bc_otra");
      for (const id of ["o1", "o2", "o3", "o4"]) await waiting(id, 30, { org: OTRA, channel: "ch_bc_otra" });
      await msg("o1", { direction: "out", minutes: 1, org: OTRA }); // el Agente IA de la otra sí contesta
      const mine = await silence.loadBotStatus(ORG, NOW);
      expect(mine).toMatchObject({ tone: "red", label: "Agente IA callado" });
      expect(mine?.lines).toContainEqual({ label: "Sin respuesta hace más de 15 min (de la última hora)", value: "3 conversación(es)", tone: "red" });
      const other = await silence.loadBotStatus(OTRA, NOW);
      expect(other).toMatchObject({ tone: "green", label: "Agente IA contestando" });
    });

    it("fuera de horario → ámbar y franja; apagado → rojo y franja; 24/7 sin nadie esperando → verde y sin franja", async () => {
      await db.update(s.aiConfig).set({ botSchedule: MIE_JUE_NOCHE }).where(eq(s.aiConfig.organizationId, ORG));
      expect(await silence.loadBotStatus(ORG, NOW)).toMatchObject({ tone: "amber", label: "Agente IA fuera de horario" });
      expect(await silence.loadBotBanner(ORG)).toEqual({ channels: [{ displayName: "WhatsApp Diluvium", on: true }], schedule: MIE_JUE_NOCHE });

      await db.update(s.channels).set({ aiAgentMode: "off" }).where(eq(s.channels.id, "ch_bc"));
      expect(await silence.loadBotStatus(ORG, NOW)).toMatchObject({ tone: "red", label: "Agente IA apagado" });

      await db.update(s.aiConfig).set({ botSchedule: null }).where(eq(s.aiConfig.organizationId, ORG));
      expect(await silence.loadBotBanner(ORG)).toEqual({ channels: [{ displayName: "WhatsApp Diluvium", on: false }], schedule: null });

      await db.update(s.channels).set({ aiAgentMode: "auto" }).where(eq(s.channels.id, "ch_bc"));
      await db.execute(sql`truncate messages, conversations cascade`);
      expect(await silence.loadBotBanner(ORG)).toBeNull();
      expect(await silence.loadBotStatus(ORG, NOW)).toMatchObject({ tone: "green", label: "Agente IA contestando" });
    });
  });
});
