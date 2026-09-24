// Pagos confirmados contra una base real: la referencia es única por organización.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("pagos confirmados", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let pagos: typeof import("./pagos");
  const ORG = "org_pagos";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    pagos = await import("./pagos");
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate pagos_confirmados, datos_cobro, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Org", slug: "org", createdAt: new Date() },
      { id: "org_otra", name: "Otra", slug: "otra", createdAt: new Date() },
    ]);
    await db.insert(s.channels).values({ id: "ch_p", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z", displayName: "D" });
    await db.insert(s.contacts).values({ id: "c_p", organizationId: ORG, firstName: "Ana", phoneE164: "+526681112244", montoCotizacion: "7000.00" });
    await db.insert(s.conversations).values({ id: "cv_p", organizationId: ORG, contactId: "c_p", channelId: "ch_p", providerConversationId: "zp", lastMessageAt: new Date() });
    await db.insert(s.datosCobro).values({ organizationId: ORG, beneficiario: "Diluvium SA de CV", clabe: "002010077777777771" });
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  it("una referencia confirmada no se puede volver a confirmar en la misma organización (captura reenviada)", async () => {
    await pagos.registrarPagoConfirmado({ organizationId: ORG, conversationId: "cv_p", contactId: "c_p", referencia: "abc 123", montoMxn: 3500, tipo: "anticipo", banco: "BBVA", fechaComprobante: "23/09/2026", confirmadoPor: "agente" });
    expect(await pagos.referenciaYaUsada(ORG, "ABC123")).toBe(true);
    expect(await pagos.referenciaYaUsada(ORG, "abc 123")).toBe(true);
    expect(await pagos.referenciaYaUsada("org_otra", "ABC123")).toBe(false);
    await expect(
      pagos.registrarPagoConfirmado({ organizationId: ORG, conversationId: "cv_p", contactId: "c_p", referencia: "ABC123", montoMxn: 3500, tipo: "liquidacion", banco: null, fechaComprobante: null, confirmadoPor: "agente" }),
    ).rejects.toThrow(pagos.ReferenciaDuplicadaError);
  });

  it("el contexto trae lo cotizado del contacto, los Datos de cobro y el anticipo ya confirmado", async () => {
    await pagos.registrarPagoConfirmado({ organizationId: ORG, conversationId: "cv_p", contactId: "c_p", referencia: "R1", montoMxn: 3500, tipo: "anticipo", banco: null, fechaComprobante: null, confirmadoPor: "agente" });
    const ctx = await pagos.contextoParaComprobante(ORG, "cv_p", "c_p", "R1");
    expect(ctx).toMatchObject({ totalCotizado: 7000, anticipoConfirmado: 3500, referenciaYaUsada: true });
    expect(ctx.datosCobro.clabe).toBe("002010077777777771");
  });
});
