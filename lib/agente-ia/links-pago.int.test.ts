// Links de pago del Agente IA (30-oct-2026) contra Postgres REAL: guardar la lista (con Historial), cuándo
// se ofrece la herramienta (lada fuera de México nunca, +1 sí, máximo por chat) y los candados al
// preparar la respuesta (monto, precio del vendedor, mitad de la medida especial, lada). Solo con
// TEST_DATABASE_URL (base DESECHABLE con migraciones).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Links de pago (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof import("./links-pago-store");
  let actions: typeof import("@/lib/ai/runtime/actions");
  let tools: typeof import("@/lib/ai/runtime/tools");
  let phone: typeof import("@/lib/phone");
  let stages: import("@/lib/contacts/stages").FunnelStage[];

  const ORG = "org_links";
  const CH = "ch_links";
  const CHATS = { mx: "+526681110000", eu: "+16195550100", pe: "+51987654321", ig: null } as const;
  type Chat = keyof typeof CHATS;
  const conv = (c: Chat) => `conv_${c}`;
  const contact = (c: Chat) => `contact_${c}`;
  const LINKS = [
    { nombre: "1 compuerta estándar", monto: 5500, cubre: "total" as const, meses: 6, url: "https://mpago.la/EJEMPLO1" },
    { nombre: "2 compuertas estándar", monto: 11000, cubre: "total" as const, meses: 6, url: "https://mpago.la/EJEMPLO2" },
    { nombre: "Medida especial anticipo", monto: 3500, cubre: "mitad" as const, meses: 0, url: "https://mpago.li/EJEMPLO3" },
  ];

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./links-pago-store");
    actions = await import("@/lib/ai/runtime/actions");
    tools = await import("@/lib/ai/runtime/tools");
    phone = await import("@/lib/phone");
    stages = (await import("@/lib/contacts/stages")).defaultStages();
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate links_pago, change_history, messages, conversations, channels, contacts, organization cascade`);
    await db.insert(s.organization).values({ id: ORG, name: "Org", slug: "org-links", createdAt: new Date() });
    await db.insert(s.channels).values({ id: CH, organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_links", displayName: "Diluvium", aiAgentMode: "auto" });
    for (const c of Object.keys(CHATS) as Chat[]) {
      await db.insert(s.contacts).values({ id: contact(c), organizationId: ORG, firstName: "Cliente", ...phone.phoneColumns(CHATS[c]) });
      await db.insert(s.conversations).values({ id: conv(c), organizationId: ORG, contactId: contact(c), channelId: CH, providerConversationId: `zconv_${c}` });
    }
    await store.replaceLinksPago(ORG, LINKS, null);
  });

  const quote = (c: Chat, monto: number, por: "agente" | "vendedor") =>
    db.update(s.contacts).set({ montoCotizacion: monto.toFixed(2), customFields: { cotizacion_por: por } }).where(d.eq(s.contacts.id, contact(c)));

  async function linkSent(c: Chat, url: string, i: number) {
    await db.insert(s.messages).values({ id: `m_${c}_${i}`, organizationId: ORG, conversationId: conv(c), direction: "out", source: "ai_agent", type: "text", body: `Aquí le paso el link\n\n${url}`, status: "sent" });
  }

  async function plan(c: Chat, clave: string, extra: { modelText?: string; companyTexts?: string[]; monto?: number } = {}) {
    const t = await actions.loadAgentTools(ORG, stages);
    const opcion = t.linkOptions.find((o) => o.clave === clave);
    if (!opcion) throw new Error(`sin opción ${clave}`);
    const calls: import("@/lib/ai/runtime/tools").ValidToolCall[] = [{ kind: "link", opcion }];
    if (extra.monto) calls.unshift({ kind: "cotizacion", monto: extra.monto });
    return actions.prepareActions({ organizationId: ORG, conversationId: conv(c), contactId: contact(c), calls, modelText: extra.modelText ?? "", companyTexts: extra.companyTexts, pendingSince: null, stages });
  }

  it("guarda la lista en orden y deja una fila en el Historial; guardar lo mismo no deja otra", async () => {
    expect((await store.listLinksPago(ORG)).map((l) => [l.posicion, l.nombre, l.monto, l.cubre, l.meses])).toEqual([
      [1, "1 compuerta estándar", 5500, "total", 6],
      [2, "2 compuertas estándar", 11000, "total", 6],
      [3, "Medida especial anticipo", 3500, "mitad", 0],
    ]);
    await store.replaceLinksPago(ORG, LINKS, null);
    const rows = await db.select().from(s.changeHistory).where(d.eq(s.changeHistory.organizationId, ORG));
    expect(rows.map((r) => [r.kind, r.action])).toEqual([["links_pago", "editar"]]);
    expect(rows[0].oldValue).toMatch(/^Sin links\nMensaje 1: /);
    expect(rows[0].newValue).toContain("1 compuerta estándar $5,500 · 6 MSI · https://mpago.la/EJEMPLO1");
  });

  it("la herramienta se ofrece a México, +1 e Instagram; nunca a Perú; ni sin links", async () => {
    const offered = async (c: Chat) => TOOL in (await actions.loadAgentTools(ORG, stages, { id: conv(c), contactId: contact(c) })).tools;
    const TOOL = tools.TOOL_LINK_PAGO;
    expect(await offered("mx")).toBe(true);
    expect(await offered("eu")).toBe(true);
    expect(await offered("ig")).toBe(true);
    expect(await offered("pe")).toBe(false);
    await store.replaceLinksPago(ORG, [], null);
    expect(await offered("mx")).toBe(false);
  });

  it("con el total acordado sale el link exacto y el contacto va a Cerca de compra", async () => {
    const p = await plan("mx", "1_compuerta_estandar", { monto: 5500, modelText: "Son $5,500 con envío gratis." });
    expect(p.link?.mensajes).toHaveLength(2);
    expect(p.link?.mensajes[0]).toContain("\n\nhttps://mpago.la/EJEMPLO1\n\n");
    expect(p.link?.mensajes[1]).toContain("datos de envío");
    expect(p.linkFallback).toBeNull();
    expect(p.stage).toBe("cerca_compra");
    expect(p.avisos).toEqual([]);
  });

  it("sin total guardado vale el que la empresa ya dijo en el chat", async () => {
    expect((await plan("mx", "1_compuerta_estandar", { companyTexts: ["Ahorita tenemos cualquier tamaño en $5,500 con envío gratis"] })).link).not.toBeNull();
    const sinTotal = await plan("mx", "1_compuerta_estandar");
    expect(sinTotal.link).toBeNull();
    expect(sinTotal.avisos[0].detalle).toContain("no hay un total acordado");
  });

  it("si no cuadra con el total, no sale: el cliente lee que un asesor se lo manda y el vendedor recibe el aviso", async () => {
    await quote("mx", 11000, "agente");
    const p = await plan("mx", "1_compuerta_estandar");
    expect(p.link).toBeNull();
    expect(p.linkFallback).toBe("En un momento un asesor le comparte el link de pago.");
    expect(p.stage).toBeNull();
    expect(p.avisos).toEqual([{ motivo: "cliente_pide_humano", detalle: "Mándale tú el link de pago: el Agente IA quiso mandar «1 compuerta estándar» ($5,500), pero el total acordado es $11,000." }]);
  });

  it("el precio que puso un vendedor manda: un link de lista que no es ese no sale", async () => {
    await quote("mx", 10400, "vendedor");
    const p = await plan("mx", "2_compuertas_estandar", { monto: 11000, modelText: "Serían $11,000." });
    expect(p.link).toBeNull();
    expect(p.avisos[0].detalle).toContain("el total acordado es $10,400");
  });

  it("compuerta a la medida: el anticipo cobra la mitad del total de $7,000", async () => {
    await quote("mx", 7000, "agente");
    expect((await plan("mx", "medida_especial_anticipo")).link?.mensajes[0]).toContain("https://mpago.li/EJEMPLO3");
    await quote("mx", 3500, "agente");
    expect((await plan("mx", "medida_especial_anticipo")).link).toBeNull();
  });

  it("«Solo vendedor» no se ofrece al Agente IA; los textos editados salen tal cual y quedan en el Historial", async () => {
    await store.replaceLinksPago(ORG, [...LINKS, { nombre: "2 compuertas (especial)", monto: 10400, cubre: "total", meses: 6, url: "https://mpago.la/EJEMPLO9", soloVendedor: true }], null, {
      mensaje1: "Link de {{monto}}: {{link}}",
      mensaje2: "",
    });
    const t = await actions.loadAgentTools(ORG, stages, { id: conv("mx"), contactId: contact("mx") });
    expect(t.linkOptions.map((o) => o.clave)).toEqual(["1_compuerta_estandar", "2_compuertas_estandar", "medida_especial_anticipo"]);
    expect((await store.listLinksPago(ORG)).at(-1)?.soloVendedor).toBe(true);
    await quote("mx", 5500, "agente");
    expect((await plan("mx", "1_compuerta_estandar")).link?.mensajes).toEqual(["Link de $5,500: https://mpago.la/EJEMPLO1"]);
    const last = (await db.select().from(s.changeHistory).where(d.eq(s.changeHistory.organizationId, ORG)).orderBy(d.desc(s.changeHistory.createdAt)))[0];
    expect(last.newValue).toContain("2 compuertas (especial) $10,400 · 6 MSI · solo vendedor");
    expect(last.newValue).toContain("Mensaje 1: Link de {{monto}}: {{link}}");
    expect(last.newValue).toContain("Mensaje 2: (no sale)");
  });

  it("lada de Perú: aunque el modelo lo pida, ni link ni frase ni aviso; +1 sí", async () => {
    await quote("pe", 5500, "agente");
    const p = await plan("pe", "1_compuerta_estandar");
    expect(p.link).toBeNull();
    expect(p.linkFallback).toBeNull();
    expect(p.avisos).toEqual([]);
    expect(p.notes.join(" ")).toContain("Perú");
    await quote("eu", 5500, "agente");
    expect((await plan("eu", "1_compuerta_estandar")).link).not.toBeNull();
  });

  it("máximo 3 links del Agente IA por chat: después no se ofrece y, si lo pide, un asesor", async () => {
    await quote("mx", 5500, "agente");
    for (let i = 0; i < 3; i++) await linkSent("mx", LINKS[i % 2].url, i);
    expect(tools.TOOL_LINK_PAGO in (await actions.loadAgentTools(ORG, stages, { id: conv("mx"), contactId: contact("mx") })).tools).toBe(false);
    const p = await plan("mx", "1_compuerta_estandar");
    expect(p.link).toBeNull();
    expect(p.linkFallback).not.toBeNull();
    expect(p.avisos[0].detalle).toContain("ya lo mandó 3 veces");
  });
});
