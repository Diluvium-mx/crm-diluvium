// Mensaje tapado (5-oct-2026) contra Postgres REAL: WhatsApp da la hora en que el cliente
// ESCRIBIÓ y el mensaje llega segundos después. Si en ese hueco salió una respuesta del CRM, el
// Agente IA debe verlo como posterior a esa respuesta (pendiente, y después en el historial). Y la
// red contra el silencio solo cuenta el workflow del ÚLTIMO mensaje del cliente. Textos inventados.
// Solo corre con TEST_DATABASE_URL apuntando a una base DESECHABLE con las migraciones aplicadas.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");

describe.skipIf(!TEST_DATABASE_URL)("mensaje tapado y red contra el silencio (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let ctx: typeof import("./context");
  let saved: typeof import("./saved-reply");

  const ORG = "org_tap";
  const CONV = "conv_tap";
  const CONTACT = "contact_tap";
  const T0 = new Date("2026-10-04T18:00:00.000Z");
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1_000);

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    ctx = await import("./context");
    saved = await import("./saved-reply");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflows, messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-tap", createdAt: new Date() });
    await db.insert(s.channels).values({ id: "ch_tap", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_tap", displayName: "Diluvium", aiAgentMode: "auto" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Cliente", phoneE164: "+526681112299" });
    await db.insert(s.conversations).values({ id: CONV, organizationId: ORG, contactId: CONTACT, channelId: "ch_tap", providerConversationId: "zconv_tap", lastMessageAt: T0 });
  });

  // `wrote` = hora de WhatsApp (sent_at); `arrived` = cuando el CRM lo guardó (created_at).
  async function msg(id: string, o: { direction: "in" | "out"; wrote: Date; arrived?: Date; imported?: boolean; source?: "contact" | "ai_agent" }) {
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: CONV,
      direction: o.direction,
      source: o.source ?? (o.direction === "in" ? "contact" : "ai_agent"),
      type: "text",
      body: `texto ${id}`,
      providerMessageId: `wamid.tap.${id}`,
      status: o.direction === "in" ? "received" : "sent",
      sentAt: o.wrote,
      createdAt: o.arrived ?? o.wrote,
      importedAt: o.imported ? (o.arrived ?? o.wrote) : null,
    });
  }

  async function keywordRun(id: string, trigger: string, messageIds: string[], status: "queued" | "done" = "done") {
    await db.insert(s.workflows).values({ id: `wf_${id}`, organizationId: ORG, slug: `info_${id}`, name: "Información", enabled: true }).onConflictDoNothing();
    await db.insert(s.workflowRuns).values({ id, organizationId: ORG, workflowId: `wf_${id}`, conversationId: CONV, contactId: CONTACT, trigger: "keyword", triggerMessageId: trigger, status, messageIds });
  }

  const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

  it("llegó después de la respuesta con hora de WhatsApp anterior: queda pendiente y va después en el historial", async () => {
    await msg("in1", { direction: "in", wrote: at(0) });
    await msg("out1", { direction: "out", wrote: at(10) });
    // Escrito a los 9 s (antes de la respuesta), llegó a los 14 s (después).
    await msg("in2", { direction: "in", wrote: at(9), arrived: at(14) });

    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual(["in2"]);
    expect(ids(await ctx.loadHistory(ORG, CONV))).toEqual(["in1", "out1", "in2"]);
    expect(await ctx.outboundTextsSinceLastInbound(ORG, CONV)).toEqual([]);
    expect(await ctx.sentToClientSinceLastInbound(ORG, CONV, ["in2"])).toBe(false);
  });

  it("si llegó antes de que saliera la respuesta, la hora de WhatsApp manda (la respuesta sí lo contestó)", async () => {
    await msg("in1", { direction: "in", wrote: at(0), arrived: at(2) });
    await msg("out1", { direction: "out", wrote: at(10) });
    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual([]);
    expect(ids(await ctx.loadHistory(ORG, CONV))).toEqual(["in1", "out1"]);
  });

  it("una ráfaga del cliente sin respuesta en medio conserva el orden de WhatsApp aunque llegue desordenada", async () => {
    await msg("out1", { direction: "out", wrote: at(0) });
    await msg("inB", { direction: "in", wrote: at(5), arrived: at(6) });
    await msg("inA", { direction: "in", wrote: at(4), arrived: at(8) });
    expect(ids(await ctx.loadHistory(ORG, CONV))).toEqual(["out1", "inA", "inB"]);
    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual(["inA", "inB"]);
  });

  it("el historial copiado del celular conserva su hora y nunca queda pendiente", async () => {
    await msg("out1", { direction: "out", wrote: at(100) });
    // Importado hoy (created_at después de out1) pero escrito mucho antes.
    await msg("old", { direction: "in", wrote: at(0), arrived: at(200), imported: true });
    expect(ids(await ctx.loadHistory(ORG, CONV))).toEqual(["old", "out1"]);
    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual([]);
  });

  it("red contra el silencio: el workflow de un mensaje ANTERIOR no cuenta si el cliente escribió después", async () => {
    await msg("in1", { direction: "in", wrote: at(0) });
    await msg("w1", { direction: "out", wrote: at(1) });
    await msg("w2", { direction: "out", wrote: at(3) });
    await keywordRun("run1", "in1", ["w1", "w2"]);
    await msg("in2", { direction: "in", wrote: at(6), arrived: at(8) });

    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual(["in1", "in2"]);
    expect(await ctx.sentToClientSinceLastInbound(ORG, CONV, ["in1", "in2"])).toBe(false);
  });

  it("red contra el silencio: el workflow del ÚLTIMO mensaje sí cuenta, aunque siga en camino", async () => {
    await msg("in1", { direction: "in", wrote: at(0) });
    await keywordRun("run1", "in1", [], "queued");
    expect(await ctx.sentToClientSinceLastInbound(ORG, CONV, ["in1"])).toBe(true);
  });

  it("red contra el silencio: el mensaje tapado por el workflow cuenta como el último del cliente", async () => {
    await msg("in1", { direction: "in", wrote: at(0) });
    await msg("w1", { direction: "out", wrote: at(1) });
    await msg("w2", { direction: "out", wrote: at(4) });
    await keywordRun("run1", "in1", ["w1", "w2"]);
    // Escrito a los 3 s (entre w1 y w2), llegó a los 5 s, después de todo el workflow.
    await msg("in2", { direction: "in", wrote: at(3), arrived: at(5) });

    expect(ids(await ctx.loadHistory(ORG, CONV))).toEqual(["in1", "w1", "w2", "in2"]);
    expect(await ctx.sentToClientSinceLastInbound(ORG, CONV, ["in1", "in2"])).toBe(false);
  });

  it("una respuesta reenviada que contesta hasta un mensaje tapado lo deja contestado", async () => {
    await msg("out1", { direction: "out", wrote: at(10) });
    await msg("in1", { direction: "in", wrote: at(9), arrived: at(14) });
    await msg("out2", { direction: "out", wrote: at(60) });
    // out2 es una burbuja reenviada: contesta solo hasta in1.
    await saved.markAnswersUntil(ORG, "out2", "in1");
    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual([]);
    await msg("in2", { direction: "in", wrote: at(30), arrived: at(31) });
    // in2 llegó antes de out2, pero out2 solo contesta hasta in1: sigue pendiente.
    expect(ids(await ctx.pendingInbound(ORG, CONV))).toEqual(["in2"]);
  });
});
