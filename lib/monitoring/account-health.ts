// Revisión de la cuenta de WhatsApp en Zernio para cada canal activo y no
// archivado (alarma de desconexión). La hacen los dos vigilantes: el worker
// (cada 5 min) y el web en /api/health/inbound (la Action, cada 15 min), así la
// Action no depende del worker. Guarda el resultado en Redis con la hora: el
// Dashboard lo lee de ahí y NUNCA llama a Zernio al cargar.
//
// Solo LECTURA a Zernio (GET). Sin datos de clientes en lo que se devuelve.
// Reglas y estados: ./zernio-account.ts.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { redis } from "@/lib/redis";
import {
  accountProblems,
  evaluateAccount,
  parseAccountEvents,
  parseAccountHealth,
  summarizeAccounts,
  uncheckedAccountsProblem,
  type AccountOutcome,
  type AccountRead,
  type AccountsSummary,
  type AccountState,
} from "./zernio-account";

export const ACCOUNTS_SNAPSHOT_KEY = "monitor:whatsapp-accounts";
/** Primera revisión registrada (SET NX, sin vencimiento): eventos anteriores no alertan. */
export const ACCOUNTS_BASELINE_KEY = "monitor:whatsapp-accounts:baseline";
/** Última revisión de cada vigilante (llave propia: worker y web no se pisan). */
export const accountsLastRunKey = (source: MonitorSource) => `monitor:whatsapp-accounts:last:${source}`;
/** Estado del webhook de Zernio que revisó el web por última vez (para el Dashboard). */
export const ZERNIO_WEBHOOK_KEY = "monitor:zernio-webhook";

const ZERNIO_TIMEOUT_MS = 10_000;

export type MonitorSource = "worker" | "web";

export type AccountsSnapshot = {
  baselineAt: string;
  /** Última revisión (de cualquier vigilante), haya podido leer Zernio o no. */
  checkedAt: string;
  /** Una fila por canal vigente; la de un canal que no se pudo revisar conserva su última revisión buena. */
  accounts: AccountState[];
};

/** `unchecked` va aparte: alerta solo tras 2 revisiones seguidas fallidas (inbound-health.ts). */
export type AccountsReport = { problems: string[]; unchecked: string | null; summary: AccountsSummary };

class ZernioReadError extends Error {}

async function zernioGet(path: string): Promise<{ status: number; body: unknown }> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new ZernioReadError("falta ZERNIO_API_KEY en este servicio");
  const base = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(ZERNIO_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ZernioReadError(timeout ? "Zernio no respondió en 10 s" : "sin conexión con Zernio");
  }
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** 404 de Zernio con su cuerpo propio ({"error":"Account not found"}): la cuenta ya no está ahí. */
function accountNotFound(res: { status: number; body: unknown }): boolean {
  if (res.status !== 404 || typeof res.body !== "object" || res.body === null) return false;
  const error = (res.body as { error?: unknown }).error;
  return typeof error === "string" && /not found/i.test(error);
}

async function readAccount(accountId: string): Promise<AccountRead> {
  const id = encodeURIComponent(accountId);
  // En paralelo: todo cabe en ~10 s (la Action espera 30 s al endpoint).
  const [health, eventsRes] = await Promise.allSettled([
    zernioGet(`/v1/accounts/${id}/health`),
    zernioGet(`/v1/whatsapp/account-events?accountId=${id}&limit=50`),
  ]);
  if (health.status === "rejected") throw health.reason;
  if (accountNotFound(health.value)) return { kind: "not_found" };
  const { status, body } = health.value;
  if (status < 200 || status >= 300) throw new ZernioReadError(`Zernio respondió ${status}`);
  const parsed = parseAccountHealth(body);
  if (!parsed) throw new ZernioReadError("respuesta de Zernio no reconocida");
  // Los eventos solo complementan (avisos y "desde"): si fallan, decide health.
  const events =
    eventsRes.status === "fulfilled" && eventsRes.value.status >= 200 && eventsRes.value.status < 300
      ? parseAccountEvents(eventsRes.value.body)
      : null;
  return { kind: "ok", health: parsed, events };
}

/** Canales que se vigilan: WhatsApp por Zernio, activos y no archivados (todas las organizaciones). */
export async function monitoredChannels() {
  return db
    .select({ id: channels.id, organizationId: channels.organizationId, accountId: channels.providerAccountId })
    .from(channels)
    .where(and(eq(channels.provider, "zernio"), eq(channels.isActive, true), isNull(channels.archivedAt)));
}

export function parseSnapshot(raw: string | null): AccountsSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AccountsSnapshot;
    return Array.isArray(value.accounts) ? value : null;
  } catch {
    return null;
  }
}

export async function checkWhatsappAccounts(input: { source: MonitorSource; now?: Date }): Promise<AccountsReport> {
  const now = input.now ?? new Date();
  const list = await monitoredChannels();

  // Redis es apoyo (baseline, "desde", último aviso): si falla, se revisa igual
  // con baseline = ahora (ningún evento viejo alerta) y no se guarda.
  let baselineAt = now;
  let previous: AccountsSnapshot | null = null;
  let alertAfter: Date | null = null;
  let redisOk = true;
  try {
    await redis.set(ACCOUNTS_BASELINE_KEY, now.toISOString(), "NX");
    const [baseline, raw, lastRun] = await redis.mget(ACCOUNTS_BASELINE_KEY, ACCOUNTS_SNAPSHOT_KEY, accountsLastRunKey(input.source));
    if (baseline && !Number.isNaN(Date.parse(baseline))) baselineAt = new Date(baseline);
    previous = parseSnapshot(raw);
    if (lastRun && !Number.isNaN(Date.parse(lastRun))) alertAfter = new Date(lastRun);
  } catch (error) {
    redisOk = false;
    console.error("[monitor] cuentas de WhatsApp: no se pudo leer Redis", error);
  }
  const previousOf = new Map((previous?.accounts ?? []).map((a) => [a.channelId, a]));

  const outcomes: AccountOutcome[] = await Promise.all(
    list.map(async (channel): Promise<AccountOutcome> => {
      try {
        const read = await readAccount(channel.accountId);
        const evaluation = evaluateAccount({
          channelId: channel.id,
          organizationId: channel.organizationId,
          read,
          previous: previousOf.get(channel.id) ?? null,
          baselineAt,
          alertAfter,
          now,
        });
        return { kind: "checked", evaluation };
      } catch (error) {
        return { kind: "unchecked", error: error instanceof ZernioReadError ? error.message : "error al revisar" };
      }
    }),
  );

  if (redisOk) {
    const accounts = list.flatMap((channel, i): AccountState[] => {
      const outcome = outcomes[i];
      if (outcome.kind === "checked") return [outcome.evaluation.state];
      const kept = previousOf.get(channel.id);
      return kept ? [kept] : [];
    });
    const snapshot: AccountsSnapshot = { baselineAt: baselineAt.toISOString(), checkedAt: now.toISOString(), accounts };
    await redis
      .mset(ACCOUNTS_SNAPSHOT_KEY, JSON.stringify(snapshot), accountsLastRunKey(input.source), now.toISOString())
      .catch((error: unknown) => {
        console.error("[monitor] cuentas de WhatsApp: no se pudo guardar en Redis", error);
      });
  }

  return { problems: accountProblems(outcomes, now), unchecked: uncheckedAccountsProblem(outcomes), summary: summarizeAccounts(outcomes) };
}

/** Texto corto para el log del worker ("1 conectada · 0 por revisar …"). */
export function describeSummary(s: AccountsSummary): string {
  if (s.checked === 0) return "sin canales de WhatsApp activos";
  const parts = [`${s.ok} conectada(s)`];
  if (s.warning > 0) parts.push(`${s.warning} por revisar`);
  if (s.down > 0) parts.push(`${s.down} DESCONECTADA(S)`);
  if (s.unchecked > 0) parts.push(`${s.unchecked} sin revisar`);
  return parts.join(" · ");
}
