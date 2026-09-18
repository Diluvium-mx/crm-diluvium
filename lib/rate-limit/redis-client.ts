// Cliente Redis PROPIO del rate limiter, separado del compartido
// (lib/redis.ts), configurado para fallar rápido en vez de encolar.
//
// Con las opciones por defecto de ioredis, un comando emitido mientras Redis
// está caído se queda en la cola offline y se reintenta al reconectar. El
// limiter ya dejó pasar esa request (timeout → fail open), así que al volver
// Redis se ejecutaría una ráfaga de hits viejos con el reloj del momento de
// la recuperación, que llenaría los buckets y bloquearía a usuarios legítimos
// justo cuando el servicio se recuperó. Por eso:
// - enableOfflineQueue: false → sin conexión lista, el comando falla al
//   instante y nunca se encola;
// - maxRetriesPerRequest: 0 y autoResendUnfulfilledCommands: false → lo que
//   estaba en vuelo al cortarse la conexión se descarta, no se reenvía;
// - commandTimeout → ioredis rechaza el comando si Redis no contesta.
import Redis from "ioredis";

export const RATE_LIMIT_REDIS_OPTIONS = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  autoResendUnfulfilledCommands: false,
  commandTimeout: 500,
  connectTimeout: 2_000,
  connectionName: "rate-limit",
} as const;

// Un error por conexión caída basta; ioredis emite uno por cada reintento.
const ERROR_LOG_INTERVAL_MS = 60_000;

export function createRateLimitRedis(url: string, log: Pick<Console, "error"> = console): Redis {
  const client = new Redis(url, RATE_LIMIT_REDIS_OPTIONS);
  let lastLoggedAt = 0;
  client.on("error", (error: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt = now;
    log.error("[rate-limit] error de conexión a Redis (el limiter deja pasar mientras dure)", error.message);
  });
  return client;
}
