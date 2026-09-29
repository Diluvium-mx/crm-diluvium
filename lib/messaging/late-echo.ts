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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { aiAgentNotices, messages } from "@/lib/db/schema";
import type { NormalizedMessageEvent } from "./provider";
import { SEND_UNCONFIRMED, SEND_UNKNOWN } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Pick<typeof db, "select">;

// Zernio guarda la clave de idempotencia 24 h, pero un envío que sale horas tarde no se
// adivina: fuera de esto el eco queda como otra API (como antes).
export const LATE_ECHO_WINDOW_MS = 2 * 60 * 60_000;
// Relojes de Zernio y de la base: el eco puede traer una hora un poco anterior a la fila.
const CLOCK_SKEW_MS = 60_000;

// Mismo texto, sin espacios de las orillas (el eco trae exactamente lo enviado).
const sameBody = (body: string | null) => sql`btrim(coalesce(${messages.body}, '')) = btrim(${body ?? ""})`;

/**
 * Eco TARDÍO: une el eco a la fila del CRM en duda y devuelve su id (o null si no hay
 * ninguna). La fila queda "enviada" con los ids del eco y su hora real; como contestaba
 * lo que el cliente había escrito ANTES de crearse, se marca `respondeHasta` con ese
 * entrante: lo que escribió mientras seguía en duda sigue pendiente para el agente.
 */
export async function adoptLateEcho(tx: Tx, organizationId: string, conversationId: string, event: NormalizedMessageEvent): Promise<string | null> {
  if (event.direction !== "out" || event.source !== "other_api") return null;
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
        isNull(messages.providerMessageId),
        isNull(messages.providerInternalId),
        or(
          and(eq(messages.status, "queued"), sql`${messages.errorCode} like ${`${SEND_UNKNOWN}%`}`),
          and(eq(messages.status, "failed"), eq(messages.errorCode, SEND_UNCONFIRMED)),
        ),
        eq(messages.type, event.type),
        sameBody(event.body),
        gte(messages.createdAt, new Date(sentMs - LATE_ECHO_WINDOW_MS)),
        lte(messages.createdAt, new Date(sentMs + CLOCK_SKEW_MS)),
      ),
    )
    .orderBy(asc(messages.createdAt))
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
      ...(answered ? { metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{respondeHasta}', to_jsonb(${answered.at}::text))` } : {}),
    })
    .where(and(eq(messages.id, row.id), eq(messages.organizationId, organizationId)));
  // El aviso "WhatsApp no confirmó…" de esa respuesta ya no aplica: sí llegó.
  await tx.delete(aiAgentNotices).where(and(eq(aiAgentNotices.organizationId, organizationId), eq(aiAgentNotices.messageId, row.id), eq(aiAgentNotices.kind, "envio")));
  return row.id;
}

/**
 * Eco TEMPRANO: el eco de otra API con el mismo texto que llegó mientras el POST de esta
 * fila seguía colgado. Devuelve sus ids para fusionarlo con linkSentMessage.
 */
export async function findEarlyEcho(
  exec: Exec,
  organizationId: string,
  queuedId: string,
): Promise<{ providerMessageId: string; providerInternalId: string | null; sentAt: Date } | null> {
  const [queued] = await exec
    .select({ conversationId: messages.conversationId, type: messages.type, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.id, queuedId), eq(messages.organizationId, organizationId)))
    .limit(1);
  if (!queued) return null;
  const [echo] = await exec
    .select({ providerMessageId: messages.providerMessageId, providerInternalId: messages.providerInternalId, sentAt: messages.sentAt, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, queued.conversationId),
        eq(messages.direction, "out"),
        eq(messages.source, "other_api"),
        isNotNull(messages.providerMessageId),
        eq(messages.type, queued.type),
        sameBody(queued.body),
        gte(messages.createdAt, new Date(queued.createdAt.getTime() - CLOCK_SKEW_MS)),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(1);
  if (!echo?.providerMessageId) return null;
  return { providerMessageId: echo.providerMessageId, providerInternalId: echo.providerInternalId, sentAt: echo.sentAt ?? echo.createdAt };
}
