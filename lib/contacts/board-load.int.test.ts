// Carga del Embudo por partes contra Postgres REAL (lib/contacts/board-load.ts). Solo corre con una base
// desechable migrada; cada caso trunca los datos compartidos porque Vitest serializa archivos.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { columnsByStage } from "@/app/(app)/contactos/_components/board-live";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

type Db = typeof import("@/lib/db").db;
type Schema = typeof import("@/lib/db/schema");
type Load = typeof import("./board-load");

describe.skipIf(!TEST_DATABASE_URL)("Embudo por partes (Postgres real)", () => {
  let db: Db;
  let s: Schema;
  let load: Load;
  let funnelSignalsForOrg: typeof import("./funnel-signals").funnelSignalsForOrg;

  const ORG = "org_board_load";
  const OTRA = "org_board_load_otra";
  const BASE = new Date("2026-10-01T12:00:00.000Z").getTime();
  const at = (minutos: number) => new Date(BASE + minutos * 60_000);
  let n = 0;

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    load = await import("./board-load");
    ({ funnelSignalsForOrg } = await import("./funnel-signals"));
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`truncate messages, conversations, channels, contacts, funnel_stages, organization, "user" cascade`);
    n = 0;
    // El alta de la organización siembra sus columnas (Inbox con papel «entrada», Prospecto…).
    await db.insert(s.organization).values([
      { id: ORG, name: "Embudo", slug: "board-load", createdAt: at(0) },
      { id: OTRA, name: "Otra", slug: "board-load-otra", createdAt: at(0) },
    ]);
    await db.insert(s.channels).values([
      { id: "canal_bl", organizationId: ORG, type: "whatsapp", provider: "zernio", providerAccountId: "acc_bl", displayName: "Canal" },
      { id: "canal_bl_otra", organizationId: OTRA, type: "whatsapp", provider: "zernio", providerAccountId: "acc_bl_otra", displayName: "Otro" },
    ]);
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  async function contacto(input: {
    id?: string;
    org?: string;
    stage?: string;
    cambio: number;
    alta?: number;
    nombre?: string;
    apellido?: string | null;
    tel?: string | null;
    ig?: string | null;
    temperatura?: "caliente" | "frio" | "en_espera" | null;
    destacado?: boolean;
    escribio?: number;
  }) {
    n += 1;
    const id = input.id ?? `c_${String(n).padStart(3, "0")}`;
    const org = input.org ?? ORG;
    await db.insert(s.contacts).values({
      id,
      organizationId: org,
      firstName: input.nombre ?? `Cliente ${n}`,
      lastName: input.apellido ?? null,
      phoneE164: input.tel ?? null,
      instagramUsername: input.ig ?? null,
      stage: input.stage ?? "inbox",
      temperature: input.temperatura ?? null,
      destacado: input.destacado ?? false,
      stageChangedAt: at(input.cambio),
      createdAt: at(input.alta ?? input.cambio),
    });
    if (input.escribio !== undefined) {
      // Escribió en ese minuto: la ventana de 24 h vence 24 h después.
      await db.insert(s.conversations).values({
        id: `conv_${id}`,
        organizationId: org,
        contactId: id,
        channelId: org === ORG ? "canal_bl" : "canal_bl_otra",
        windowExpiresAt: new Date(at(input.escribio).getTime() + 24 * 3_600_000),
        lastMessageAt: at(input.escribio),
      });
    }
    return id;
  }

  async function todasLasTandas(tamano: number) {
    const ids: string[] = [];
    let cursor: Awaited<ReturnType<Load["pageEntrada"]>>["cursor"] = null;
    do {
      const tanda = await load.pageEntrada(ORG, "inbox", cursor, tamano);
      ids.push(...tanda.contacts.map((c) => c.id));
      cursor = tanda.cursor;
    } while (cursor);
    return ids;
  }

  it("las tandas de la entrada siguen el orden de la columna, sin huecos ni repetidos (también con empates)", async () => {
    for (let i = 0; i < 9; i++) await contacto({ cambio: i });
    // Empates: mismo minuto de entrada y de alta (como una importación).
    for (let i = 0; i < 4; i++) await contacto({ cambio: 20, alta: 20 });
    // Escribió después de entrar: sube por su último mensaje.
    await contacto({ cambio: 1, escribio: 30 });
    await contacto({ stage: "prospecto", cambio: 50 });
    const todos = await load.selectBoardContacts(ORG, undefined);
    const esperado = columnsByStage(todos, ["inbox"], () => undefined).get("inbox")!.map((c) => c.id);
    expect(esperado).toHaveLength(14);
    expect(await todasLasTandas(3)).toEqual(esperado);
    expect(await todasLasTandas(100)).toEqual(esperado);
  });

  it("la carga trae completas las demás columnas y de la entrada las recientes, las marcadas y la que se abre", async () => {
    for (let i = 0; i < 6; i++) await contacto({ cambio: i });
    const caliente = await contacto({ cambio: -10, temperatura: "caliente" });
    const destacado = await contacto({ cambio: -11, destacado: true });
    const abierto = await contacto({ cambio: -12 });
    const conAviso = await contacto({ cambio: -13 });
    const prospecto = await contacto({ stage: "prospecto", cambio: -20 });
    await contacto({ org: OTRA, cambio: 100 });
    const loadedAt = at(1_000);
    const { contacts, entrada } = await load.cargarEmbudo(ORG, { abrir: abierto, loadedAt, conSenal: [conAviso], primera: 3 });
    const ids = contacts.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["c_006", "c_005", "c_004", caliente, destacado, abierto, conAviso, prospecto]));
    expect(ids).not.toContain("c_001");
    expect(ids).not.toContain("c_012"); // el de la otra organización
    // En la entrada hay 10 dados de alta antes de cargar; llegaron 3 recientes + 4 aparte = 7.
    expect(entrada).toMatchObject({ key: "inbox", restantes: 3 });
    expect(entrada?.cursor).not.toBeNull();
  });

  it("los que se dan de alta después de cargar no cuentan entre los que faltan", async () => {
    for (let i = 0; i < 5; i++) await contacto({ cambio: i });
    await contacto({ cambio: 2_000, alta: 2_000 });
    const { entrada } = await load.cargarEmbudo(ORG, { abrir: null, loadedAt: at(1_000), conSenal: [], primera: 2 });
    // 5 existían al cargar; el nuevo (alta posterior) entra entre los recientes pero no se cuenta.
    expect(entrada?.restantes).toBe(4);
  });

  it("sin más por cargar el cursor es nulo y no falta nada", async () => {
    await contacto({ cambio: 1 });
    await contacto({ cambio: 2 });
    const { entrada } = await load.cargarEmbudo(ORG, { abrir: null, loadedAt: at(1_000), conSenal: [] });
    expect(entrada).toEqual({ key: "inbox", restantes: 0, cursor: null });
  });

  it("la búsqueda del servidor ignora acentos y mayúsculas y busca por teléfono y @usuario", async () => {
    const jose = await contacto({ cambio: 1, nombre: "José", apellido: "Peña" });
    const tel = await contacto({ cambio: 2, tel: "+526681234567" });
    const ig = await contacto({ cambio: 3, ig: "Compuertas_MX" });
    await contacto({ cambio: 4, nombre: "Ana" });
    await contacto({ org: OTRA, cambio: 5, nombre: "José" });
    const buscar = async (t: string) => (await load.buscarContactosEmbudo(ORG, t)).map((c) => c.id).sort();
    expect(await buscar("jose pena")).toEqual([jose]);
    expect(await buscar("PEÑA")).toEqual([jose]);
    expect(await buscar("668123")).toEqual([tel]);
    expect(await buscar("5216681234567")).toEqual([tel]);
    expect(await buscar("@compu")).toEqual([ig]);
    expect(await buscar("j")).toEqual([]);
  });

  it("señales «desde»: solo los contactos con mensaje desde esa hora, también los que quedaron en cero", async () => {
    await contacto({ id: "viejo", cambio: 1, escribio: 10 });
    await contacto({ id: "reciente", cambio: 1, escribio: 500 });
    const desde = await funnelSignalsForOrg(ORG, undefined, at(400));
    expect(Object.keys(desde)).toEqual(["reciente"]);
  });
});
