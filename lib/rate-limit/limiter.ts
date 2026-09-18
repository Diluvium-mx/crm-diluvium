// Rate limiter por IP para route handlers (runtime Node).
//
// Algoritmo: ventana deslizante exacta (sliding log). Cada request aceptada
// deja una marca con su timestamp; una request pasa si en los últimos
// `windowMs` hay menos de `max` marcas. El cupo se RESERVA en el mismo paso
// atómico que la verificación (mismo patrón que lib/auth/email-lockout.ts):
// una ráfaga concurrente no puede colarse entre "leer" y "contar".
//
// Las requests rechazadas NO dejan marca: el cliente vuelve a tener cupo en
// cuanto la marca más vieja sale de la ventana (eso es el Retry-After).
//
// Si el store falla (Redis caído o lento) se deja PASAR la request y se
// registra el error: la capa de IP es defensa en profundidad, no debe tumbar
// el login. El candado por email (Postgres) sigue activo en /sign-in/email.
import { clientIpFromHeaders, UNKNOWN_IP } from "./client-ip";

export type RateLimitRule = {
  /** Identifica la regla en la clave de Redis y en los logs. */
  name: string;
  max: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  /** Cupo que queda en la ventana tras esta request (0 si se rechazó). */
  remaining: number;
  /** Milisegundos hasta que haya cupo de nuevo (0 si se aceptó). */
  retryAfterMs: number;
};

export interface RateLimitStore {
  /** Verifica y reserva cupo de forma atómica para `key`. */
  hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

export type RateLimiterOptions = {
  store: RateLimitStore;
  /** Posición en x-forwarded-for (ver client-ip.ts). */
  xffIndex?: number;
  log?: Pick<Console, "warn" | "error">;
};

export type RateLimiter = {
  /** `null` si la request pasa; si no, la respuesta 429 lista para devolver. */
  check(req: Request, rules: readonly RateLimitRule[]): Promise<Response | null>;
};

export function rateLimitKey(rule: RateLimitRule, ip: string): string {
  return `rl:${rule.name}:${ip}`;
}

export function createRateLimiter({
  store,
  xffIndex = 0,
  log = console,
}: RateLimiterOptions): RateLimiter {
  return {
    async check(req, rules) {
      if (rules.length === 0) return null;

      const ip = clientIpFromHeaders(req.headers, xffIndex);
      if (!ip) {
        // Con Railway esto no debería pasar (el edge siempre escribe el
        // header). Si pasa, todas esas requests comparten un bucket: se loguea
        // para detectarlo en vez de dejarlo pasar sin límite.
        log.warn("[rate-limit] sin IP de cliente en x-forwarded-for; bucket compartido");
      }
      const clientKey = ip ?? UNKNOWN_IP;

      // Reglas en orden: si una rechaza, las siguientes no consumen cupo.
      for (const rule of rules) {
        let decision: RateLimitDecision;
        try {
          decision = await store.hit(rateLimitKey(rule, clientKey), rule);
        } catch (error) {
          log.error(`[rate-limit] store falló en regla ${rule.name}; se deja pasar`, error);
          return null;
        }
        if (!decision.allowed) {
          log.warn(`[rate-limit] 429 regla=${rule.name} ip=${clientKey}`);
          return tooManyRequests(decision.retryAfterMs);
        }
      }
      return null;
    },
  };
}

export function tooManyRequests(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      code: "TOO_MANY_REQUESTS",
      message: "Demasiadas solicitudes. Intenta de nuevo en unos momentos.",
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

/** Envuelve un route handler: aplica `rules(req)` antes de ejecutarlo. */
export function withRateLimit<Args extends unknown[]>(
  limiter: RateLimiter,
  rules: (req: Request) => readonly RateLimitRule[],
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    const limited = await limiter.check(req, rules(req));
    return limited ?? handler(req, ...args);
  };
}
