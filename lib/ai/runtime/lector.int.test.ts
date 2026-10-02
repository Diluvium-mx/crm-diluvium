// Lector en segundo plano (28-sep-2026) contra Postgres REAL: llena el Detalle, el monto
// de lo que el cliente eligió y el pago total; avanza la etapa como el Agente IA (aviso
// emergente incluido) SIN disparar workflows; respeta la etapa que puso un vendedor; lee
// aunque el Agente IA esté apagado; deja su fila en ai_usage (etapa "detalle", sin
// message_id) y marca el chat como leído. Solo corre con TEST_DATABASE_URL (base DESECHABLE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "@/lib/ai/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Lector en segundo plano (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let lector: typeof import("./lector");
  let lectorWorker: typeof import("./lector-worker");
  let q: typeof import("@/lib/contacts/qualification");

  const ORG = "org_lector";
  const CONTACT = "contact_lector";
  const CONV = "conv_lector";
  const ago = (ms: number) => new Date(Date.now() - ms);
  const MIN = 60_000;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    lector = await import("./lector");
    lectorWorker = await import("./lector-worker");
    q = await import("@/lib/contacts/qualification");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(
      d.sql`truncate ai_usage, workflow_runs, workflow_steps, workflows, messages, conversations, channels, contact_comentarios, contact_entradas, contacts, organization, "user" cascade`,
    );
    await db.insert(s.user).values({ id: q.AGENT_AI_USER_ID, name: "Agente IA", email: "agente-ia@sistema.invalid", banned: true });
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-lector", createdAt: new Date() });
    // Agente IA APAGADO en el canal: el lector trabaja igual.
    await db.insert(s.channels).values({ id: "ch_lector", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_lector", displayName: "Diluvium", aiAgentMode: "off" });
    await db.insert(s.contacts).values({ id: CONTACT, organizationId: ORG, firstName: "Cliente", phoneE164: "+526681110000" });
    await db.insert(s.conversations).values({ id: CONV, organizationId: ORG, contactId: CONTACT, channelId: "ch_lector", providerConversationId: "zconv_lector", lastMessageAt: ago(10 * MIN) });
    seq = 0;
  });

  let seq = 0;
  async function msg(
    direction: "in" | "out",
    body: string,
    at: Date,
    source?: "contact" | "crm" | "business_app" | "ai_agent",
    attachments: { type: string; url: string; storageKey?: string }[] = [],
  ) {
    seq++;
    await db.insert(s.messages).values({
      id: `ml_${seq}`,
      organizationId: ORG,
      conversationId: CONV,
      direction,
      source: source ?? (direction === "in" ? "contact" : "business_app"),
      type: "text",
      body,
      attachments,
      providerMessageId: `wamid.lector.${seq}`,
      status: direction === "in" ? "received" : "sent",
      sentAt: at,
      createdAt: at,
    });
    await db.update(s.conversations).set({ lastMessageAt: at }).where(d.eq(s.conversations.id, CONV));
  }

  // Modelo falso: devuelve la llamada a la herramienta que se le pida y guarda lo que leyó.
  function deps(input: Record<string, unknown> | Error) {
    const calls: CallModelInput[] = [];
    const kv = new Map<string, string>();
    return {
      calls,
      deps: {
        now: () => new Date(),
        callModel: async (modelId: string, i: CallModelInput): Promise<CallModelResult> => {
          calls.push(i);
          if (input instanceof Error) throw input;
          return {
            modelId,
            provider: "openai",
            providerModelId: modelId,
            text: "",
            finishReason: "tool-calls",
            usage: { inputTokens: 1200, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
            toolCalls: [{ toolName: "actualizar_contacto", input }],
          };
        },
        resolveImage: async () => null,
        kv: {
          setNxPx: async (k: string, v: string) => (kv.has(k) ? false : (kv.set(k, v), true)),
          setEx: async (k: string, v: string) => void kv.set(k, v),
          getDel: async (k: string) => kv.get(k) ?? null,
          delIfEquals: async (k: string, v: string) => void (kv.get(k) === v && kv.delete(k)),
        },
        isModelAvailable: () => true,
      },
    };
  }

  const contact = async () => (await db.select().from(s.contacts).where(d.eq(s.contacts.id, CONTACT)))[0];
  const conv = async () => (await db.select().from(s.conversations).where(d.eq(s.conversations.id, CONV)))[0];

  it("con el Agente IA apagado: llena Detalle, monto de lo que eligió y pago; avanza etapa sin workflows; ai_usage 'detalle' sin message_id; marca leído", async () => {
    // Un workflow "al entrar a Interesado" que le mandaría algo al cliente: NO debe correr.
    await db.insert(s.workflows).values({ id: "wf_int", organizationId: ORG, slug: "wf-int", name: "Al entrar", enabled: true, triggerStage: "interesado" });
    await db.insert(s.workflowSteps).values({ id: "ws_int", organizationId: ORG, workflowId: "wf_int", position: 1, kind: "send_text", payload: { kind: "send_text", text: "Hola" } });
    await msg("in", "Se me mete el agua hasta la rodilla, son 2 entradas de 95", ago(40 * MIN));
    await msg("out", "Cada compuerta queda en $5,500, las dos $11,000", ago(38 * MIN));
    await msg("in", "Mejor solo una, ya te deposité 2,750 de anticipo", ago(30 * MIN));
    const t = deps({ tiene_inundaciones: "si", nivel_agua_texto: "hasta la rodilla", num_entradas: 1, anchos_cm: [95], monto_cotizacion: 5500, pago_total: 2750, porcentaje_convencimiento: 80, etapa: "interesado", comentario: "Cambió de 2 a 1 compuerta" });
    const r = await lector.runLector(ORG, CONV, t.deps);
    expect(r.kind).toBe("leido");

    const c = await contact();
    expect(c).toMatchObject({ tieneInundaciones: "si", numEntradas: 1, montoCotizacion: "5500.00", pagoTotal: "2750.00", porcentajeConvencimiento: 80, stage: "interesado", stageChangedBy: "agente" });
    const det = await q.getContactQualification(db, ORG, CONTACT);
    expect(det.iaFields).toEqual(expect.arrayContaining(["monto_cotizacion", "pago_total", "etapa", "num_entradas"]));
    expect(det.comentarios.map((x) => x.body)).toEqual(["Cambió de 2 a 1 compuerta"]);
    expect(await db.select().from(s.workflowRuns)).toHaveLength(0);

    const [u] = await db.select().from(s.aiUsage);
    expect(u).toMatchObject({ stage: "detalle", messageId: null, conversationId: CONV, outcome: "detalle_aplicado", inputTokens: 1200 });
    const leido = await conv();
    expect(leido.detalleLeidoHasta?.getTime()).toBe(leido.lastMessageAt.getTime());

    // Leyó TODO el chat, con quién habla cada línea.
    const text = JSON.stringify(t.calls[0].messages);
    expect(text).toContain("Cliente: Se me mete el agua");
    expect(text).toContain("Vendedor: Cada compuerta queda en $5,500");
    expect(text).toContain("FICHA GUARDADA");

    // Nada nuevo desde la lectura: no vuelve a llamar al modelo.
    expect((await lector.runLector(ORG, CONV, t.deps)).kind).toBe("nada_nuevo");
    expect(t.calls).toHaveLength(1);
  });

  it("un monto que la empresa nunca dijo no se guarda; lo demás sí", async () => {
    await msg("in", "¿Cuánto por una de 95?", ago(20 * MIN));
    await msg("out", "Queda en $5,500", ago(19 * MIN));
    const r = await lector.runLector(ORG, CONV, deps({ monto_cotizacion: 6100, tiene_inundaciones: "si" }).deps);
    expect(r.kind === "leido" && r.ignored[0]).toMatch(/monto_cotizacion: \$6100/);
    expect(await contact()).toMatchObject({ montoCotizacion: null, tieneInundaciones: "si" });
  });

  it("respeta la etapa que puso un vendedor: sin nada después de su cambio no avanza; con algo nuevo después, sí", async () => {
    await msg("in", "Ya quiero pagar, pásame los datos", ago(30 * MIN));
    await db.update(s.contacts).set({ stage: "prospecto", stageChangedBy: "vendedor", stageChangedAt: ago(20 * MIN) }).where(d.eq(s.contacts.id, CONTACT));
    const t = deps({ etapa: "cerca_compra" });
    const r1 = await lector.runLector(ORG, CONV, t.deps, { force: true });
    expect(r1.kind === "leido" && r1.ignored[0]).toMatch(/un vendedor la puso a mano/);
    expect(await contact()).toMatchObject({ stage: "prospecto", stageChangedBy: "vendedor" });
    // La marca del vendedor va en su lugar del chat.
    expect(JSON.stringify(t.calls[0].messages)).toContain("un vendedor movió al contacto a «Prospecto»");

    await msg("in", "Listo, ¿a qué cuenta deposito?", ago(5 * MIN));
    await lector.runLector(ORG, CONV, t.deps);
    expect(await contact()).toMatchObject({ stage: "cerca_compra", stageChangedBy: "agente" });
  });

  it("nunca regresa la etapa (solo hacia adelante)", async () => {
    await db.update(s.contacts).set({ stage: "compra", stageChangedBy: "agente" }).where(d.eq(s.contacts.id, CONTACT));
    await msg("in", "Gracias", ago(5 * MIN));
    await lector.runLector(ORG, CONV, deps({ etapa: "interesado" }).deps);
    expect((await contact()).stage).toBe("compra");
  });

  it("Compra espera a un vendedor: el comprobante confirmado solo por el Agente IA avanza hasta Cerca de compra y queda descartado en ai_usage", async () => {
    await msg("in", "", ago(30 * MIN), "contact", [{ type: "image", url: "/api/media/comprobante", storageKey: "org/comprobante.jpg" }]);
    await msg("out", "Recibimos su anticipo ✅", ago(20 * MIN), "ai_agent");

    const r = await lector.runLector(ORG, CONV, deps({ etapa: "compra" }).deps);

    expect(r.kind).toBe("leido");
    expect(await contact()).toMatchObject({ stage: "cerca_compra", stageChangedBy: "agente" });
    const [u] = await db.select().from(s.aiUsage);
    expect(u).toMatchObject({ stage: "detalle", outcome: "detalle_aplicado" });
    expect(u.error).toContain("falta que un vendedor confirme el pago");
  });

  it("Compra se permite cuando un vendedor del CRM confirma después del comprobante", async () => {
    await msg("in", "", ago(30 * MIN), "contact", [{ type: "image", url: "/api/media/comprobante", storageKey: "org/comprobante.jpg" }]);
    await msg("out", "Recibimos su anticipo ✅", ago(20 * MIN), "ai_agent");
    await msg("out", "Confirmo de recibido ✅", ago(10 * MIN), "crm");

    const r = await lector.runLector(ORG, CONV, deps({ etapa: "compra" }).deps);

    expect(r.kind).toBe("leido");
    expect(await contact()).toMatchObject({ stage: "compra", stageChangedBy: "agente" });
  });

  it("si el modelo falla: fila de error, NO marca leído (se reintenta) y no toca la ficha", async () => {
    await msg("in", "Hola", ago(10 * MIN));
    const r = await lector.runLector(ORG, CONV, deps(new Error("saturado")).deps);
    expect(r.kind).toBe("error");
    expect(await db.select().from(s.aiUsage)).toMatchObject([{ stage: "detalle", outcome: "error", messageId: null }]);
    expect((await conv()).detalleLeidoHasta).toBeNull();
  });

  it("indicador del Detalle: avisa «leyendo» y luego «listo» con cuántos datos cambió; si el modelo falla, «error»", async () => {
    const { subscribeToInbox, __resetInboxHubForTests } = await import("@/lib/inbox/events");
    const got: { phase: string; contactId: string; conversationId: string; cambios: number }[] = [];
    const off = await subscribeToInbox(ORG, (e) => {
      if (e.type === "lector.status") got.push(e);
    });
    const until = async (n: number) => {
      for (let i = 0; i < 100 && got.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    };
    try {
      await msg("in", "Son 2 entradas y se mete el agua", ago(10 * MIN));
      await lector.runLector(ORG, CONV, deps({ tiene_inundaciones: "si", num_entradas: 2 }).deps);
      await until(2);
      expect(got).toEqual([
        { type: "lector.status", contactId: CONTACT, conversationId: CONV, phase: "leyendo", cambios: 0 },
        { type: "lector.status", contactId: CONTACT, conversationId: CONV, phase: "listo", cambios: 2 },
      ]);
      got.length = 0;
      await msg("in", "¿Sigues?", ago(5 * MIN));
      await lector.runLector(ORG, CONV, deps(new Error("saturado")).deps);
      await until(2);
      expect(got.map((e) => e.phase)).toEqual(["leyendo", "error"]);
      // Sin nada nuevo no hay lectura ni aviso.
      got.length = 0;
      await db.update(s.conversations).set({ detalleLeidoHasta: (await conv()).lastMessageAt }).where(d.eq(s.conversations.id, CONV));
      expect((await lector.runLector(ORG, CONV, deps({}).deps)).kind).toBe("nada_nuevo");
      await new Promise((r) => setTimeout(r, 150));
      expect(got).toEqual([]);
    } finally {
      off();
      await __resetInboxHubForTests();
    }
  });

  it("barrido: toma el chat cuando se calmó (3 min) o tras 15 min sin leer; no el que sigue activo ni el ya leído", async () => {
    await msg("in", "Hola", ago(2 * MIN)); // activo hace 2 min: todavía no
    expect(await lectorWorker.findDueConversations(new Date())).toEqual([]);
    expect((await lectorWorker.findDueConversations(new Date(Date.now() + 2 * MIN))).map((x) => x.conversationId)).toEqual([CONV]);
    // Un chat que no para: el primer mensaje sin leer tiene más de 15 min.
    await db.update(s.messages).set({ createdAt: ago(16 * MIN) }).where(d.eq(s.messages.id, "ml_1"));
    await msg("in", "¿Sigues?", ago(MIN));
    expect((await lectorWorker.findDueConversations(new Date())).map((x) => x.conversationId)).toEqual([CONV]);
    // Leído hasta el último mensaje: ya no.
    await db.update(s.conversations).set({ detalleLeidoHasta: (await conv()).lastMessageAt }).where(d.eq(s.conversations.id, CONV));
    expect(await lectorWorker.findDueConversations(new Date(Date.now() + 10 * MIN))).toEqual([]);
  });
  it("seguimiento (modo ensayo): si el último mensaje es nuestro, la MISMA lectura deja la ficha; si el cliente escribe, se cancela", async () => {
    await db.update(s.channels).set({ aiAgentMode: "auto" }).where(d.eq(s.channels.id, "ch_lector"));
    await msg("in", "¿Cuánto cuesta?", ago(30 * MIN));
    await msg("out", "La estándar queda en $5,500. ¿Cuánto mide de ancho su entrada?", ago(29 * MIN), "ai_agent");
    const { deps: dd, calls } = deps({
      tiene_inundaciones: null,
      seguimiento: { caso: "faltan_medidas", pendiente: "Se le pidió el ancho", siguiente_paso: "Pedir el ancho", vale_la_pena: true, borrador: "¿Pudo medir el ancho de su entrada?" },
    });
    const out = await lector.runLector(ORG, CONV, dd);
    expect(out.kind).toBe("leido");
    expect(String(calls[0].system)).toContain("SEGUIMIENTO");
    const [f] = await db.select().from(s.followUps);
    expect(f).toMatchObject({ caso: "faltan_medidas", status: "programado", ensayo: true, intento: 1, borrador: "¿Pudo medir el ancho de su entrada?", timeZone: "America/Mazatlan" });
    const [u] = await db.select().from(s.aiUsage);
    expect(u.error).toMatch(/seguimiento: faltan_medidas 1\.º/);

    await msg("in", "Mide 1.20 m", ago(MIN));
    const segunda = deps({ tiene_inundaciones: null });
    await lector.runLector(ORG, CONV, segunda.deps);
    expect(String(segunda.calls[0].system)).not.toContain("SEGUIMIENTO");
    expect((await db.select().from(s.followUps))[0]).toMatchObject({ status: "cancelado", cancelReason: "cliente_escribio" });
  });
});
