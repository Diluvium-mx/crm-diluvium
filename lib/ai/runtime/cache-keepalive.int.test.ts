// Renovación de la caché de 1 h (2-oct-2026; las 24 horas desde el 9-oct) contra Postgres REAL:
// manda el mismo system que una respuesta, con 1 token de salida, y deja su fila "cache_renovada"
// sin conversación; si la reescribe, una sola vez más; nada con la caché vencida. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult, ModelUsage } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Renovación de la caché del Agente IA (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let keepalive: typeof import("./cache-keepalive");
  let brainSystem: typeof import("./brain-system");

  const ORG = "org_cache";
  const SONNET = "claude-sonnet-5";
  const MIN = 60_000;
  // Mediodía en Mazatlán (UTC−7): dentro del horario 7:00–22:00.
  const NOON = new Date("2026-10-02T12:00:00-07:00");
  const NIGHT = new Date("2026-10-02T23:00:00-07:00");

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    keepalive = await import("./cache-keepalive");
    brainSystem = await import("./brain-system");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate ai_usage, ai_knowledge, ai_config, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Diluvium", slug: "org-cache", createdAt: new Date() });
    await db.insert(s.aiConfig).values({ organizationId: ORG, modeloFiltro: "gpt-5.6-luna", modelo1: "gpt-5.6-luna", modeloCerebro: SONNET, goal: "GOAL: eres {{agente.nombre}} de {{empresa.nombre}}." });
    await db.insert(s.aiKnowledge).values({ id: "faq1", organizationId: ORG, question: "¿Envían?", answer: "Sí, a todo México.", position: 1, enabled: true });
  });

  // Fila de una respuesta del cerebro que empezó `minAgo` minutos antes de `at`.
  async function usage(at: Date, minAgo: number, fields: Partial<{ outcome: string; cacheReadTokens: number; cacheWriteTokens: number; modelId: string; latencyMs: number }> = {}) {
    await db.insert(s.aiUsage).values({
      id: crypto.randomUUID(),
      organizationId: ORG,
      stage: "cerebro",
      provider: "anthropic",
      modelId: fields.modelId ?? SONNET,
      inputTokens: 19_000,
      outputTokens: 300,
      cacheReadTokens: fields.cacheReadTokens ?? 18_900,
      cacheWriteTokens: fields.cacheWriteTokens ?? 100,
      latencyMs: fields.latencyMs ?? 0,
      outcome: fields.outcome ?? "sent",
      createdAt: new Date(at.getTime() - minAgo * MIN),
    });
  }

  function fakeModel(read: number) {
    const calls: { modelId: string; input: CallModelInput }[] = [];
    const usageOut: ModelUsage = { inputTokens: 19_001, outputTokens: 1, cacheReadTokens: read, cacheWriteTokens: read ? 0 : 19_000, cacheWrite1hTokens: read ? 0 : 19_000 };
    const callModel = async (modelId: string, input: CallModelInput): Promise<CallModelResult> => {
      calls.push({ modelId, input });
      return { modelId, provider: "anthropic", providerModelId: modelId, text: "", usage: usageOut, finishReason: "length" };
    };
    return { calls, callModel };
  }

  const renewals = () => db.select().from(s.aiUsage).where(d.eq(s.aiUsage.outcome, "cache_renovada"));

  it("a los 52 min renueva con el MISMO system que una respuesta y 1 token de salida", async () => {
    await usage(NOON, 52);
    const m = fakeModel(18_900);
    const sent = await keepalive.keepBrainCacheAlive({ now: () => NOON, callModel: m.callModel, isModelAvailable: () => true });
    expect(sent).toBe(1);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].modelId).toBe(SONNET);
    expect(m.calls[0].input.maxOutputTokens).toBe(1);
    const expected = await brainSystem.loadBrainSystem(ORG, "GOAL: eres {{agente.nombre}} de {{empresa.nombre}}.", { contacto: "", vendedor: "un asesor", empresa: "Diluvium", agente: "Ángela" }, await (await import("@/lib/contacts/funnel-stages")).listFunnelStages(ORG), "balanceada");
    expect(m.calls[0].input.system).toBe(expected);
    expect(m.calls[0].input.system).toContain("Sí, a todo México.");
    const rows = await renewals();
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBeNull();
    expect(rows[0].messageId).toBeNull();
    expect(rows[0].stage).toBe("cerebro");
    expect(rows[0].cacheReadTokens).toBe(18_900);
  });

  it("antes de los 50 min o con la caché vencida no manda nada; de noche sí renueva (9-oct)", async () => {
    const m = fakeModel(18_900);
    const deps = { callModel: m.callModel, isModelAvailable: () => true };
    await usage(NOON, 30);
    expect(await keepalive.keepBrainCacheAlive({ ...deps, now: () => NOON })).toBe(0);
    await db.execute(d.sql`truncate ai_usage`);
    await usage(NOON, 75);
    expect(await keepalive.keepBrainCacheAlive({ ...deps, now: () => NOON })).toBe(0);
    await db.execute(d.sql`truncate ai_usage`);
    expect(m.calls).toHaveLength(0);
    await db.execute(d.sql`truncate ai_usage`);
    await usage(NIGHT, 52);
    expect(await keepalive.keepBrainCacheAlive({ ...deps, now: () => NIGHT })).toBe(1);
  });

  it("la duración de la llamada cuenta: el reloj de la caché empieza al INICIO de la petición", async () => {
    // Guardada hace 49 min, pero tardó 2 min: empezó hace 51 → ya toca.
    await usage(NOON, 49, { latencyMs: 2 * MIN });
    const m = fakeModel(18_900);
    expect(await keepalive.keepBrainCacheAlive({ now: () => NOON, callModel: m.callModel, isModelAvailable: () => true })).toBe(1);
  });

  it("si la renovación no encuentra la caché y la reescribe, cuenta UNA vez: la siguiente toca 50 min después (9-oct)", async () => {
    await usage(NOON, 52);
    const miss = fakeModel(0);
    const deps = { callModel: miss.callModel, isModelAvailable: () => true };
    expect(await keepalive.keepBrainCacheAlive({ ...deps, now: () => NOON })).toBe(1);
    // El intento quedó registrado "ahora" (reloj real); el siguiente barrido, un minuto después.
    const later = new Date(Date.now() + MIN);
    await db.execute(d.sql`truncate ai_usage`);
    await usage(later, 53);
    await db.insert(s.aiUsage).values({ id: crypto.randomUUID(), organizationId: ORG, stage: "cerebro", provider: "anthropic", modelId: SONNET, inputTokens: 19_001, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 19_000, latencyMs: 0, outcome: "cache_renovada", createdAt: new Date(later.getTime() - MIN) });
    const state = await keepalive.cacheState(ORG, SONNET, later);
    // La renovación que reescribió la caché cuenta como "tocada" (la caché nueva quedó viva)…
    expect(state.touch?.getTime()).toBe(later.getTime() - MIN);
    // …y el siguiente barrido no la repite: toca hasta 50 min después de ella.
    expect(state.lastAttempt?.getTime()).toBe(state.touch?.getTime());
    expect(await keepalive.keepBrainCacheAlive({ ...deps, now: () => later })).toBe(0);
  });

  it("si DOS renovaciones seguidas la reescriben, no se repite hasta la siguiente respuesta real", async () => {
    await usage(NOON, 110);
    await usage(NOON, 59, { outcome: "cache_renovada", cacheReadTokens: 0, cacheWriteTokens: 19_000 });
    await usage(NOON, 5, { outcome: "cache_renovada", cacheReadTokens: 0, cacheWriteTokens: 19_000 });
    const state = await keepalive.cacheState(ORG, SONNET, NOON);
    expect(state.touch?.getTime()).toBe(NOON.getTime() - 110 * MIN);
    expect(state.lastAttempt!.getTime()).toBeGreaterThan(state.touch!.getTime());
    const m = fakeModel(0);
    expect(await keepalive.keepBrainCacheAlive({ now: () => new Date(NOON.getTime() + 47 * MIN), callModel: m.callModel, isModelAvailable: () => true })).toBe(0);
  });

  it("una renovación que falló (sin tokens) no cuenta como tocada", async () => {
    await usage(NOON, 53);
    await usage(NOON, 1, { outcome: "cache_renovada", cacheReadTokens: 0, cacheWriteTokens: 0 });
    const state = await keepalive.cacheState(ORG, SONNET, NOON);
    expect(state.touch?.getTime()).toBe(NOON.getTime() - 53 * MIN);
    expect(state.lastAttempt!.getTime()).toBeGreaterThan(state.touch!.getTime());
  });

  it("una renovación que sí leyó la caché cuenta como tocada: la siguiente toca 50 min después", async () => {
    await usage(NOON, 110);
    await usage(NOON, 52, { outcome: "cache_renovada", cacheReadTokens: 18_900, cacheWriteTokens: 0 });
    const state = await keepalive.cacheState(ORG, SONNET, NOON);
    expect(state.touch?.getTime()).toBe(NOON.getTime() - 52 * MIN);
    expect(state.lastAttempt?.getTime()).toBe(state.touch?.getTime());
    const m = fakeModel(18_900);
    expect(await keepalive.keepBrainCacheAlive({ now: () => NOON, callModel: m.callModel, isModelAvailable: () => true })).toBe(1);
  });

  it("solo modelos de Anthropic con llave: Luna (OpenAI) o Sonnet sin llave no se renuevan", async () => {
    await usage(NOON, 52, { modelId: "gpt-5.6-luna" });
    await usage(NOON, 52);
    const m = fakeModel(18_900);
    expect(await keepalive.keepBrainCacheAlive({ now: () => NOON, callModel: m.callModel, isModelAvailable: () => false })).toBe(0);
    expect(await keepalive.keepBrainCacheAlive({ now: () => NOON, callModel: m.callModel, isModelAvailable: () => true })).toBe(1);
    expect(m.calls.map((c) => c.modelId)).toEqual([SONNET]);
  });
});
