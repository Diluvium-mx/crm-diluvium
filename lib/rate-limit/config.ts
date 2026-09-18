// Límites del rate limiter por IP, configurables por env. Un valor inválido
// hace fallar el arranque: un límite mal escrito no debe desactivar la
// protección en silencio.
import type { RateLimitRule } from "./limiter";

type Env = Record<string, string | undefined>;

export type RateLimitConfig = {
  xffIndex: number;
  /** Todas las rutas de /api/auth/*. */
  auth: RateLimitRule;
  /** Además de `auth`, solo en POST /api/auth/sign-in/email. */
  signIn: RateLimitRule;
};

export const DEFAULTS = {
  // get-session y compañía: holgado para varias pestañas detrás del mismo NAT.
  authMax: 120,
  authWindowSeconds: 60,
  // Credential stuffing contra muchos correos desde una IP. El candado por
  // email (5 fallos/300 s) cubre el caso de un solo correo.
  signInMax: 20,
  signInWindowSeconds: 900,
} as const;

export function readRateLimitConfig(env: Env = process.env): RateLimitConfig {
  return {
    xffIndex: readInt(env, "RATE_LIMIT_XFF_INDEX", 0, { allowNegative: true }),
    auth: {
      name: "auth",
      max: readInt(env, "RATE_LIMIT_AUTH_MAX", DEFAULTS.authMax),
      windowMs: readInt(env, "RATE_LIMIT_AUTH_WINDOW_SECONDS", DEFAULTS.authWindowSeconds) * 1000,
    },
    signIn: {
      name: "sign-in",
      max: readInt(env, "RATE_LIMIT_SIGNIN_MAX", DEFAULTS.signInMax),
      windowMs:
        readInt(env, "RATE_LIMIT_SIGNIN_WINDOW_SECONDS", DEFAULTS.signInWindowSeconds) * 1000,
    },
  };
}

function readInt(
  env: Env,
  name: string,
  fallback: number,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} debe ser un entero, se recibió "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (!allowNegative && value <= 0)) {
    throw new Error(`${name} fuera de rango, se recibió "${raw}"`);
  }
  return value;
}
