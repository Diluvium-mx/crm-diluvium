// Salud de la entrada de WhatsApp (Fase 3, go-live). La usan DOS vigilantes
// independientes: el worker (cada 5 min, al log) y una GitHub Action (cada
// 15 min, vía GET /api/health/inbound) que abre un issue si algo falla — así
// se avisa aunque el worker o Zernio estén caídos (no depende de WhatsApp).
// Solo conteos y edades: nunca datos de clientes (el repo es público).
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { isBusinessHours } from "./business-hours";
import { silenceProblem } from "./alert-rules";
import type { AccountsReport } from "./account-health";
import type { AccountsSummary } from "./zernio-account";

export const WORKER_HEARTBEAT_KEY = "monitor:worker-heartbeat";

export type InboundHealth = {
  ok: boolean;
  checkedAt: string;
  problems: string[];
  metrics: {
    minutesSinceLastEvent: number | null;
    stuckPending: number;
    deadLetters: number;
    quarantined: number;
    workerHeartbeatAgeSeconds: number | null;
    zernioWebhook: { isActive: boolean; failureCount: number } | null;
    /** Cuentas de WhatsApp en Zernio (solo conteos: el issue es público). */
    whatsappAccounts: AccountsSummary | null;
    businessHours: boolean;
  };
};

type ZernioWebhook = { url?: string; isActive?: boolean; failureCount?: number; events?: string[] };

/** Eventos sin los que la Bandeja no se entera de mensajes nuevos. */
const REQUIRED_EVENTS = ["message.received", "message.sent", "message.delivered", "message.read", "message.failed"];

async function zernioWebhookStatus(): Promise<{ isActive: boolean; failureCount: number; missingEvents: string[] }> {
  const apiKey = process.env.ZERNIO_API_KEY;
  const appUrl = process.env.APP_URL;
  // Sin esta configuración el receptor de webhooks no funciona: es un problema, no "sin datos".
  if (!apiKey || !appUrl) throw new Error("faltan ZERNIO_API_KEY o APP_URL en este servicio");
  const base = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api";
  const res = await fetch(`${base}/v1/webhooks/settings`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Zernio respondió ${res.status}`);
  const body = (await res.json()) as { webhooks?: ZernioWebhook[] };
  const target = `${appUrl.replace(/\/$/, "")}/api/webhooks/zernio`;
  const hook = body.webhooks?.find((w) => w.url === target);
  if (!hook) throw new Error("no hay webhook de Zernio apuntando a este entorno");
  const subscribed = new Set(hook.events ?? []);
  return {
    isActive: hook.isActive === true,
    failureCount: hook.failureCount ?? 0,
    missingEvents: REQUIRED_EVENTS.filter((e) => !subscribed.has(e)),
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Nunca rechaza: así una promesa que arranca antes no queda como rechazo sin atender. */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

export async function inboundHealth(deps: {
  heartbeatAgeSeconds: () => Promise<number | null>;
  /** El web (que recibe los webhooks) revisa también Zernio; el worker no (no tiene APP_URL). */
  checkZernio: boolean;
  /** Salud de la cuenta de WhatsApp en Zernio (./account-health.ts); alerta a cualquier hora. */
  whatsappAccounts?: () => Promise<AccountsReport>;
  now?: Date;
}): Promise<InboundHealth> {
  const now = deps.now ?? new Date();
  const silenceMinutes = Number(process.env.MONITOR_SILENCE_MINUTES ?? 60);
  const problems: string[] = [];
  // Lo que va a Zernio arranca ya y en paralelo (cada llamada tiene 10 s de tope):
  // así el endpoint responde antes de los 30 s que espera la Action.
  const webhookCheck = deps.checkZernio ? settle(zernioWebhookStatus()) : null;
  const accountsCheck = deps.whatsappAccounts ? settle(deps.whatsappAccounts()) : null;

  // Edades calculadas en SQL (received_at es timestamp sin zona escrito por la base).
  const [row] = await db
    .select({
      // Solo MENSAJES ENTRANTES: ecos, estados o reacciones no prueban que los
      // clientes estén llegando.
      minutesSinceLastEvent: sql<number | null>`(extract(epoch from localtimestamp - max(${webhookEvents.receivedAt})
        filter (where ${webhookEvents.event} = 'message.received' and ${webhookEvents.quarantinedAt} is null)) / 60)::int`,
      stuckPending: sql<number>`count(*) filter (where ${webhookEvents.processedAt} is null
        and ${webhookEvents.quarantinedAt} is null and ${webhookEvents.deadLetteredAt} is null
        and ${webhookEvents.receivedAt} < localtimestamp - interval '5 minutes')::int`,
      deadLetters: sql<number>`count(*) filter (where ${webhookEvents.processedAt} is null and ${webhookEvents.deadLetteredAt} is not null)::int`,
      quarantined: sql<number>`count(*) filter (where ${webhookEvents.processedAt} is null and ${webhookEvents.quarantinedAt} is not null)::int`,
    })
    .from(webhookEvents);

  const businessHours = isBusinessHours(now);
  const silence = silenceProblem({ now, minutesSinceLastEvent: row.minutesSinceLastEvent, silenceMinutes });
  if (silence) problems.push(silence);
  if (row.stuckPending > 0) problems.push(`${row.stuckPending} evento(s) sin procesar hace más de 5 min`);
  if (row.deadLetters > 0) problems.push(`${row.deadLetters} evento(s) en dead-letter`);
  if (row.quarantined > 0) problems.push(`${row.quarantined} evento(s) en cuarentena (cuenta no permitida)`);

  let workerHeartbeatAgeSeconds: number | null = null;
  try {
    workerHeartbeatAgeSeconds = await deps.heartbeatAgeSeconds();
    if (workerHeartbeatAgeSeconds === null || workerHeartbeatAgeSeconds > 300) {
      problems.push("el worker no reporta latido hace más de 5 min");
    }
  } catch {
    problems.push("no se pudo leer el latido del worker (Redis)");
  }

  let zernioWebhook: InboundHealth["metrics"]["zernioWebhook"] = null;
  if (webhookCheck) {
    const result = await webhookCheck;
    if (result.ok) {
      const status = result.value;
      zernioWebhook = { isActive: status.isActive, failureCount: status.failureCount };
      if (!status.isActive) problems.push("el webhook de Zernio está DESACTIVADO");
      if (status.failureCount > 0) problems.push(`el webhook de Zernio acumula ${status.failureCount} fallo(s) de entrega`);
      if (status.missingEvents.length > 0) {
        problems.push(`el webhook de Zernio no está suscrito a: ${status.missingEvents.join(", ")}`);
      }
    } else {
      problems.push(`no se pudo revisar el webhook de Zernio: ${errorText(result.error)}`);
    }
  }

  let whatsappAccounts: AccountsSummary | null = null;
  if (accountsCheck) {
    const result = await accountsCheck;
    if (result.ok) {
      whatsappAccounts = result.value.summary;
      problems.push(...result.value.problems);
    } else {
      problems.push(`no se pudo revisar la cuenta de WhatsApp: ${errorText(result.error)}`);
    }
  }

  return {
    ok: problems.length === 0,
    checkedAt: now.toISOString(),
    problems,
    metrics: { ...row, workerHeartbeatAgeSeconds, zernioWebhook, whatsappAccounts, businessHours },
  };
}
