// Datos de la pastilla "WhatsApp" del Dashboard para UNA organización (la de
// la sesión, nunca del cliente). Lee lo último que guardó el monitoreo en
// Redis; NO llama a Zernio. Si Redis no responde en 2 s, la pastilla sale gris
// ("Sin revisar") en vez de colgar la página.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { channels, messages } from "@/lib/db/schema";
import { redis } from "@/lib/redis";
import { ACCOUNTS_SNAPSHOT_KEY, parseSnapshot, ZERNIO_WEBHOOK_KEY } from "./account-health";
import { WORKER_HEARTBEAT_KEY } from "./inbound-health";
import { whatsappStatus, type WebhookSnapshot, type WhatsappStatus } from "./status-pill";

type Database = typeof appDb;

const REDIS_TIMEOUT_MS = 2_000;

async function readMonitorKeys(): Promise<(string | null)[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REDIS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([redis.mget(ACCOUNTS_SNAPSHOT_KEY, ZERNIO_WEBHOOK_KEY, WORKER_HEARTBEAT_KEY), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseWebhook(raw: string | null | undefined): WebhookSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WebhookSnapshot;
    return typeof value.checkedAt === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function loadWhatsappStatus(database: Database, organizationId: string, now = new Date()): Promise<WhatsappStatus | null> {
  const orgChannels = await database
    .select({ id: channels.id, displayName: channels.displayName })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.provider, "zernio"),
        eq(channels.isActive, true),
        isNull(channels.archivedAt),
      ),
    )
    .orderBy(channels.createdAt);
  if (orgChannels.length === 0) return null;

  // Último mensaje ENTRANTE en vivo (lo copiado del historial del celular no cuenta).
  // created_at es UTC sin zona: epoch en SQL para no depender del parser del driver.
  const [last] = await database
    .select({ ms: sql<number | null>`(extract(epoch from max(${messages.createdAt})) * 1000)::float8` })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.direction, "in"), isNull(messages.importedAt)));

  const keys = await readMonitorKeys();
  const snapshot = parseSnapshot(keys?.[0] ?? null);
  const heartbeat = Number(keys?.[2]);

  return whatsappStatus({
    now,
    channels: orgChannels,
    accounts: snapshot ? snapshot.accounts.filter((a) => a.organizationId === organizationId) : null,
    lastInboundAt: last?.ms != null ? new Date(last.ms) : null,
    workerHeartbeatAt: Number.isFinite(heartbeat) && heartbeat > 0 ? new Date(heartbeat) : null,
    webhook: parseWebhook(keys?.[1]),
  });
}
