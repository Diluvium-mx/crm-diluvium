// Limiter por IP de la app (Redis) y reglas por ruta. Se aplica en los route
// handlers (runtime Node), no en proxy.ts: así cada endpoint público declara
// su límite explícitamente.
import { authRateLimitRules as buildAuthRules } from "./auth-rules";
import { readRateLimitConfig } from "./config";
import { createRateLimiter } from "./limiter";
import { createRateLimitRedis } from "./redis-client";
import { RedisRateLimitStore } from "./redis-store";

export { withRateLimit } from "./limiter";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not set");
}

const config = readRateLimitConfig();

// Cliente propio, no el compartido de lib/redis.ts: el limiter necesita
// fallar rápido, sin cola offline (ver redis-client.ts).
const globalForRateLimit = globalThis as unknown as {
  rateLimitRedis?: ReturnType<typeof createRateLimitRedis>;
};
const rateLimitRedis =
  globalForRateLimit.rateLimitRedis ?? createRateLimitRedis(process.env.REDIS_URL);
if (process.env.NODE_ENV !== "production") globalForRateLimit.rateLimitRedis = rateLimitRedis;

export const ipRateLimiter = createRateLimiter({
  store: new RedisRateLimitStore(rateLimitRedis),
  xffIndex: config.xffIndex,
});

export const authRateLimitRules = buildAuthRules(config);
