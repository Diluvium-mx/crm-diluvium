// Salud de la entrada de WhatsApp contra Postgres REAL (conteos y silencio).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isBusinessHours } from "./business-hours";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe("horario laboral (Mazatlán, lun–sáb 9–19)", () => {
  it.each([
    ["2026-09-22T16:00:00Z", true], // martes 9:00
    ["2026-09-22T15:59:00Z", false], // martes 8:59
    ["2026-09-23T01:59:00Z", true], // martes 18:59
    ["2026-09-23T02:00:00Z", false], // martes 19:00
    ["2026-09-27T18:00:00Z", false], // domingo 11:00
  ])("%s → %s", (iso, expected) => expect(isBusinessHours(new Date(iso))).toBe(expected));
});

describe.skipIf(!TEST_DATABASE_URL)("inboundHealth (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let health: typeof import("./inbound-health");
  let sql: typeof import("drizzle-orm").sql;
  const saved = { ...process.env };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    health = await import("./inbound-health");
    ({ sql } = await import("drizzle-orm"));
    // Sin Zernio en pruebas: la revisión del webhook se omite (no hay APP_URL).
    delete process.env.APP_URL;
  });

  beforeEach(async () => {
    await db.execute(sql`truncate webhook_events`);
  });

  afterAll(async () => {
    process.env = saved;
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const tuesday10am = new Date("2026-09-22T17:00:00Z");

  it("sano: evento reciente, nada pendiente, worker con latido", async () => {
    await db.insert(s.webhookEvents).values({ id: "e1", provider: "zernio", event: "message.received", payload: {}, processedAt: new Date() });
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => 30, checkZernio: false, now: tuesday10am });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("detecta silencio en horario laboral, pendientes viejos, dead-letter, cuarentena y worker caído", async () => {
    await db.insert(s.webhookEvents).values([
      { id: "old", provider: "zernio", event: "message.received", payload: {}, receivedAt: sql`localtimestamp - interval '2 hours'` },
      { id: "dead", provider: "zernio", event: "message.received", payload: {}, receivedAt: sql`localtimestamp - interval '3 hours'`, deadLetteredAt: new Date(), attempts: 20 },
      { id: "q", provider: "zernio", event: "message.received", payload: {}, receivedAt: sql`localtimestamp - interval '3 hours'`, quarantinedAt: new Date() },
    ]);
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => null, checkZernio: false, now: tuesday10am });
    expect(report.ok).toBe(false);
    expect(report.metrics).toMatchObject({ stuckPending: 1, deadLetters: 1, quarantined: 1 });
    expect(report.problems.join(" | ")).toMatch(/sin mensajes entrantes/);
    expect(report.problems.join(" | ")).toMatch(/latido/);
  });

  it("fuera de horario el silencio no es alerta", async () => {
    await db.insert(s.webhookEvents).values({
      id: "old2", provider: "zernio", event: "message.received", payload: {}, processedAt: new Date(),
      receivedAt: sql`localtimestamp - interval '5 hours'`,
    });
    const sunday = new Date("2026-09-27T18:00:00Z");
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => 10, checkZernio: false, now: sunday });
    expect(report.ok).toBe(true);
  });

  it("solo cuentan los mensajes ENTRANTES: estados o ecos recientes no tapan el silencio", async () => {
    await db.insert(s.webhookEvents).values([
      { id: "in_viejo", provider: "zernio", event: "message.received", payload: {}, processedAt: new Date(), receivedAt: sql`localtimestamp - interval '3 hours'` },
      { id: "estado", provider: "zernio", event: "message.read", payload: {}, processedAt: new Date() },
      { id: "eco", provider: "zernio", event: "message.sent", payload: {}, processedAt: new Date() },
    ]);
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => 10, checkZernio: false, now: tuesday10am });
    expect(report.problems.join(" | ")).toMatch(/sin mensajes entrantes/);
  });

  it("sin configuración de Zernio en el web → problema (no 'sano')", async () => {
    await db.insert(s.webhookEvents).values({ id: "in", provider: "zernio", event: "message.received", payload: {}, processedAt: new Date() });
    const report = await health.inboundHealth({ heartbeatAgeSeconds: async () => 10, checkZernio: true, now: tuesday10am });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" | ")).toMatch(/faltan ZERNIO_API_KEY o APP_URL/);
  });
});
