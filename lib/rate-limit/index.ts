// Limiter por IP de la app (Redis) y reglas por ruta. Se aplica en los route
// handlers (runtime Node), no en proxy.ts: así cada endpoint público declara
// su límite explícitamente.
import { redis } from "@/lib/redis";
import { authRateLimitRules as buildAuthRules } from "./auth-rules";
import { readRateLimitConfig } from "./config";
import { createRateLimiter } from "./limiter";
import { RedisRateLimitStore } from "./redis-store";

export { withRateLimit } from "./limiter";

const config = readRateLimitConfig();

export const ipRateLimiter = createRateLimiter({
  store: new RedisRateLimitStore(redis),
  xffIndex: config.xffIndex,
});

export const authRateLimitRules = buildAuthRules(config);
