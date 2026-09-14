// Límite de intentos por email en /sign-in/email — ÚNICA capa de rate
// limiting en Fase 1 (el customRule de IP en lib/auth/index.ts desactiva el
// limiter de fábrica en esta ruta; ver el comentario ahí para el porqué).
//
// Better Auth no expone un "customRule" que cambie la clave del rate limiter
// (node_modules/@better-auth/core/src/types/init-options.ts:262-278: solo
// puede ajustar window/max o desactivar la regla, nunca la clave). Por eso
// esto vive fuera del motor de rateLimit, como un hooks.before/after propio
// (node_modules/@better-auth/core/src/types/init-options.ts:1763-1770),
// reusando la MISMA tabla `rateLimit` (creada por rateLimit.storage:
// "database") con una clave que nunca choca con las de IP+path
// (createRateLimitKey en @better-auth/core/utils/ip.ts usa "ip|path"; acá
// se usa el prefijo "email-fail|").
//
// El cupo se RESERVA de forma atómica en el before-hook, antes de verificar
// la contraseña — no se cuenta solo el fallo después. Contar solo fallos
// habría dejado pasar cualquier ráfaga concurrente contra el mismo email,
// porque ninguna de las requests en vuelo habría incrementado el contador
// todavía cuando las demás pasan el chequeo. Reservar por adelantado usa el
// mismo incrementOne atómico (guardado por WHERE) que usa el storage de
// base de datos nativo de Better Auth
// (node_modules/better-auth/dist/api/rate-limiter/index.mjs:76-165), así
// que la base de datos serializa el conteo entre requests concurrentes —
// nunca pueden pasar más de MAX_ATTEMPTS a la vez por email.
//
// after: solo libera el cupo en éxito (ctx.context.returned NO es
// instanceof APIError — dispatchAuthEndpoint asigna el APIError ahí incluso
// cuando el handler lo lanzó, node_modules/better-auth/dist/api/dispatch.mjs:
// 236-241), borrando la fila para no arrastrar intentos fallidos previos
// contra el próximo login. En fallo no hace nada: el cupo ya quedó
// reservado/contado en el before-hook.
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "@better-auth/core";

const SIGN_IN_EMAIL_PATH = "/sign-in/email";
const MODEL = "rateLimit";

// 5 intentos por email en 5 minutos, después bloqueado hasta que pasen 5
// minutos desde el último intento contado.
const WINDOW_SECONDS = 300;
const MAX_ATTEMPTS = 5;

// Límite estricto de reintentos ante una carrera confirmada (otro request
// ganó la creación/actualización de la misma fila primero). Better Auth's
// own consume() reintenta sin tope explícito porque cada reintento requiere
// que OTRO request concurrente haya intervenido; acá se pone un tope de
// todos modos como red de seguridad ante un adapter que se comporte mal.
const MAX_RACE_RETRIES = 5;

type RateLimitRow = { id: string; key: string; count: number; lastRequest: number };

function keyFor(email: string): string {
  return `email-fail|${email.trim().toLowerCase()}`;
}

function readEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = (body as Record<string, unknown>).email;
  return typeof email === "string" ? email : null;
}

async function readRow(
  adapter: DBAdapter<BetterAuthOptions>,
  key: string,
): Promise<RateLimitRow | undefined> {
  const rows = await adapter.findMany<RateLimitRow>({
    model: MODEL,
    where: [{ field: "key", value: key }],
  });
  return rows[0];
}

/**
 * Reserva atómicamente un intento para `key`. Replica el consume() de
 * Better Auth (node_modules/better-auth/dist/api/rate-limiter/index.mjs:
 * 76-165): crea la fila si no existe, la reinicia si la ventana expiró, o
 * incrementa condicionado a seguir bajo MAX_ATTEMPTS. Cada rama usa un
 * incrementOne guardado por WHERE (atómico a nivel SQL) o, si el guard no
 * matchea (otro request ya avanzó la fila), relee y reintenta — hasta
 * MAX_RACE_RETRIES veces. Un create fallido solo se trata como carrera si
 * una relectura confirma que la fila ya existe; si no, el error original se
 * relanza tal cual (no se asume una carrera sin confirmarla).
 */
async function reserveAttempt(
  adapter: DBAdapter<BetterAuthOptions>,
  key: string,
  retriesLeft = MAX_RACE_RETRIES,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const windowMs = WINDOW_SECONDS * 1000;
  const now = Date.now();
  const data = await readRow(adapter, key);

  if (!data) {
    try {
      await adapter.create<RateLimitRow>({
        model: MODEL,
        data: { key, count: 1, lastRequest: now },
      });
      return { allowed: true, retryAfter: null };
    } catch (error) {
      if (!(await readRow(adapter, key))) throw error;
      if (retriesLeft <= 0) {
        throw new Error(
          `email-lockout: se agotaron los reintentos por carrera para la clave ${key}`,
        );
      }
      return reserveAttempt(adapter, key, retriesLeft - 1);
    }
  }

  if (now - data.lastRequest >= windowMs) {
    const reset = await adapter.incrementOne<RateLimitRow>({
      model: MODEL,
      where: [
        { field: "key", value: key },
        { field: "lastRequest", operator: "lte", value: data.lastRequest },
      ],
      increment: {},
      set: { count: 1, lastRequest: now },
    });
    if (reset) return { allowed: true, retryAfter: null };
    if (retriesLeft <= 0) {
      throw new Error(
        `email-lockout: se agotaron los reintentos por carrera para la clave ${key}`,
      );
    }
    return reserveAttempt(adapter, key, retriesLeft - 1);
  }

  const incremented = await adapter.incrementOne<RateLimitRow>({
    model: MODEL,
    where: [
      { field: "key", value: key },
      { field: "lastRequest", operator: "gt", value: now - windowMs },
      { field: "count", operator: "lt", value: MAX_ATTEMPTS },
    ],
    increment: { count: 1 },
    set: { lastRequest: now },
  });
  if (incremented) return { allowed: true, retryAfter: null };

  const fresh = await readRow(adapter, key);
  if (!fresh) {
    if (retriesLeft <= 0) {
      throw new Error(
        `email-lockout: se agotaron los reintentos por carrera para la clave ${key}`,
      );
    }
    return reserveAttempt(adapter, key, retriesLeft - 1);
  }
  if (now - fresh.lastRequest >= windowMs) {
    if (retriesLeft <= 0) {
      throw new Error(
        `email-lockout: se agotaron los reintentos por carrera para la clave ${key}`,
      );
    }
    return reserveAttempt(adapter, key, retriesLeft - 1);
  }
  return {
    allowed: false,
    retryAfter: Math.ceil((fresh.lastRequest + windowMs - now) / 1000),
  };
}

export const emailLockoutBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;

  const { allowed, retryAfter } = await reserveAttempt(
    ctx.context.adapter,
    keyFor(email),
  );
  if (allowed) return;

  throw new APIError(
    "TOO_MANY_REQUESTS",
    { message: "Demasiados intentos para este correo. Intenta de nuevo más tarde." },
    { "X-Retry-After": String(retryAfter ?? WINDOW_SECONDS) },
  );
});

export const emailLockoutAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;

  if (ctx.context.returned instanceof APIError) return; // ya quedó contado en el before-hook

  // Login exitoso: libera el cupo para que no arrastre intentos previos.
  await ctx.context.adapter.deleteMany({
    model: MODEL,
    where: [{ field: "key", value: keyFor(email) }],
  });
});
