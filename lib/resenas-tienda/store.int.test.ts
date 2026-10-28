import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Store from "./store";
import type * as Queries from "./queries";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ORG = "org_rt";
const OTRA = "org_rt_otra";
const NOW = new Date("2026-10-27T18:00:00Z");

describe.skipIf(!TEST_DATABASE_URL)("reseñas en Amazon y Mercado Libre (Postgres real)", () => {
  let db: typeof import("@/lib/db").db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let store: typeof Store;
  let queries: typeof Queries;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    store = await import("./store");
    queries = await import("./queries");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    await db.execute(d.sql`truncate resenas_tienda, opiniones_config, conversations, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "diluvium-rt", createdAt: NOW },
      { id: OTRA, name: "Otra", slug: "otra-rt", createdAt: NOW },
    ]);
    await db.insert(s.user).values({ id: "u_rt", name: "Vendedor", email: "vendedor-rt@ejemplo.invalid" });
    await db.insert(s.channels).values({ id: "ch_rt", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "zacc_rt", displayName: "Diluvium" });
    await db.insert(s.contacts).values([
      { id: "c_pedro", organizationId: ORG, firstName: "Pedro", phoneE164: "+526681110000" },
      { id: "c_lucia", organizationId: ORG, firstName: "Lucía", lastName: "Gómez", phoneE164: "+528181110000" },
      { id: "c_otra", organizationId: OTRA, firstName: "Ajeno" },
    ]);
    await db.insert(s.conversations).values({
      id: "conv_pedro",
      organizationId: ORG,
      contactId: "c_pedro",
      channelId: "ch_rt",
      providerConversationId: "zconv_rt",
      lastMessageAt: NOW,
      windowExpiresAt: new Date(NOW.getTime() + 3_600_000),
    });
  });

  const anotar = (over: Partial<Parameters<typeof Store.anotarCompraEnTienda>[0]> = {}) =>
    store.anotarCompraEnTienda({
      organizationId: ORG,
      contactId: "c_pedro",
      conversationId: "conv_pedro",
      tienda: "amazon",
      frase: "Ya la encargué en Amazon, gracias",
      now: NOW,
      ...over,
    });

  it("lo anota una vez por contacto: la misma tienda otra vez no cambia nada", async () => {
    expect(await anotar()).toBe(true);
    expect(await anotar({ frase: "Al final sí la pedí por Amazon" })).toBe(false);
    const [fila] = await queries.listarResenasTienda(ORG);
    expect(fila).toMatchObject({ contacto: "Pedro", tienda: "amazon", estado: "por_pedir", frase: "Ya la encargué en Amazon, gracias", canal: "whatsapp", telefono: "+526681110000" });
    expect(await store.compraEnTiendaDe(ORG, "c_pedro")).toEqual({ tienda: "amazon", estado: "por_pedir" });
  });

  it("si corrige la tienda antes de pedirla, se cambia; ya pedida o descartada, manda el vendedor", async () => {
    await anotar();
    expect(await anotar({ tienda: "mercado_libre", frase: "perdón, fue en Mercado Libre" })).toBe(true);
    expect((await store.compraEnTiendaDe(ORG, "c_pedro"))?.tienda).toBe("mercado_libre");

    const [fila] = await queries.listarResenasTienda(ORG);
    await store.marcarPedida(ORG, fila.id, "u_rt", NOW);
    expect(await anotar({ tienda: "amazon" })).toBe(false);
    expect(await queries.resenaTienda(ORG, fila.id)).toMatchObject({ tienda: "mercado_libre", estado: "pedida", pedidaAt: NOW });

    expect(await store.cambiarEstadoResena(ORG, fila.id, "descartada")).toBe(true);
    expect(await anotar({ tienda: "amazon" })).toBe(false);
    expect(await queries.listarResenasTienda(ORG)).toEqual([]); // descartada: ya no sale
  });

  it("lo más reciente primero; nunca las de otra organización", async () => {
    await anotar();
    await store.anotarCompraEnTienda({ organizationId: ORG, contactId: "c_lucia", conversationId: null, tienda: "mercado_libre", frase: null, now: new Date(NOW.getTime() + 60_000) });
    await store.anotarCompraEnTienda({ organizationId: OTRA, contactId: "c_otra", conversationId: null, tienda: "amazon", frase: null, now: NOW });
    const pedro = (await queries.listarResenasTienda(ORG)).find((f) => f.contactId === "c_pedro")!;
    await store.marcarPedida(ORG, pedro.id, "u_rt", NOW);

    const lista = await queries.listarResenasTienda(ORG);
    expect(lista.map((f) => [f.contacto, f.estado])).toEqual([
      ["Lucía Gómez", "por_pedir"],
      ["Pedro", "pedida"],
    ]);
    expect(lista[0]).toMatchObject({ conversationId: null, canal: null, windowExpiresAt: null });
    // Otra organización no puede leer ni cambiar una fila ajena.
    expect(await queries.resenaTienda(OTRA, pedro.id)).toBeNull();
    expect(await store.cambiarEstadoResena(OTRA, pedro.id, "la_dejo")).toBe(false);
  });

  it("«Deshacer» de Amazon: solo una de Amazon ya solicitada regresa a por pedir, y nunca la de otra organización", async () => {
    await anotar();
    const [fila] = await queries.listarResenasTienda(ORG);
    expect(await store.regresarAPorPedir(ORG, fila.id, NOW)).toBe(false); // todavía no estaba solicitada
    await store.marcarPedida(ORG, fila.id, "u_rt", NOW);
    expect(await store.regresarAPorPedir(OTRA, fila.id, NOW)).toBe(false);
    expect(await store.regresarAPorPedir(ORG, fila.id, NOW)).toBe(true);
    expect(await queries.resenaTienda(ORG, fila.id)).toMatchObject({ estado: "por_pedir", pedidaAt: null });

    await anotar({ contactId: "c_lucia", conversationId: null, tienda: "mercado_libre", frase: null });
    const lucia = (await queries.listarResenasTienda(ORG)).find((f) => f.contactId === "c_lucia")!;
    await store.marcarPedida(ORG, lucia.id, "u_rt", NOW);
    expect(await store.regresarAPorPedir(ORG, lucia.id, NOW)).toBe(false); // Mercado Libre: el texto ya salió
  });

  it("sabe cuándo salió la plantilla «Reseña en tienda» en ese chat (no las de antes ni las que fallaron)", async () => {
    await anotar({ tienda: "mercado_libre", frase: "Ya la pedí en Mercado Libre" });
    const plantilla = (id: string, at: Date, status: "sent" | "failed", templateName = "resena_tienda") => ({
      id, organizationId: ORG, conversationId: "conv_pedro", direction: "out" as const, source: "crm" as const,
      type: "template" as const, body: "Hola…", templateName, status, createdAt: at, sentAt: at,
    });
    const antes = new Date(NOW.getTime() - 86_400_000);
    const despues = new Date(NOW.getTime() + 86_400_000);
    await db.insert(s.messages).values([
      plantilla("m_antes", antes, "sent"),
      plantilla("m_otra", despues, "sent", "seg_medidas"),
      plantilla("m_fallo", new Date(despues.getTime() + 60_000), "failed"),
    ]);
    expect((await queries.listarResenasTienda(ORG))[0].plantillaAt).toBeNull();

    await db.insert(s.messages).values(plantilla("m_ok", despues, "sent"));
    const [fila] = await queries.listarResenasTienda(ORG);
    expect(fila.plantillaAt).toEqual(despues);
    expect(fila.channelId).toBe("ch_rt");
    expect(await queries.plantillaResenaId(ORG, "ch_rt")).toBeNull();
  });
});
