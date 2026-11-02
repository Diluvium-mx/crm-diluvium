// Carga del Embudo por partes (auditoría de velocidad B4, 2-nov-2026). La columna de entrada (Inbox, papel
// «entrada») tiene ~98 % de los contactos, casi todos importados de GHL: mandar los ~14,600 en cada visita eran
// 728 kB comprimidos y 0.56 s en el servidor. Ahora van completas todas las demás columnas y de la entrada solo:
// las ENTRADA_PRIMERA más recientes por actividad (el mismo orden de la columna: columnsByStage), las que tienen
// temperatura o ⭐ (los filtros del Embudo), las que tienen un aviso pendiente (las agrega quien llama con las
// señales) y la que se abre por ?contacto=. El resto se pide por tandas al bajar en la columna (pageEntrada) o
// al buscar (buscarContactosEmbudo). `restantes` = cuántos de la entrada faltan, para que el contador de la
// columna siga diciendo el total. Solo lee; todo acotado a la organización.
import { and, count, eq, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema/contacts";
import { conversations } from "@/lib/db/schema/messaging";
import { boardContactColumns, type BoardContact } from "@/lib/contacts/board-contact";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { lastInboundFromWindow } from "@/lib/contacts/funnel-signals";
import { stageForRole } from "@/lib/contacts/stages";
import { SERVICE_WINDOW_MS } from "@/lib/messaging/rules";
import { escapeLike, normalizeSearch, SQL_SEARCH_FROM, SQL_SEARCH_TO } from "@/lib/text/search";

/** De la entrada, cuántos llegan con la página (los más recientes) y cuántos más por tanda. */
export const ENTRADA_PRIMERA = 300;
export const ENTRADA_MAS = 500;
/** Tope de resultados de la búsqueda del servidor (lo que el tablero aún no tenía). */
export const BUSQUEDA_MAX = 300;
// Tope de contactos con aviso pendiente que se agregan a la carga (en la práctica son cientos).
const CON_SENAL_MAX = 2_000;

/** Dónde va la última tarjeta de la entrada que llegó: actividad, alta (epoch ms) e id. */
export type CursorEntrada = { at: number; created: number; id: string };
export type CargaEntrada = { key: string; restantes: number; cursor: CursorEntrada | null };

// Último mensaje del cliente por contacto: max(window_expires_at) de sus chats en un solo agrupado.
function ultimaVentana(organizationId: string) {
  return db
    .select({
      contactId: conversations.contactId,
      windowMs: sql<number | string | null>`(extract(epoch from max(${conversations.windowExpiresAt})) * 1000)::float8`.as("window_ms"),
    })
    .from(conversations)
    .where(eq(conversations.organizationId, organizationId))
    .groupBy(conversations.contactId)
    .as("last_window");
}

/**
 * Contactos del Embudo con la hora del último mensaje del cliente (ordena la columna junto con
 * stageChangedAt). `where` acota los contactos, siempre dentro de la organización.
 */
export async function selectBoardContacts(organizationId: string, where: SQL | undefined, limit?: number): Promise<BoardContact[]> {
  const lastWindow = ultimaVentana(organizationId);
  const query = db
    .select({ ...boardContactColumns, windowMs: lastWindow.windowMs })
    .from(contacts)
    .leftJoin(lastWindow, eq(lastWindow.contactId, contacts.id))
    .where(and(eq(contacts.organizationId, organizationId), where))
    .orderBy(sql`${contacts.stageChangedAt} desc`, sql`${contacts.createdAt} desc`);
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map(({ windowMs, ...contact }) => ({ ...contact, lastInboundAt: lastInboundFromWindow(windowMs) }));
}

/** Clave de la columna de entrada de la organización (papel «entrada»), o null si no tiene. */
export async function entradaKey(organizationId: string): Promise<string | null> {
  return stageForRole(await listFunnelStages(organizationId), "entrada")?.key ?? null;
}

/**
 * Una tanda de la columna de entrada, de más reciente a más vieja por actividad (lo más nuevo entre que entró
 * a la etapa y el último mensaje del cliente; empate: el alta más nueva y luego el id), como boardActivityAt y
 * columnsByStage. `after` = el cursor de la tanda anterior (null = desde arriba). El cursor que devuelve es
 * null cuando ya no hay más.
 */
export async function pageEntrada(
  organizationId: string,
  key: string,
  after: CursorEntrada | null,
  limit: number,
): Promise<{ contacts: BoardContact[]; cursor: CursorEntrada | null }> {
  const lastWindow = ultimaVentana(organizationId);
  const activity = sql<number>`greatest(floor(extract(epoch from ${contacts.stageChangedAt}) * 1000)::float8, coalesce(${lastWindow.windowMs} - ${SERVICE_WINDOW_MS}, 0)::float8)`;
  const created = sql<number>`floor(extract(epoch from ${contacts.createdAt}) * 1000)::float8`;
  // El id con orden por bytes (como la comparación de textos de JS), no por el idioma de la base.
  const idOrden = sql`${contacts.id} collate "C"`;
  const despues = after
    ? sql`(${activity} < ${after.at} or (${activity} = ${after.at} and (${created} < ${after.created} or (${created} = ${after.created} and ${idOrden} > ${after.id}))))`
    : undefined;
  const rows = await db
    .select({ ...boardContactColumns, windowMs: lastWindow.windowMs, at: activity.mapWith(Number), createdMs: created.mapWith(Number) })
    .from(contacts)
    .leftJoin(lastWindow, eq(lastWindow.contactId, contacts.id))
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.stage, key), despues))
    .orderBy(sql`${activity} desc`, sql`${created} desc`, sql`${idOrden} asc`)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    contacts: page.map((row) => {
      const { windowMs, at, createdMs, ...contact } = row;
      void at;
      void createdMs;
      return { ...contact, lastInboundAt: lastInboundFromWindow(windowMs) };
    }),
    cursor: rows.length > limit && last ? { at: last.at, created: last.createdMs, id: last.id } : null,
  };
}

/** Lista sin repetidos, en el orden de listContacts (stageChangedAt y alta, de más nuevo a más viejo). */
function juntar(...listas: BoardContact[][]): BoardContact[] {
  const porId = new Map<string, BoardContact>();
  for (const lista of listas) for (const c of lista) if (!porId.has(c.id)) porId.set(c.id, c);
  const t = (v: Date | string) => new Date(v).getTime();
  return [...porId.values()].sort((a, b) => t(b.stageChangedAt) - t(a.stageChangedAt) || t(b.createdAt) - t(a.createdAt));
}

/**
 * Carga inicial del Embudo. `loadedAt` = la hora (del servidor) tomada ANTES de leer: el total de la entrada
 * cuenta solo los dados de alta hasta entonces; los que se crean después llegan en vivo y se cuentan por su
 * columna. `conSenal` = contactos con aviso pendiente (señales del Embudo), que se agregan si faltan.
 * Sin columna de entrada: todos los contactos, como antes.
 */
export async function cargarEmbudo(
  organizationId: string,
  opts: { abrir: string | null; loadedAt: Date; conSenal: readonly string[]; primera?: number },
): Promise<{ contacts: BoardContact[]; entrada: CargaEntrada | null }> {
  const key = await entradaKey(organizationId);
  if (!key) return { contacts: await selectBoardContacts(organizationId, undefined), entrada: null };
  const marcados = or(isNotNull(contacts.temperature), eq(contacts.destacado, true), opts.abrir ? eq(contacts.id, opts.abrir) : undefined);
  const [resto, primera, conMarca, [total]] = await Promise.all([
    selectBoardContacts(organizationId, ne(contacts.stage, key)),
    pageEntrada(organizationId, key, null, opts.primera ?? ENTRADA_PRIMERA),
    selectBoardContacts(organizationId, and(eq(contacts.stage, key), marcados)),
    db
      .select({ n: count() })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.stage, key), lte(contacts.createdAt, opts.loadedAt))),
  ]);
  const tenidos = new Set([...resto, ...primera.contacts, ...conMarca].map((c) => c.id));
  const faltan = [...new Set(opts.conSenal)].filter((id) => !tenidos.has(id)).slice(0, CON_SENAL_MAX);
  const conSenal = faltan.length > 0 ? await selectBoardContacts(organizationId, inArray(contacts.id, faltan)) : [];
  const lista = juntar(resto, primera.contacts, conMarca, conSenal);
  const cargados = lista.filter((c) => c.stage === key && new Date(c.createdAt).getTime() <= opts.loadedAt.getTime()).length;
  return { contacts: lista, entrada: { key, restantes: Math.max(0, (total?.n ?? 0) - cargados), cursor: primera.cursor } };
}

/**
 * Búsqueda del Embudo en el servidor (para lo que el tablero aún no tiene): por nombre y apellido sin acentos
 * ni mayúsculas, por teléfono (3+ dígitos; «521…» de un número viejo también encuentra el «52…») y por
 * @usuario de Instagram. Las mismas reglas que el buscador del tablero. Todas las columnas.
 */
export async function buscarContactosEmbudo(organizationId: string, raw: string, limit = BUSQUEDA_MAX): Promise<BoardContact[]> {
  const term = normalizeSearch(raw).trim();
  if (term.length < 2) return [];
  const sinAcentos = (col: SQL) => sql`lower(translate(${col}, ${SQL_SEARCH_FROM}, ${SQL_SEARCH_TO}))`;
  const nombre = sinAcentos(sql`regexp_replace(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')), '\\s+', ' ', 'g')`);
  const condiciones: SQL[] = [sql`${nombre} like ${`%${escapeLike(term)}%`}`];
  const digitos = raw.replace(/\D/g, "");
  if (digitos.length >= 3) {
    const tel = sql`regexp_replace(coalesce(${contacts.phoneE164}, ''), '\\D', '', 'g')`;
    condiciones.push(sql`${tel} like ${`%${digitos}%`}`);
    const viejo = digitos.match(/^521(\d{10})$/);
    if (viejo) condiciones.push(sql`${tel} like ${`%${viejo[1]}`}`);
  }
  const handle = term.replace(/^@+/, "");
  if (handle) condiciones.push(sql`${sinAcentos(sql`coalesce(${contacts.instagramUsername}, '')`)} like ${`%${escapeLike(handle)}%`}`);
  return selectBoardContacts(organizationId, or(...condiciones), limit);
}

