// Fila de espera de los envíos (Bloque B, 28-sep-2026). Zernio limita a 60
// peticiones/min por cuenta y responde 429 ("espera") cuando se pasa. Un 429 NO
// es un error: Zernio no procesó la petición, así que el envío espera lo que
// diga Zernio (Retry-After, o unos segundos) y se repite con la MISMA clave de
// idempotencia. Al cliente nunca le llega nada de esto y el vendedor ve su
// mensaje "enviando" (reloj), no un error.
//
// Orden: dentro de cada conversación los mensajes salen en el orden en que
// llegaron (created_at). Cada envío deja en su fila una marca de turno
// (`messages.metadata.envio`, sin migración) y, antes de llamar a Zernio,
// espera a que ningún envío MÁS VIEJO de la conversación siga en fila. Vale
// igual para el bot, los vendedores, los workflows y los programados, en el
// web y en el worker, porque la fila es la base.
//
// Marca: { estado: "enviando" | "espera", hasta: epoch ms, esperas: 429 vistos,
// diferido?: true }. "hasta" vence sola: si el proceso que esperaba murió, su
// marca deja de frenar a los demás TURN_STALE_GRACE_MS después.
//
// En el web (Server Action del vendedor) no se espera en la petición: Next
// procesa las acciones de un cliente una tras otra y la pantalla se quedaría
// trabada. Si hay que esperar más de `defer.budgetMs`, el envío se pasa al
// worker (lib/queue/outbox.ts) y la acción responde "enviando".
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { SendFailedError, type SendResult } from "./provider";
import { SEND_RATE_LIMITED } from "./rules";

/** Cada cuánto revisa su turno un envío que espera detrás de otro. */
export const TURN_POLL_MS = 2_000;
/** Espera ante un 429 sin Retry-After (crece: 5 s, 10 s, 20 s… hasta el tope por paso). */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
const RATE_LIMIT_MIN_WAIT_MS = 1_000;
const RATE_LIMIT_MAX_STEP_MS = 60_000;
/**
 * Tope de espera de un envío (en fila + 429). Pasado esto no salió y queda
 * fallido con SEND_RATE_LIMITED (se puede reintentar: nunca llegó a Zernio).
 * Menor que los barridos de "atorado" (15 min del outbox, 10 min de programados
 * y de corridas de workflow).
 */
export const RATE_LIMIT_MAX_TOTAL_MS = 5 * 60_000;
/** Una marca vencida deja de frenar a los demás pasado este margen. */
export const TURN_STALE_GRACE_MS = 30_000;
// Mientras el POST está en vuelo (SEND_TIMEOUT_MS de Zernio = 15 s, más margen).
const IN_FLIGHT_MS = 20_000;
// Un envío pasado al worker puede tardar en tomarse (worker ocupado, reinicio).
const DEFERRED_SLACK_MS = 60_000;

export type TurnMark = { estado: "enviando" | "espera"; hasta: number; esperas: number; diferido?: boolean };

export type DeferSpec = {
  /** Cuánto puede esperar la petición antes de pasarle el envío al worker. */
  budgetMs: number;
  enqueue: (delayMs: number) => Promise<void>;
};

export type TurnInput = {
  messageId: string;
  organizationId: string;
  conversationId: string;
  send: () => Promise<SendResult>;
  defer?: DeferSpec;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};

export type TurnResult = { kind: "sent"; result: SendResult } | { kind: "deferred" };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera ante un 429: la que pide Zernio, acotada; sin dato, crece con cada 429. */
export function rateLimitWaitMs(retryAfterMs: number | null, esperas: number): number {
  const base = retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS * 2 ** Math.max(0, esperas - 1);
  return Math.min(RATE_LIMIT_MAX_STEP_MS, Math.max(RATE_LIMIT_MIN_WAIT_MS, base));
}

async function mark(input: TurnInput, value: TurnMark): Promise<void> {
  await db.execute(sql`
    update messages
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('envio', ${JSON.stringify(value)}::jsonb)
    where id = ${input.messageId} and organization_id = ${input.organizationId}`);
}

/**
 * ¿Hay un envío MÁS VIEJO de la conversación todavía en fila? En fila = saliente
 * en cola, sin ids del proveedor ni código de error (ya resuelto o ambiguo no
 * frena) y con su marca de turno vigente.
 */
async function olderInLine(input: TurnInput, now: number): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    select o.id from messages o, messages me
    where me.id = ${input.messageId} and me.organization_id = ${input.organizationId}
      and o.organization_id = ${input.organizationId} and o.conversation_id = ${input.conversationId}
      and o.id <> me.id and o.direction = 'out' and o.status = 'queued'
      and o.provider_message_id is null and o.provider_internal_id is null and o.error_code is null
      and (o.metadata->'envio'->>'hasta') ~ '^[0-9]+$'
      and (o.metadata->'envio'->>'hasta')::bigint + ${TURN_STALE_GRACE_MS} > ${now}
      and (o.created_at, o.id) < (me.created_at, me.id)
    limit 1`);
  return rows.length > 0;
}

function rateLimited(error: unknown): error is SendFailedError {
  return error instanceof SendFailedError && error.outcome === "rate_limited";
}

/**
 * Manda con turno por conversación y espera ante un 429. Lanza lo mismo que
 * `send` (rechazo o resultado desconocido); si el tope de espera se agota, lanza
 * un rechazo con SEND_RATE_LIMITED (no salió). "deferred" = pasó al worker.
 */
export async function sendInTurn(input: TurnInput): Promise<TurnResult> {
  const sleep = input.sleep ?? defaultSleep;
  const clock = input.clock ?? Date.now;
  const started = clock();
  let esperas = 0;
  // Espera `ms` con la marca "espera" (o pasa el envío al worker si la petición no puede esperar).
  const wait = async (ms: number): Promise<"waited" | "deferred"> => {
    const now = clock();
    if (now - started + ms > RATE_LIMIT_MAX_TOTAL_MS) {
      throw new SendFailedError(SEND_RATE_LIMITED, "WhatsApp pidió esperar más de 5 min; el mensaje no salió.", "rejected");
    }
    if (input.defer && now - started + ms > input.defer.budgetMs) {
      await mark(input, { estado: "espera", hasta: now + ms + DEFERRED_SLACK_MS, esperas, diferido: true });
      await input.defer.enqueue(ms);
      return "deferred";
    }
    await mark(input, { estado: "espera", hasta: now + ms, esperas });
    await sleep(ms);
    return "waited";
  };

  for (;;) {
    if (await olderInLine(input, clock())) {
      if ((await wait(TURN_POLL_MS)) === "deferred") return { kind: "deferred" };
      continue;
    }
    await mark(input, { estado: "enviando", hasta: clock() + IN_FLIGHT_MS, esperas });
    try {
      return { kind: "sent", result: await input.send() };
    } catch (error) {
      if (!rateLimited(error)) throw error;
      esperas++;
      console.warn(`[send] Zernio pidió esperar (429) para ${input.messageId}; espera ${esperas}`);
      if ((await wait(rateLimitWaitMs(error.retryAfterMs, esperas))) === "deferred") return { kind: "deferred" };
    }
  }
}
