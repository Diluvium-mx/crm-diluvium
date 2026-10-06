// Disparadores (palabra clave del cliente, etapa, comando) contra una base real.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

vi.mock("@/lib/queue/workflows", () => ({
  enqueueWorkflowRun: async () => true,
  reviveWorkflowRun: async () => "added",
}));

describe.skipIf(!TEST_DATABASE_URL)("disparadores de workflows", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let t: typeof import("./triggers");
  let eq: typeof import("drizzle-orm").eq;
  const ORG = "org_trg";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    t = await import("./triggers");
    ({ eq } = await import("drizzle-orm"));
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate workflow_runs, workflow_steps, workflows, messages, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org", createdAt: new Date() });
    await db.insert(s.user).values({ id: "u1", name: "Paty", email: "p@x.mx" });
    // Una conversación por contacto y canal: dos canales para tener dos conversaciones.
    await db.insert(s.channels).values([
      { id: "ch", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z", displayName: "D", aiAgentMode: "auto" },
      { id: "ch2", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "z2", displayName: "D2", aiAgentMode: "auto" },
    ]);
    await db.insert(s.contacts).values({ id: "c1", organizationId: ORG, firstName: "Ana", phoneE164: "+526681112233" });
    await db.insert(s.conversations).values([
      { id: "cv_old", organizationId: ORG, contactId: "c1", channelId: "ch", providerConversationId: "zo", lastMessageAt: new Date(Date.now() - 86_400_000), windowExpiresAt: new Date(Date.now() + 3_600_000) },
      { id: "cv_new", organizationId: ORG, contactId: "c1", channelId: "ch2", providerConversationId: "zn", lastMessageAt: new Date(), windowExpiresAt: new Date(Date.now() + 3_600_000) },
    ]);
  });
  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function wf(id: string, opts: Partial<typeof s.workflows.$inferInsert>) {
    await db.insert(s.workflows).values({ id, organizationId: ORG, slug: id, name: id, enabled: true, ...opts });
    await db.insert(s.workflowSteps).values({ id: `${id}_s`, organizationId: ORG, workflowId: id, position: 0, kind: "send_text", payload: { kind: "send_text", text: "hola" } });
  }
  async function inbound(id: string, body: string | null, type: "text" | "image" = "text") {
    await db.insert(s.messages).values({ id, organizationId: ORG, conversationId: "cv_new", direction: "in", source: "contact", type, body, status: "received" });
    return t.onInboundKeyword({ organizationId: ORG, conversationId: "cv_new", messageId: id });
  }
  const runs = () => db.select().from(s.workflowRuns).where(eq(s.workflowRuns.organizationId, ORG));

  it("palabra clave del cliente: dispara UN solo workflow (empate → el primero por posición) y deja rastro", async () => {
    await wf("w_tapones", { triggerKeywords: ["tapones", "tapón"], position: 1 });
    await wf("w_tabla", { triggerKeywords: ["tabla"], position: 0 });
    // Empate de longitud ("tabla" / "tapon"): desempata la posición.
    const r = await inbound("m1", "¿Me mandan la TABLA y tapón?");
    expect(r).toMatchObject({ status: "queued" });
    const all = await runs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ workflowId: "w_tabla", trigger: "keyword", conversationId: "cv_new" });
  });

  it("B1: palabra clave durable — el barrido retoma la que un reinicio dejó 'pendiente', sin duplicar la corrida", async () => {
    await wf("w_tabla", { triggerKeywords: ["tabla"], position: 0 });
    const mark = async (id: string) =>
      (await db.select({ m: s.messages.metadata }).from(s.messages).where(eq(s.messages.id, id)))[0].m as Record<string, unknown> | null;
    const pending = (id: string, body: string, minutesAgo: number) =>
      db.insert(s.messages).values({
        id, organizationId: ORG, conversationId: "cv_new", direction: "in", source: "contact", type: "text", body, status: "received",
        metadata: { palabraClave: "pendiente" }, createdAt: new Date(Date.now() - minutesAgo * 60_000),
      });
    // El worker se cayó entre el commit (marca "pendiente") y el gancho: nadie evaluó la palabra clave.
    await pending("m_caido", "¿me pasas la tabla?", 2);
    await pending("m_reciente", "la tabla porfa", 0); // < 1 min: todavía es del gancho normal
    await pending("m_viejo", "tabla", 45); // > 30 min: ya no sirve mandarla
    expect(await t.sweepPendingKeywords()).toBe(1);
    const [run] = await runs();
    expect(run).toMatchObject({ workflowId: "w_tabla", trigger: "keyword", triggerMessageId: "m_caido" });
    expect((await mark("m_caido"))?.palabraClave).toBe("revisada");
    expect((await mark("m_reciente"))?.palabraClave).toBe("pendiente");
    // Se cayó DESPUÉS de crear la corrida y antes de marcar: el barrido la vuelve a evaluar sin duplicarla.
    await db.update(s.messages).set({ metadata: { palabraClave: "pendiente" } }).where(eq(s.messages.id, "m_caido"));
    expect(await t.sweepPendingKeywords()).toBe(1);
    expect(await runs()).toHaveLength(1);
    expect((await mark("m_caido"))?.palabraClave).toBe("revisada");
    // El gancho normal también la cierra, con o sin coincidencia.
    await db.insert(s.messages).values({ id: "m_nada", organizationId: ORG, conversationId: "cv_new", direction: "in", source: "contact", type: "text", body: "hola", status: "received", metadata: { palabraClave: "pendiente" } });
    expect(await t.onInboundKeyword({ organizationId: ORG, conversationId: "cv_new", messageId: "m_nada" })).toBeNull();
    expect((await mark("m_nada"))?.palabraClave).toBe("revisada");
  });

  it("la frase más específica gana entre workflows: 'video a la medida' no manda el video estándar", async () => {
    await wf("w_video", { triggerKeywords: ["video"], position: 0 });
    await wf("w_medida", { triggerKeywords: ["video a la medida"], position: 1 });
    await inbound("m9", "me mandas el video a la medida?");
    expect((await runs())[0]).toMatchObject({ workflowId: "w_medida" });
  });

  it("una imagen o un mensaje sin coincidencia no dispara; un workflow deshabilitado tampoco", async () => {
    await wf("w_tabla", { triggerKeywords: ["tabla"] });
    await wf("w_off", { triggerKeywords: ["precio"], enabled: false });
    expect(await inbound("m2", "foto", "image")).toBeNull();
    expect(await inbound("m3", "cuánto cuesta, precio por favor")).toBeNull();
    expect(await inbound("m4", "hola, buenas tardes")).toBeNull(); // "contiene" como GHL: "establa" SÍ dispararía "tabla"
    expect(await runs()).toHaveLength(0);
  });

  it("cambio de etapa humano: dispara sobre la conversación MÁS RECIENTE del contacto con el vendedor como autor", async () => {
    await wf("w_stage", { triggerStage: "cerca_compra" });
    await wf("w_other", { triggerStage: "compra" });
    const out = await t.onContactStageEntered({ organizationId: ORG, contactId: "c1", stage: "cerca_compra", userId: "u1" });
    expect(out).toHaveLength(1);
    const all = await runs();
    expect(all[0]).toMatchObject({ workflowId: "w_stage", trigger: "stage", conversationId: "cv_new", triggeredByUserId: "u1" });
  });

  it("un contacto sin conversación no dispara nada y no lanza", async () => {
    await wf("w_stage", { triggerStage: "compra" });
    await db.insert(s.contacts).values({ id: "c2", organizationId: ORG, firstName: "Sin chat", phoneE164: "+526681112299" });
    expect(await t.onContactStageEntered({ organizationId: ORG, contactId: "c2", stage: "compra", userId: null })).toEqual([]);
  });

  it("comando: solo el texto exacto '/x' en minúsculas encuentra el workflow, y nunca uno de otra organización", async () => {
    await wf("w_cmd", { triggerCommand: "/tabla" });
    expect(await t.findWorkflowByCommand(ORG, " /TABLA ")).toMatchObject({ id: "w_cmd" });
    expect(await t.findWorkflowByCommand(ORG, "/tabla por favor")).toBeNull();
    expect(await t.findWorkflowByCommand(ORG, "tabla")).toBeNull();
    expect(await t.findWorkflowByCommand("otra_org", "/tabla")).toBeNull();
  });

  // ── «Solo al inicio» (29-sep-2026, regla estricta del dueño) ──────────────────
  async function out(id: string, source: "ai_agent" | "crm" | "business_app", opts: { importedAt?: Date; conversationId?: string } = {}) {
    await db.insert(s.messages).values({
      id,
      organizationId: ORG,
      conversationId: opts.conversationId ?? "cv_new",
      direction: "out",
      source,
      type: "text",
      body: "respuesta",
      status: "sent",
      importedAt: opts.importedAt ?? null,
    });
  }
  const precioYInfo = async () => {
    await wf("w_precio", { triggerKeywords: ["precio"], triggerStartOnly: true, position: 0 });
    await wf("w_info", { triggerKeywords: ["info"], position: 1 });
  };

  it("solo al inicio: 'Precio' como primer mensaje dispara; una segunda vez NUNCA (aunque siga sin contestarle nadie)", async () => {
    await precioYInfo();
    expect(await inbound("m1", "Precio")).toMatchObject({ status: "queued" });
    expect(await inbound("m2", "precio por favor")).toBeNull(); // ya le salió a este contacto: no compite
    expect((await runs()).map((r) => r.workflowId)).toEqual(["w_precio"]);
  });

  it("lada de otro país (6-oct): la respuesta de inicio no sale (contesta el Agente IA); un workflow sin «Solo al inicio», sí", async () => {
    await db.update(s.contacts).set({ phoneE164: "+34610605145", phoneCountryIso: "ES", phoneCountryCode: "34" }).where(eq(s.contacts.id, "c1"));
    await precioYInfo();
    expect(await inbound("m1", "Precio")).toBeNull();
    expect(await inbound("m2", "más info")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => r.workflowId)).toEqual(["w_info"]);
  });

  it("solo al inicio: si ya contestó el Agente IA con texto propio, no dispara y el mensaje puede disparar otro workflow que coincida", async () => {
    await precioYInfo();
    await out("o1", "ai_agent");
    expect(await inbound("m1", "precio e info")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => r.workflowId)).toEqual(["w_info"]);
  });

  it("solo al inicio: un vendedor (CRM o celular) o el historial copiado del celular cuentan como 'ya le contestaron'", async () => {
    await precioYInfo();
    await out("o1", "crm");
    expect(await inbound("m1", "Precio")).toBeNull();
    await db.delete(s.messages).where(eq(s.messages.id, "o1"));
    await out("o2", "business_app", { importedAt: new Date(Date.now() - 30 * 86_400_000) });
    expect(await inbound("m2", "Precio")).toBeNull();
    expect(await runs()).toHaveLength(0);
  });

  it("solo al inicio: lo que mandó OTRO workflow automático no cuenta ('Quiero más información' → «Información», luego 'Precio' → «Precio 2»)", async () => {
    await precioYInfo();
    expect(await inbound("m1", "Quiero más info")).toMatchObject({ status: "queued" });
    const [infoRun] = await runs();
    await out("o1", "ai_agent"); // el texto de «Información», de esa corrida
    await db.update(s.workflowRuns).set({ status: "done", messageIds: ["o1"] }).where(eq(s.workflowRuns.id, infoRun.id));
    expect(await inbound("m2", "Precio")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => r.workflowId).sort()).toEqual(["w_info", "w_precio"]);
  });

  it("solo al inicio: una vez por CONTACTO (también si le salió en otra conversación); el comando del vendedor sale siempre", async () => {
    await precioYInfo();
    const exec = await import("./executor");
    await db.insert(s.workflowRuns).values({ id: "r_old", organizationId: ORG, workflowId: "w_precio", conversationId: "cv_old", contactId: "c1", trigger: "keyword", status: "done", stepCursor: 1, messageIds: [], attempts: 1 });
    expect(await inbound("m1", "Precio")).toBeNull();
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_precio", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m1" })).toMatchObject({
      status: "skipped",
      reason: exec.SKIP_ALREADY_SENT,
    });
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_precio", conversationId: "cv_new", trigger: "command", triggeredByUserId: "u1" })).toMatchObject({ status: "queued" });
  });

  it("solo al inicio: por el Agente IA a media conversación se salta con motivo 'ya_no_es_el_inicio'; sin la opción, sale", async () => {
    await precioYInfo();
    const exec = await import("./executor");
    await inbound("m1", "hola");
    await out("o1", "ai_agent");
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_precio", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m1" })).toMatchObject({
      status: "skipped",
      reason: exec.SKIP_NOT_START,
    });
    await db.update(s.workflows).set({ triggerStartOnly: false }).where(eq(s.workflows.id, "w_precio"));
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_precio", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m1" })).toMatchObject({ status: "queued" });
  });

  // ── Tabla de tamaños (29-sep-2026, decisiones del dueño) ───────────────────────
  it("«solo al inicio por palabra clave»: la palabra clave solo al inicio ('Checare medidas' a media conversación no dispara); el Agente IA sí la puede mandar después", async () => {
    await wf("w_tabla", { triggerKeywords: ["medidas", "tamaños"], triggerStartOnly: true, triggerStartOnlyAgent: false });
    const exec = await import("./executor");
    expect(await inbound("m1", "¿Qué medidas manejan?")).toMatchObject({ status: "queued" });
    await db.update(s.contacts).set({ keywordWorkflowsSent: [] }).where(eq(s.contacts.id, "c1"));
    await db.delete(s.workflowRuns);
    await out("o1", "ai_agent"); // ya contestó el Agente IA con texto propio
    expect(await inbound("m2", "Checare medidas")).toBeNull();
    expect(await runs()).toHaveLength(0);
    // El Agente IA no queda limitado por «Solo al inicio» (con la regla estricta, sí).
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_tabla", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m2" })).toMatchObject({ status: "queued" });
    await db.delete(s.workflowRuns);
    await db.update(s.workflows).set({ triggerStartOnlyAgent: true }).where(eq(s.workflows.id, "w_tabla"));
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "w_tabla", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m1" })).toMatchObject({
      status: "skipped",
      reason: exec.SKIP_NOT_START,
    });
  });

  const precioTablaInfo = async () => {
    await wf("precio_2_6100", { triggerKeywords: ["cuesta", "costo", "precio"], triggerStartOnly: true, position: 9 });
    await wf("tabla_tamanos_estandar", { triggerKeywords: ["tamaños", "medidas", "tallas"], triggerStartOnly: true, triggerStartOnlyAgent: false, position: 0 });
    await wf("informacion_8b3c", { triggerKeywords: ["información", "info"], triggerStartOnly: true, position: 11 });
  };

  it("regla fija: al inicio, un mensaje que dispararía «Precio 2» y la Tabla a la vez manda «Información»", async () => {
    await precioTablaInfo();
    expect(await inbound("m1", "Hola buen día q precio tiene y q medidas son")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => [r.workflowId, r.trigger, r.triggerMessageId])).toEqual([["informacion_8b3c", "keyword", "m1"]]);
  });

  it("regla fija: si «Información» ya le salió a este contacto, ya no sale NINGUNA respuesta de inicio por palabra clave (una sola por cliente, 30-sep): contesta el Agente IA", async () => {
    await precioTablaInfo();
    await db.update(s.contacts).set({ keywordWorkflowsSent: ["informacion_8b3c"] }).where(eq(s.contacts.id, "c1"));
    await db.insert(s.workflowRuns).values({ id: "r_info", organizationId: ORG, workflowId: "informacion_8b3c", conversationId: "cv_old", contactId: "c1", trigger: "keyword", status: "done", stepCursor: 1, messageIds: [], attempts: 1 });
    expect(await inbound("m1", "Precio y medidas ?")).toBeNull();
    expect((await runs()).filter((r) => r.id !== "r_info")).toEqual([]);
  });

  it("regla fija: solo con los DOS; 'precio' solo manda «Precio 2» y 'medidas' sola manda la Tabla", async () => {
    await precioTablaInfo();
    expect(await inbound("m1", "Precio")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => r.workflowId)).toEqual(["precio_2_6100"]);
    await db.delete(s.workflowRuns);
    await db.update(s.contacts).set({ keywordWorkflowsSent: [] }).where(eq(s.contacts.id, "c1"));
    expect(await inbound("m2", "¿Qué medidas manejan?")).toMatchObject({ status: "queued" });
    expect((await runs()).map((r) => r.workflowId)).toEqual(["tabla_tamanos_estandar"]);
  });

  it("regla fija: a media conversación no aplica (ni «Precio 2» ni la Tabla saldrían por palabra clave)", async () => {
    await precioTablaInfo();
    await out("o1", "crm");
    expect(await inbound("m1", "¿Qué precio y qué medidas?")).toBeNull();
    expect(await runs()).toHaveLength(0);
  });

  it("máximo por chat: un workflow que ya llegó a su máximo no compite por la palabra clave", async () => {
    await wf("w_tabla", { triggerKeywords: ["medidas"], maxSendsPerChat: 1, position: 0 });
    await wf("w_medir", { triggerKeywords: ["medir"], position: 1 });
    // Ya salió una vez en este chat (su corrida mandó algo).
    await out("o1", "ai_agent");
    await db.insert(s.workflowRuns).values({ id: "r_t", organizationId: ORG, workflowId: "w_tabla", conversationId: "cv_new", contactId: "c1", trigger: "agent", status: "done", stepCursor: 1, messageIds: ["o1"], attempts: 1 });
    expect(await inbound("m1", "¿cómo medir? ¿qué medidas?")).toMatchObject({ status: "queued" });
    expect((await runs()).filter((r) => r.id !== "r_t").map((r) => r.workflowId)).toEqual(["w_medir"]);
  });

  // ── Una sola respuesta de inicio por cliente (30-sep-2026, decisión del dueño) ────────────
  it("una sola respuesta de inicio: tras la Tabla («¿Qué medidas manejan?»), «que precio tiene» ya no manda «Precio 2» (caso 30-sep 13:29)", async () => {
    await precioTablaInfo();
    expect(await inbound("m1", "¿Qué medidas manejan?")).toMatchObject({ status: "queued" });
    expect(await inbound("m2", "que precio tiene")).toBeNull();
    expect((await runs()).map((r) => r.workflowId)).toEqual(["tabla_tamanos_estandar"]);
  });

  it("una sola respuesta de inicio: ráfaga a 2 s «Quiero más información» + «Hola costos» → solo «Información» (la de «Precio 2» ni se crea); por el Agente IA, «Precio 2» se omite con motivo", async () => {
    await precioTablaInfo();
    const exec = await import("./executor");
    expect(await inbound("m1", "Quiero más información")).toMatchObject({ status: "queued" });
    expect(await inbound("m2", "Hola costos")).toBeNull();
    expect((await runs()).map((r) => r.workflowId)).toEqual(["informacion_8b3c"]);
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "precio_2_6100", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m2" })).toMatchObject({
      status: "skipped",
      reason: exec.SKIP_OTHER_START,
    });
  });

  it("una sola respuesta de inicio: tras «Información», «Gracias llegando a mi casa checo las medidas» ya no manda la Tabla; el Agente IA sí puede mandarla", async () => {
    await precioTablaInfo();
    const exec = await import("./executor");
    expect(await inbound("m1", "Quiero más información")).toMatchObject({ status: "queued" });
    expect(await inbound("m2", "Gracias llegando a mi casa checo las medidas")).toBeNull();
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "tabla_tamanos_estandar", conversationId: "cv_new", trigger: "agent", triggerMessageId: "m2" })).toMatchObject({ status: "queued" });
  });

  it("una sola respuesta de inicio: cuenta aunque la otra le haya salido en OTRA conversación; los workflows sin «Solo al inicio» no cuentan ni se frenan; el comando sale siempre", async () => {
    await precioTablaInfo();
    await wf("w_tapones", { triggerKeywords: ["tapones"], position: 6 });
    const exec = await import("./executor");
    await db.insert(s.workflowRuns).values({ id: "r_old", organizationId: ORG, workflowId: "informacion_8b3c", conversationId: "cv_old", contactId: "c1", trigger: "keyword", status: "done", stepCursor: 1, messageIds: [], attempts: 1 });
    expect(await inbound("m1", "Precio")).toBeNull();
    expect(await inbound("m2", "¿y los tapones?")).toMatchObject({ status: "queued" });
    expect(await exec.startWorkflowRun({ organizationId: ORG, workflowId: "precio_2_6100", conversationId: "cv_new", trigger: "command", triggeredByUserId: "u1" })).toMatchObject({ status: "queued" });
  });
});
