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
//
// Redis degradado (ver también redis-client.ts):
// - Arranque en frío / reconexión: se ESPERA la conexión (compartida, con
//   tope) en vez de dejar pasar todo mientras conecta; así una ráfaga al
//   arrancar una instancia no queda sin límite. Solo si no llega a tiempo se
//   deja pasar.
// - Comandos que Redis ejecuta tarde: el caller ya dejó pasar la request por
//   timeout, pero un EVALSHA ya escrito en el socket no se puede cancelar y
//   Redis lo ejecutaría al recuperarse, con su reloj de ese momento,
//   llenando buckets con hits viejos. Por eso el script recibe un deadline y,
//   si ya venció cuando Redis lo ejecuta, no toca nada.
import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { RateLimitDecision, RateLimitRule, RateLimitStore } from "./limiter";

// KEYS[1] = clave; ARGV[1] = ventana ms; ARGV[2] = max; ARGV[3] = miembro único;
// ARGV[4] = deadline (epoch ms): si Redis lo ejecuta después, no hace nada.
// Devuelve { estado (1 aceptada | 0 rechazada | 2 vencida), remaining, retryAfterMs }
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local deadline = tonumber(ARGV[4])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

if now > deadline then
  return {2, 0, 0}
end

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
// Cuánto se espera a que Redis esté listo (arranque en frío o reconexión)
// antes de dejar pasar sin límite.
const DEFAULT_CONNECT_WAIT_MS = 1_000;
// Holgura del deadline por diferencia de relojes entre la app y Redis. Si
// el reloj de Redis se adelantara más que timeout + esta holgura, todos los
// hits vencerían y el limiter dejaría pasar todo: queda registrado como
// error ("vencido") en cada request, así que se nota.
const CLOCK_SKEW_TOLERANCE_MS = 1_000;

export class RedisRateLimitStore implements RateLimitStore {
  private pendingReady: Promise<void> | undefined;

  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly connectWaitMs = DEFAULT_CONNECT_WAIT_MS,
  ) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    // Nunca se emite un comando sin conexión lista (ver redis-client.ts):
    // un comando que no se envía no puede ejecutarse tarde.
    await this.ensureReady();
    const deadline = Date.now() + this.timeoutMs + CLOCK_SKEW_TOLERANCE_MS;
    const reply = await withTimeout(this.run(key, rule, deadline), this.timeoutMs);
    if (!Array.isArray(reply) || reply.length !== 3) {
      throw new Error(`rate-limit: respuesta inesperada de Redis: ${JSON.stringify(reply)}`);
    }
    const [status, remaining, retryAfterMs] = reply.map(Number);
    if (status === 2) {
      throw new Error("rate-limit: Redis ejecutó el hit después de su deadline (vencido, sin efecto)");
    }
    return { allowed: status === 1, remaining, retryAfterMs };
  }

  // Todas las requests concurrentes esperan la MISMA conexión, con tope.
  private ensureReady(): Promise<void> {
    if (this.redis.status === "ready") return Promise.resolve();
    if (this.redis.status === "end") {
      return Promise.reject(new Error("rate-limit: conexión a Redis cerrada (end)"));
    }
    if (this.redis.status === "wait") this.redis.connect().catch(() => {}); // arranque perezoso
    this.pendingReady ??= new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`rate-limit: Redis no estuvo listo en ${this.connectWaitMs} ms (${this.redis.status})`),
        );
      }, this.connectWaitMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.redis.off("ready", onReady);
        this.pendingReady = undefined;
      };
      this.redis.once("ready", onReady);
    });
    return this.pendingReady;
  }

  private async run(key: string, rule: RateLimitRule, deadline: number): Promise<unknown> {
    const args = [String(rule.windowMs), String(rule.max), randomUUID(), String(deadline)];
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
