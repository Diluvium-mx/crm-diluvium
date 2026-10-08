import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Store from "./store";
import type * as Queries from "./queries";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ORG = "org_op";
const OTRA = "org_op_otra";
const NOW = new Date("2026-10-07T18:00:00Z");

describe.skipIf(!TEST_DATABASE_URL)("opiniones (Postgres real)", () => {
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

  beforeEach(async () => {
    await db.execute(d.sql`truncate opiniones, opiniones_config, channels, contacts, organization, "user" cascade`);
    await db.insert(s.organization).values([
      { id: ORG, name: "Diluvium", slug: "diluvium-op", createdAt: NOW },
      { id: OTRA, name: "Otra Empresa", slug: "otra-op", createdAt: NOW },
    ]);
    await db.insert(s.user).values({ id: "u_op", name: "Daniel", email: "daniel@op.test", emailVerified: true, createdAt: NOW, updatedAt: NOW });
    await db.insert(s.channels).values([
      { id: "ch_prueba", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_p", displayName: "Prueba", phoneE164: "+12029087457", isTest: true },
      { id: "ch_real", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_r", displayName: "Diluvium", phoneE164: "+526682419579" },
      { id: "ch_viejo", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_v", displayName: "Viejo", phoneE164: "+526690000000", archivedAt: NOW },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  const respuesta = (token: string) =>
    ({ token, estrellas: 5, texto: "No entró nada", lluvia: "resistio", permiso: "con_nombre", nombre: "Rosa", ciudad: "Culiacán" }) as const;

  it("crea el enlace con código de la organización y vence a los 60 días", async () => {
    const { id, token, codigo } = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    expect(codigo).toMatch(/^DILU-[A-Z2-9]{4}$/);
    const [fila] = await db.select().from(s.opiniones).where(d.eq(s.opiniones.id, id));
    expect(fila.token).toBe(token);
    expect(fila.expiresAt.toISOString()).toBe("2026-12-06T18:00:00.000Z");
    expect(fila.answeredAt).toBeNull();
  });

  it("la página pública ve la organización, el WhatsApp real (no el de prueba ni el archivado) y el enlace de Google", async () => {
    const { token } = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    expect(await queries.opinionPorToken(token, NOW)).toMatchObject({
      estado: "pendiente",
      organizacion: "Diluvium",
      telefonoEmpresa: "+526682419579",
      googleResenaUrl: null,
    });
    await store.guardarGoogleResenaUrl(ORG, "https://maps.app.goo.gl/x", "u_op");
    expect((await queries.opinionPorToken(token, NOW))?.googleResenaUrl).toBe("https://maps.app.goo.gl/x");
    expect(await queries.opinionPorToken("NoExisteNoExisteNoExis", NOW)).toBeNull();
  });

  it("se contesta una sola vez; lo segundo es «ya_contestada»", async () => {
    const { token } = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    expect(await store.responderOpinion(respuesta(token), NOW)).toBe("ok");
    expect(await store.responderOpinion({ ...respuesta(token), estrellas: 1 }, NOW)).toBe("ya_contestada");
    const [fila] = await db.select().from(s.opiniones).where(d.eq(s.opiniones.token, token));
    expect(fila).toMatchObject({ estrellas: 5, nombre: "Rosa", ciudad: "Culiacán", permiso: "con_nombre" });
    expect(fila.permisoTexto).toContain("con mi nombre y mi ciudad");
    expect((await queries.opinionPorToken(token, NOW))?.estado).toBe("contestada");
  });

  it("dos envíos al mismo tiempo: solo uno queda", async () => {
    const { token } = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    const resultados = await Promise.all([
      store.responderOpinion(respuesta(token), NOW),
      store.responderOpinion({ ...respuesta(token), estrellas: 2 }, NOW),
    ]);
    expect(resultados.sort()).toEqual(["ok", "ya_contestada"]);
  });

  it("vencido no se guarda; token inexistente tampoco", async () => {
    const { token } = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    const despues = new Date(NOW.getTime() + 61 * 86_400_000);
    expect(await store.responderOpinion(respuesta(token), despues)).toBe("vencida");
    expect(await store.responderOpinion(respuesta("NoExisteNoExisteNoExis"), NOW)).toBe("no_existe");
    expect((await queries.opinionPorToken(token, despues))?.estado).toBe("vencida");
  });

  it("la lista es solo de su organización y borrar solo quita enlaces de prueba", async () => {
    await db.insert(s.contacts).values({ id: "ct_op", organizationId: ORG, firstName: "Rosa", lastName: "Mendoza", phoneE164: "+526671234567", source: "whatsapp" });
    const prueba = await store.crearOpinion({ organizationId: ORG, prueba: true, now: NOW });
    const real = await store.crearOpinion({ organizationId: ORG, contactId: "ct_op", prueba: false, now: new Date(NOW.getTime() + 1000) });
    await store.crearOpinion({ organizationId: OTRA, prueba: true, now: NOW });

    const lista = await queries.listarOpiniones(ORG, NOW);
    expect(lista.map((f) => f.id)).toEqual([real.id, prueba.id]);
    expect(lista[0]).toMatchObject({ contacto: "Rosa Mendoza", prueba: false, estado: "pendiente" });

    expect(await store.borrarOpinionPrueba(ORG, real.id)).toBe(false);
    expect(await store.borrarOpinionPrueba(OTRA, prueba.id)).toBe(false);
    expect(await store.borrarOpinionPrueba(ORG, prueba.id)).toBe(true);
    expect((await queries.listarOpiniones(ORG, NOW)).map((f) => f.id)).toEqual([real.id]);
  });

  it("el enlace de Google se guarda, se cambia y se quita", async () => {
    await store.guardarGoogleResenaUrl(ORG, "https://maps.app.goo.gl/uno", "u_op");
    await store.guardarGoogleResenaUrl(ORG, "https://g.page/r/dos/review", "u_op");
    expect(await queries.googleResenaUrl(ORG)).toBe("https://g.page/r/dos/review");
    expect(await queries.googleResenaUrl(OTRA)).toBeNull();
    await store.guardarGoogleResenaUrl(ORG, null, "u_op");
    expect(await queries.googleResenaUrl(ORG)).toBeNull();
  });
});
