// Retención del dead-letter contra Postgres REAL (punto 9, 7-oct-2026): a los 30 días
// de dead_lettered_at se vacía el payload; la fila se queda para los conteos y el
// replay y la ingesta la saltan.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MessagingProvider } from "./provider";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("dead-letter: el payload se vacía a los 30 días (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let retention: typeof import("./dead-letter-retention");
  let replay: typeof import("./replay");
  let ingest: typeof import("./ingest");
  let health: typeof import("@/lib/monitoring/inbound-health");
  let sql: typeof import("drizzle-orm").sql;
  let provider: MessagingProvider;

  const ORG_A = "org_retencion_a";
  const ORG_B = "org_retencion_b";
  const NOW = new Date("2026-10-07T18:00:00Z");
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  // Lo que traería un webhook real: datos personales del cliente.
  const PAYLOAD = { event: "message.received", message: { from: "+526681234567", text: "Hola, soy Ana Pérez" } };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    retention = await import("./dead-letter-retention");
    replay = await import("./replay");
    ingest = await import("./ingest");
    health = await import("@/lib/monitoring/inbound-health");
    ({ sql } = await import("drizzle-orm"));
    const { ZernioProvider } = await import("./zernio");
    provider = new ZernioProvider({ apiKey: "k", webhookSecret: "s" });
  });

  beforeEach(async () => {
    await db.execute(sql`truncate webhook_events, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Retención A", slug: "retencion-a", createdAt: new Date() },
      { id: ORG_B, name: "Retención B", slug: "retencion-b", createdAt: new Date() },
    ]);
    const dead = (id: string, organizationId: string | null, deadLetteredAt: Date) => ({
      id,
      provider: "zernio" as const,
      event: "message.received",
      payload: PAYLOAD,
      organizationId,
      attempts: 20,
      lastError: "formato no reconocido",
      deadLetteredAt,
    });
    await db.insert(s.webhookEvents).values([
      dead("a_viejo", ORG_A, daysAgo(31)),
      dead("a_reciente", ORG_A, daysAgo(29)),
      dead("b_viejo", ORG_B, daysAgo(45)),
      dead("sin_org_viejo", null, daysAgo(40)),
      // Pendiente viejo (no dead-letter): no es de esta regla.
      { id: "a_pendiente", provider: "zernio", event: "message.received", payload: PAYLOAD, organizationId: ORG_A },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function payloads(): Promise<Record<string, unknown>> {
    const rows = await db.select({ id: s.webhookEvents.id, payload: s.webhookEvents.payload }).from(s.webhookEvents);
    return Object.fromEntries(rows.map((r) => [r.id, r.payload]));
  }

  it("vacía solo los de más de 30 días de ESA organización; no toca los recientes ni los de otra", async () => {
    expect(await retention.emptyExpiredDeadLetterPayloads(ORG_A, NOW)).toBe(1);
    const p = await payloads();
    expect(p.a_viejo).toEqual({ _vaciado: NOW.toISOString() });
    expect(retention.isEmptiedPayload(p.a_viejo)).toBe(true);
    expect(JSON.stringify(p.a_viejo)).not.toContain("526681234567");
    expect(p.a_reciente).toEqual(PAYLOAD);
    expect(p.a_pendiente).toEqual(PAYLOAD);
    expect(p.b_viejo).toEqual(PAYLOAD);
    expect(p.sin_org_viejo).toEqual(PAYLOAD);
    // La fila se queda tal cual, solo sin el payload.
    const [row] = await db.select().from(s.webhookEvents).where(sql`${s.webhookEvents.id} = 'a_viejo'`);
    expect(row).toMatchObject({ organizationId: ORG_A, attempts: 20, lastError: "formato no reconocido", processedAt: null });
    expect(row.deadLetteredAt).not.toBeNull();
    // Idempotente: una segunda pasada no vuelve a tocarla.
    expect(await retention.emptyExpiredDeadLetterPayloads(ORG_A, NOW)).toBe(0);
  });

  it("el barrido del worker pasa organización por organización (y los sin organización); el monitor cuenta igual", async () => {
    const before = await health.inboundHealth({ heartbeatAgeSeconds: async () => 30, checkZernio: false, now: NOW });
    expect(await retention.sweepExpiredDeadLetterPayloads(NOW)).toBe(3);
    const p = await payloads();
    for (const id of ["a_viejo", "b_viejo", "sin_org_viejo"]) expect(retention.isEmptiedPayload(p[id])).toBe(true);
    for (const id of ["a_reciente", "a_pendiente"]) expect(p[id]).toEqual(PAYLOAD);
    const after = await health.inboundHealth({ heartbeatAgeSeconds: async () => 30, checkZernio: false, now: NOW });
    expect(after.metrics.deadLetters).toBe(before.metrics.deadLetters);
    expect(after.metrics.deadLetters).toBe(4);
  });

  it("el replay salta los vaciados (siguen en dead-letter) y reactiva los demás", async () => {
    await retention.sweepExpiredDeadLetterPayloads(NOW);
    const result = await replay.replayWebhookEvents(new Set());
    expect(result).toEqual({ replayed: 2, released: 0, kept: 0, emptied: ["a_viejo", "b_viejo", "sin_org_viejo"] });
    const rows = await db.select().from(s.webhookEvents);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.a_viejo.deadLetteredAt).not.toBeNull();
    expect(byId.a_viejo.attempts).toBe(20);
    expect(byId.a_reciente).toMatchObject({ deadLetteredAt: null, attempts: 0, lastError: null });

    // Pedido por id: también se salta, con el id en la respuesta.
    expect(await replay.replayWebhookEvents(new Set(), ["b_viejo"])).toEqual({ replayed: 0, released: 0, kept: 0, emptied: ["b_viejo"] });
  });

  it("la ingesta no intenta procesar un vaciado: lo dice y no toca la fila", async () => {
    await retention.sweepExpiredDeadLetterPayloads(NOW);
    await expect(ingest.processWebhookEvent(provider, "a_viejo")).resolves.toContain("vaciado");
    const [row] = await db.select().from(s.webhookEvents).where(sql`${s.webhookEvents.id} = 'a_viejo'`);
    expect(row).toMatchObject({ attempts: 20, processedAt: null, lastError: "formato no reconocido" });
  });
});
