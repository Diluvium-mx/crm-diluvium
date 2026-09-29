// Doble verificación del aviso "no disponible" (caso SDA, 29-sep-2026; reglas y
// medición en lib/messaging/unavailable.ts). La corre el worker a los
// VERIFY_AFTER_MS de guardado el aviso (cola diferida, worker/unavailable.ts) y el
// barrido de cada minuto la retoma si el job se perdió. Decide UNA vez:
// 1. ¿llegó el mensaje real con OTRO wamid junto al aviso? → "sombra" (oculto);
// 2. ¿Zernio tiene el contenido de ESE wamid? → se completa la fila como si el
//    real hubiera llegado por webhook;
// 3. si no → "sin_contenido": tarjeta para el vendedor y el Agente IA contesta con
//    el texto fijo del dueño (lib/ai/runtime/run.ts).
// El real con el MISMO wamid se completa en la ingesta (a cualquier hora), también
// después de decidir.
import { and, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTxRetry } from "@/lib/db/retry";
import { channels, conversations, messages } from "@/lib/db/schema";
import { completeUnavailableMessage, type Tx } from "./ingest";
import type { MessagingProvider, StoredInbound } from "./provider";
import {
  NO_DISPONIBLE_KEY,
  noDisponibleEstado,
  resolvedMetadata,
  SHADOW_AFTER_MS,
  SHADOW_BEFORE_MS,
  VERIFY_AFTER_MS,
  VERIFY_GIVE_UP_MS,
} from "./unavailable";

export type VerifyOutcome =
  /** Ya no está en verificación (se completó, se decidió antes o no existe). */
  | "no_aplica"
  /** Todavía no pasan VERIFY_AFTER_MS: el job diferido la corre a su hora. */
  | "esperando"
  | "sombra"
  | "recuperado"
  | "sin_contenido"
  /** Zernio no respondió y aún hay margen: el barrido la reintenta. */
  | "reintentar";

type Waking = { organizationId: string; conversationId: string; messageId: string; receivedAt: Date };

export type VerifyHooks = {
  /** Contenido recuperado de Zernio con adjuntos: descarga al bucket. */
  onMediaMessage?: (messageId: string) => Promise<void> | void;
  /** Contenido recuperado: igual que un entrante nuevo (Agente IA y palabras clave). */
  onRecovered?: (m: Waking) => Promise<void> | void;
  /** Confirmado sin contenido: el Agente IA responde con el texto fijo. */
  onConfirmedUnavailable?: (m: Waking) => Promise<void> | void;
};

type Notice = {
  id: string;
  conversationId: string;
  metadata: Record<string, unknown> | null;
  sentAt: Date | null;
  providerMessageId: string | null;
};

export async function verifyUnavailableNotice(
  provider: MessagingProvider,
  job: { organizationId: string; messageId: string },
  hooks: VerifyHooks = {},
  now = new Date(),
): Promise<VerifyOutcome> {
  const { organizationId: org, messageId } = job;
  const [row] = await db
    .select({
      notice: {
        id: messages.id,
        conversationId: messages.conversationId,
        metadata: messages.metadata,
        sentAt: messages.sentAt,
        providerMessageId: messages.providerMessageId,
      },
      providerConversationId: conversations.providerConversationId,
      providerAccountId: channels.providerAccountId,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, org)))
    .limit(1);
  if (!row || noDisponibleEstado(row.notice.metadata) !== "verificando") return "no_aplica";
  const since = verifyingSince(row.notice.metadata);
  if (since && now.getTime() - since.getTime() < VERIFY_AFTER_MS) return "esperando";

  // 1. El real llegó aparte (antes o después del aviso).
  const shadow = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const notice = await lockVerifying(tx, org, row.notice);
      if (!notice) return "no_aplica" as const;
      return (await markShadowIfRealArrived(tx, org, notice, now)) ? ("sombra" as const) : null;
    }),
  );
  if (shadow) return shadow;

  // 2. La copia de Zernio de ESE wamid.
  let stored: StoredInbound | null = null;
  if (provider.storedInboundMessage && row.notice.providerMessageId && row.providerConversationId && row.providerAccountId) {
    try {
      stored = await provider.storedInboundMessage(row.providerAccountId, row.providerConversationId, row.notice.providerMessageId);
    } catch (error) {
      const waited = since ? now.getTime() - since.getTime() : Infinity;
      if (waited < VERIFY_GIVE_UP_MS) {
        console.warn(`[no-disponible] ${messageId}: Zernio no respondió; se reintenta`, error);
        return "reintentar";
      }
      // Sin respuesta de Zernio por minutos: el cliente no se queda esperando.
      console.warn(`[no-disponible] ${messageId}: Zernio sigue sin responder; se decide con la base`, error);
    }
  }
  if (stored?.available) {
    const content = stored;
    const completed = await withTxRetry(() =>
      db.transaction(async (tx) => {
        await lockConversation(tx, org, row.notice.conversationId);
        return completeUnavailableMessage(tx, org, { providerMessageId: row.notice.providerMessageId!, ...content });
      }),
    );
    if (completed) {
      console.info(`[no-disponible] ${messageId}: Zernio sí tenía el contenido; mensaje completado`);
      const waking = { organizationId: org, conversationId: completed.conversationId, messageId: completed.id, receivedAt: since ?? now };
      await isolated(messageId, "descarga", async () => {
        if (content.attachments.length > 0) await hooks.onMediaMessage?.(completed.id);
      });
      await isolated(messageId, "Agente IA", async () => hooks.onRecovered?.(waking));
      return "recuperado";
    }
    // Ya no era aviso (el real llegó por webhook mientras se consultaba).
    return "no_aplica";
  }

  // 3. No llegó nada: sin contenido (se vuelve a revisar la sombra en la misma transacción).
  const decided = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const notice = await lockVerifying(tx, org, row.notice);
      if (!notice) return "no_aplica" as const;
      if (await markShadowIfRealArrived(tx, org, notice, now)) return "sombra" as const;
      await tx
        .update(messages)
        .set({ metadata: resolvedMetadata(notice.metadata, "sin_contenido", now) })
        .where(and(eq(messages.id, notice.id), eq(messages.organizationId, org)));
      return "sin_contenido" as const;
    }),
  );
  if (decided === "sin_contenido") {
    console.info(`[no-disponible] ${messageId}: confirmado sin contenido (Meta 131060); tarjeta y respuesta del Agente IA`);
    await isolated(messageId, "Agente IA", async () =>
      // Hora en que LLEGÓ el aviso: el cliente ya esperó la verificación, no se suma otro debounce.
      hooks.onConfirmedUnavailable?.({ organizationId: org, conversationId: row.notice.conversationId, messageId, receivedAt: since ?? now }),
    );
  }
  return decided;
}

/** Avisos en verificación que perdieron su job (Redis caído al encolar, reinicio). */
export async function noticesToVerify(now = new Date()): Promise<{ organizationId: string; messageId: string }[]> {
  return db
    .select({ organizationId: messages.organizationId, messageId: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        sql`${messages.metadata}->${NO_DISPONIBLE_KEY}->>'estado' = 'verificando'`,
        gte(messages.createdAt, new Date(now.getTime() - SWEEP_MAX_AGE_MS)),
        lt(messages.createdAt, new Date(now.getTime() - SWEEP_MIN_AGE_MS)),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(50);
}
/** El job diferido corre a los VERIFY_AFTER_MS; el barrido solo toma los que ya pasaron de eso + 30 s… */
export const SWEEP_MIN_AGE_MS = VERIFY_AFTER_MS + 30_000;
/** …y hasta 7 días (un worker caído por días no deja avisos ocultos para siempre). */
export const SWEEP_MAX_AGE_MS = 7 * 24 * 3_600_000;

function verifyingSince(metadata: Record<string, unknown> | null): Date | null {
  const raw = (metadata?.[NO_DISPONIBLE_KEY] as { desde?: unknown } | undefined)?.desde;
  const at = typeof raw === "string" ? new Date(raw) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

// Mismo orden de bloqueo que la ingesta (conversación → mensajes): sin interbloqueos.
async function lockConversation(tx: Tx, org: string, conversationId: string) {
  const [conversation] = await tx
    .select({ id: conversations.id, unreadCount: conversations.unreadCount })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, org)))
    .for("update");
  return conversation ?? null;
}

async function lockVerifying(tx: Tx, org: string, notice: Notice) {
  const conversation = await lockConversation(tx, org, notice.conversationId);
  if (!conversation) return null;
  const [fresh] = await tx
    .select({ id: messages.id, conversationId: messages.conversationId, metadata: messages.metadata, sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.id, notice.id), eq(messages.organizationId, org)))
    .for("update");
  if (!fresh || noDisponibleEstado(fresh.metadata) !== "verificando") return null;
  return { ...fresh, unreadCount: conversation.unreadCount };
}

/**
 * ¿Hay un entrante REAL (no aviso) del mismo chat junto al aviso? Entonces el aviso
 * es su sombra: se oculta y se descuenta el no leído que sumó. Ventana medida en
 * producción (el real llegó 0–5 s después; a los 19 s ya fue otro mensaje).
 */
async function markShadowIfRealArrived(
  tx: Tx,
  org: string,
  notice: { id: string; conversationId: string; metadata: Record<string, unknown> | null; sentAt: Date | null; unreadCount: number },
  now: Date,
): Promise<boolean> {
  if (!notice.sentAt) return false;
  const [real] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, org),
        eq(messages.conversationId, notice.conversationId),
        eq(messages.direction, "in"),
        ne(messages.id, notice.id),
        sql`not (coalesce(${messages.metadata}, '{}'::jsonb) ? 'unsupported')`,
        gte(messages.sentAt, new Date(notice.sentAt.getTime() - SHADOW_BEFORE_MS)),
        lte(messages.sentAt, new Date(notice.sentAt.getTime() + SHADOW_AFTER_MS)),
      ),
    )
    .orderBy(messages.sentAt)
    .limit(1);
  if (!real) return false;
  await tx
    .update(messages)
    .set({ metadata: resolvedMetadata(notice.metadata, "sombra", now, { mensajeReal: real.id }) })
    .where(and(eq(messages.id, notice.id), eq(messages.organizationId, org)));
  if (notice.unreadCount > 0) {
    await tx
      .update(conversations)
      .set({ unreadCount: sql`greatest(${conversations.unreadCount} - 1, 0)` })
      .where(and(eq(conversations.id, notice.conversationId), eq(conversations.organizationId, org)));
  }
  console.info(`[no-disponible] ${notice.id}: el mensaje real llegó aparte (${real.id}); el aviso se oculta`);
  return true;
}

async function isolated(messageId: string, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`[no-disponible] ${messageId}: falló el aviso a ${what}; el mensaje ya quedó decidido`, error);
  }
}
