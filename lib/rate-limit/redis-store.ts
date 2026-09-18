// Store del rate limiter en Redis: sorted set por clave, un miembro por
// request aceptada con su timestamp como score.
//
// Todo el check-and-reserve corre en UN script Lua: Redis ejecuta los
// scripts de forma atómica (ningún otro comando se intercala), así que N
// requests concurrentes contra la misma clave no pueden aceptar más de `max`.
//
// La hora sale de Redis (TIME), no del proceso: con varias réplicas de la app
// todas miden la ventana con el mismo reloj. Requiere Redis >= 5 (replicación
// por efectos, default desde 5.0) para poder escribir después de TIME.
import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { RateLimitDecision, RateLimitRule, RateLimitStore } from "./limiter";

// KEYS[1] = clave; ARGV[1] = ventana ms; ARGV[2] = max; ARGV[3] = miembro único
// Devuelve { allowed (1|0), remaining, retryAfterMs }
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < max then
  redis.call('ZADD', key, now, ARGV[3])
  redis.call('PEXPIRE', key, window)
  return {1, max - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = tonumber(oldest[2]) + window - now
if retry < 1 then retry = 1 end
return {0, 0, retry}
`;

const SCRIPT_SHA = createHash("sha1").update(SLIDING_WINDOW_LUA).digest("hex");

// Si Redis no contesta en este tiempo, el limiter deja pasar (ver limiter.ts).
// Sin esto, ioredis encola el comando y reintenta mientras reconecta: el
// login quedaría colgado mientras Redis esté caído.
const DEFAULT_TIMEOUT_MS = 500;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const reply = await withTimeout(this.run(key, rule), this.timeoutMs);
    if (!Array.isArray(reply) || reply.length !== 3) {
      throw new Error(`rate-limit: respuesta inesperada de Redis: ${JSON.stringify(reply)}`);
    }
    const [allowed, remaining, retryAfterMs] = reply.map(Number);
    return { allowed: allowed === 1, remaining, retryAfterMs };
  }

  private async run(key: string, rule: RateLimitRule): Promise<unknown> {
    const args = [String(rule.windowMs), String(rule.max), randomUUID()];
    try {
      return await this.redis.evalsha(SCRIPT_SHA, 1, key, ...args);
    } catch (error) {
      // Primera vez en esta instancia de Redis (o tras un SCRIPT FLUSH):
      // se manda el script completo, que queda cacheado para las siguientes.
      if (error instanceof Error && error.message.startsWith("NOSCRIPT")) {
        return this.redis.eval(SLIDING_WINDOW_LUA, 1, key, ...args);
      }
      throw error;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate-limit: Redis no respondió en ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
