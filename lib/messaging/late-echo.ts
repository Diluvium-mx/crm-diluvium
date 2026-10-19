// Envío del CRM de resultado DESCONOCIDO y su eco (28-sep-2026, chat de Ana Mayda).
//
// Zernio no contestó el POST a tiempo (timeout, 5xx) pero SÍ mandó el mensaje. El CRM
// no tiene sus ids, así que su eco (message.sent, transporte cloud_api) no se podía
// enlazar y se guardaba como OTRO mensaje ("otra API"): el mismo mensaje dos veces en
// el hilo, la fila propia "enviando" 15 min frenando al Agente IA (no contesta encima
// de un envío en camino) y el eco "contestando" lo que el cliente escribió mientras.
//
// Regla (OK del dueño): un eco de OTRA API se une al envío del CRM que quedó en duda si
// es de la MISMA conversación, del mismo tipo y con el MISMO texto, y llegó dentro de la
// ventana. Las dos llegadas posibles:
// - eco DESPUÉS de marcar la duda → `adoptLateEcho` (ingest, en su transacción);
// - eco ANTES (llegó mientras el POST seguía colgado) → `findEarlyEcho` (send.ts), que
//   luego fusiona con linkSentMessage como cualquier "eco primero".
//
// Eco de OTRO tipo (19-oct-2026, dueño; chats de Silvia y Ary Prat): el eco no siempre trae el tipo del envío.
// - Una plantilla (seguimiento) vuelve como «text» con el texto ya armado.
// - En Instagram un archivo con pie sale como DOS mensajes de Meta (el pie y el archivo) y vuelven dos ecos: un
//   «text» con el pie y el archivo sin texto (docs/instagram.md).
// Antes ninguno se unía: el envío se daba por «no confirmado» a los 15 min (tarjeta y Agente IA en pausa) aunque
// el cliente ya lo había leído y contestado, y el eco quedaba como otro mensaje. Ahora se unen con las mismas
// reglas (misma conversación, ventana de 2 h) y el texto exacto cuando lo hay; la otra parte de Instagram se
// guarda como parte del mismo envío (INSTAGRAM_PARTS_META), igual que en un envío normal.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";
import { aiAgentNotices, channels, conversations, messages } from "@/lib/db/schema";
import type { NormalizedMessageEvent } from "./provider";
import { INSTAGRAM_PARTS_META, SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Pick<typeof db, "select">;

// Zernio guarda la clave de idempotencia 24 h, pero un envío que sale horas tarde no se
// adivina: fuera de esto el eco queda como otra API (como antes).
export const LATE_ECHO_WINDOW_MS = 2 * 60 * 60_000;
// Relojes de Zernio y de la base: el eco puede traer una hora un poco anterior a la fila.
const CLOCK_SKEW_MS = 60_000;

// Mismo texto, sin espacios de las orillas (el eco trae exactamente lo enviado).
const sameBody = (body: string | null) => sql`btrim(coalesce(${messages.body}, '')) = btrim(${body ?? ""})`;
const hasBody = sql`btrim(coalesce(${messages.body}, '')) <> ''`;

type MessageType = NormalizedMessageEvent["type"];
const MEDIA_TYPES: readonly MessageType[] = ["image", "audio", "video", "document"];
const isMedia = (t: string): t is MessageType => (MEDIA_TYPES as readonly string[]).includes(t);
// Marca en `messages.metadata`: el envío se unió con un eco PARCIAL de Instagram (pie o archivo); la otra parte
// todavía puede llegar y también es de él.
const LATE_ECHO_PARTS_META = "ecoTardioPartes";

/**
 * ¿Qué filas del CRM corresponden a un eco de este tipo y texto? (1) mismo tipo y texto; (2) una plantilla y el
 * eco «text» con su texto; (3) Instagram: un archivo con pie y el eco «text» con ese pie, o el eco del archivo sin
 * texto. Columnas de `messages` (la fila del CRM).
 */
function echoShape(platform: NormalizedMessageEvent["platform"], type: MessageType, body: string | null): SQL {
  const shapes: SQL[] = [and(eq(messages.type, type), sameBody(body))!];
  if (type === "text") shapes.push(and(eq(messages.type, "template"), sameBody(body))!);
  if (platform === "instagram" && type === "text") shapes.push(and(inArray(messages.type, [...MEDIA_TYPES]), sameBody(body))!);
  if (platform === "instagram" && isMedia(type) && !body?.trim()) shapes.push(and(eq(messages.type, type), hasBody)!);
  return or(...shapes)!;
}
// El eco es solo una parte (Instagram): no trae el tipo y el texto completos de la fila.
const partialShape = (rowType: string, rowBody: string | null, type: MessageType, body: string | null) =>
  isMedia(rowType) && !!rowBody?.trim() && (type === "text" || !body?.trim());

/**
 * Eco TARDÍO: une el eco a la fila del CRM en duda y devuelve su id (o null si no hay
 * ninguna). La fila queda "enviada" con los ids del eco y su hora real; como contestaba
 * lo que el cliente había escrito ANTES de crearse, se marca `respondeHasta` con ese
 * entrante: lo que escribió mientras seguía en duda sigue pendiente para el agente.
 */
export async function adoptLateEcho(tx: Tx, organizationId: string, conversationId: string, event: NormalizedMessageEvent): Promise<string | null> {
  if (event.direction !== "out" || event.source !== "other_api") return null;
  const sentMs = event.sentAt.getTime();
  if (event.platform === "instagram") {
    const part = await adoptSecondPart(tx, organizationId, conversationId, event);
    if (part) return part;
  }
  const [row] = await tx
    .select({ id: messages.id, type: messages.type, body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "ai_agent"]),
        isNull(messages.providerMessageId),
        isNull(messages.providerInternalId),
        or(
          and(eq(messages.status, "queued"), sql`${messages.errorCode} like ${`${SEND_UNKNOWN}%`}`),
          and(eq(messages.status, "failed"), eq(messages.errorCode, SEND_UNCONFIRMED)),
        ),
        echoShape(event.platform, event.type, event.body),
        gte(messages.createdAt, new Date(sentMs - LATE_ECHO_WINDOW_MS)),
        lte(messages.createdAt, new Date(sentMs + CLOCK_SKEW_MS)),
      ),
    )
    // El del mismo tipo primero (un texto en duda antes que un archivo con el mismo pie).
    .orderBy(sql`(${messages.type} = ${event.type}) desc`, asc(messages.createdAt))
    .limit(1)
    .for("update");
  if (!row) return null;
  // Hora EXACTA (texto, con microsegundos) del último entrante vivo anterior a la fila.
  const [answered] = await tx
    .select({ at: sql<string>`coalesce(${messages.sentAt}, ${messages.createdAt})::text` })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "in"),
        isNull(messages.importedAt),
        sql`${messages.createdAt} <= (select r.created_at from messages r where r.id = ${row.id})`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  await tx
    .update(messages)
    .set({
      providerMessageId: event.providerMessageId,
      providerInternalId: event.providerInternalId,
      // El eco prueba que salió: "enviado" aunque el barrido ya lo hubiera dado por fallido.
      // Entregado/leído llegan después por su wamid.
      status: "sent",
      errorCode: null,
      errorMessage: null,
      sentAt: event.sentAt,
      metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify({
        ...(answered ? { respondeHasta: answered.at } : {}),
        ...(event.platform === "instagram" && partialShape(row.type, row.body, event.type, event.body) ? { [LATE_ECHO_PARTS_META]: true } : {}),
      })}::jsonb`,
    })
    .where(and(eq(messages.id, row.id), eq(messages.organizationId, organizationId)));
  // El aviso "WhatsApp no confirmó…" de esa respuesta ya no aplica: sí llegó.
  await tx.delete(aiAgentNotices).where(and(eq(aiAgentNotices.organizationId, organizationId), eq(aiAgentNotices.messageId, row.id), eq(aiAgentNotices.kind, "envio")));
  return row.id;
}

/**
 * Instagram: la OTRA parte (pie o archivo) de un envío que ya se unió con su primer eco parcial. Se guarda como
 * parte del mismo envío (no es otro mensaje) y devuelve su id, o null si no es eso.
 */
async function adoptSecondPart(tx: Tx, organizationId: string, conversationId: string, event: NormalizedMessageEvent): Promise<string | null> {
  const sentMs = event.sentAt.getTime();
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        inArray(messages.source, ["crm", "ai_agent"]),
        sql`coalesce((${messages.metadata} ->> ${LATE_ECHO_PARTS_META})::boolean, false)`,
        ne(messages.providerMessageId, event.providerMessageId),
        echoShape(event.platform, event.type, event.body),
        gte(messages.createdAt, new Date(sentMs - LATE_ECHO_WINDOW_MS)),
        lte(messages.createdAt, new Date(sentMs + CLOCK_SKEW_MS)),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(1)
    .for("update");
  if (!row) return null;
  await tx
    .update(messages)
    .set({
      metadata: sql`(coalesce(${messages.metadata}, '{}'::jsonb) - ${LATE_ECHO_PARTS_META}) || jsonb_build_object(${INSTAGRAM_PARTS_META}::text, coalesce(${messages.metadata} -> ${INSTAGRAM_PARTS_META}, '[]'::jsonb) || to_jsonb(${event.providerMessageId}::text))`,
    })
    .where(and(eq(messages.id, row.id), eq(messages.organizationId, organizationId)));
  return row.id;
}

/**
 * Eco TEMPRANO: el eco de otra API con el mismo texto que llegó mientras el POST de esta
 * fila seguía colgado. Devuelve sus ids para fusionarlo con linkSentMessage; en Instagram,
 * si el archivo con pie volvió en dos ecos, el otro va en `extraProviderMessageIds`.
 */
export async function findEarlyEcho(
  exec: Exec,
  organizationId: string,
  queuedId: string,
): Promise<{ providerMessageId: string; providerInternalId: string | null; sentAt: Date; extraProviderMessageIds: string[] } | null> {
  const [queued] = await exec
    .select({ conversationId: messages.conversationId, type: messages.type, body: messages.body, createdAt: messages.createdAt, platform: channels.type })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(messages.id, queuedId), eq(messages.organizationId, organizationId)))
    .limit(1);
  if (!queued) return null;
  // Aquí la fila del CRM es la conocida y se buscan los ecos: las mismas formas de echoShape, al revés.
  const shapes: SQL[] = [and(eq(messages.type, queued.type), sameBody(queued.body))!];
  if (queued.type === "template") shapes.push(and(eq(messages.type, "text"), sameBody(queued.body))!);
  const split = queued.platform === "instagram" && isMedia(queued.type) && !!queued.body?.trim();
  if (split) {
    shapes.push(and(eq(messages.type, "text"), sameBody(queued.body))!);
    shapes.push(and(eq(messages.type, queued.type), sql`btrim(coalesce(${messages.body}, '')) = ''`)!);
  }
  const echoes = await exec
    .select({ providerMessageId: messages.providerMessageId, providerInternalId: messages.providerInternalId, sentAt: messages.sentAt, createdAt: messages.createdAt, type: messages.type })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, queued.conversationId),
        eq(messages.direction, "out"),
        eq(messages.source, "other_api"),
        isNotNull(messages.providerMessageId),
        or(...shapes),
        gte(messages.createdAt, new Date(queued.createdAt.getTime() - CLOCK_SKEW_MS)),
      ),
    )
    .orderBy(sql`(${messages.type} = ${queued.type}) desc`, asc(messages.createdAt))
    .limit(split ? 2 : 1);
  const [echo, other] = echoes;
  if (!echo?.providerMessageId) return null;
  // Las dos partes de Instagram son de tipos distintos (el pie y el archivo); dos iguales serían otro envío.
  const extra = split && other?.providerMessageId && other.type !== echo.type ? [other.providerMessageId] : [];
  return { providerMessageId: echo.providerMessageId, providerInternalId: echo.providerInternalId, sentAt: echo.sentAt ?? echo.createdAt, extraProviderMessageIds: extra };
}
