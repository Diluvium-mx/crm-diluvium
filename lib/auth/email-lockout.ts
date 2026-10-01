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
// nunca pueden pasar más intentos que el máximo de su límite a la vez.
//
// after: solo libera el cupo en éxito (ctx.context.returned NO es
// instanceof APIError — dispatchAuthEndpoint asigna el APIError ahí incluso
// cuando el handler lo lanzó, node_modules/better-auth/dist/api/dispatch.mjs:
// 236-241), borrando la fila para no arrastrar intentos fallidos previos
// contra el próximo login. En fallo no hace nada: el cupo ya quedó
// reservado/contado en el before-hook.
//
// S3 (revisión de seguridad CN-010 y CN-007, 30-sep-2026): el candado ya no es
// solo por correo. Antes, 5 fallos en 5 min bloqueaban ese correo para TODOS: quien
// supiera el correo de un vendedor lo dejaba sin entrar desde cualquier lugar.
// Ahora (decisión del dueño): 10 intentos en 5 min por correo DESDE ESA CONEXIÓN
// (IP), y un tope general de 50 por hora por correo desde todas las conexiones
// juntas. Cada fallo y cada bloqueo nuevo quedan registrados (./auth-events.ts).
// Los intentos mientras dura un bloqueo no se cuentan: se levanta 5 min (o 1 h, el
// general) después del último intento contado. Un inicio exitoso borra el candado
// de esa conexión (el general sigue contando su hora).
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "@better-auth/core";
import { clientIpFromHeaders } from "@/lib/rate-limit/client-ip";
import { readRateLimitConfig } from "@/lib/rate-limit/config";
import { logAuthFailed, recordLockout, type LockoutScope } from "./auth-events";

const SIGN_IN_EMAIL_PATH = "/sign-in/email";
const MODEL = "rateLimit";

type Limit = { max: number; windowSeconds: number };
/** Por correo + conexión: 10 intentos en 5 minutos. */
export const PER_IP_LIMIT: Limit = { max: 10, windowSeconds: 300 };
/** Por correo desde todas las conexiones: 50 intentos en 1 hora. */
export const PER_EMAIL_LIMIT: Limit = { max: 50, windowSeconds: 3600 };
const XFF_INDEX = readRateLimitConfig().xffIndex;

// Límite estricto de reintentos ante una carrera confirmada (otro request
// ganó la creación/actualización de la misma fila primero). Better Auth's
// own consume() reintenta sin tope explícito porque cada reintento requiere
// que OTRO request concurrente haya intervenido; acá se pone un tope de
// todos modos como red de seguridad ante un adapter que se comporte mal.
const MAX_RACE_RETRIES = 5;

type RateLimitRow = { id: string; key: string; count: number; lastRequest: number };

/** Candado de un correo desde una conexión (sin IP conocida, todas comparten "sin-ip"). */
export function keyFor(email: string, ip: string | null): string {
  return `email-fail|${email.trim().toLowerCase()}|${ip ?? "sin-ip"}`;
}

/** Tope general del correo (todas las conexiones). */
export function totalKeyFor(email: string): string {
  return `email-total|${email.trim().toLowerCase()}`;
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
 * incrementa condicionado a seguir bajo el máximo del límite. Cada rama usa un
 * incrementOne guardado por WHERE (atómico a nivel SQL) o, si el guard no
 * matchea (otro request ya avanzó la fila), relee y reintenta — hasta
 * MAX_RACE_RETRIES veces. Un create fallido solo se trata como carrera si
 * una relectura confirma que la fila ya existe; si no, el error original se
 * relanza tal cual (no se asume una carrera sin confirmarla).
 */
async function reserveAttempt(
  adapter: DBAdapter<BetterAuthOptions>,
  key: string,
  limit: Limit,
  retriesLeft = MAX_RACE_RETRIES,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const windowMs = limit.windowSeconds * 1000;
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
      return reserveAttempt(adapter, key, limit, retriesLeft - 1);
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
    return reserveAttempt(adapter, key, limit, retriesLeft - 1);
  }

  const incremented = await adapter.incrementOne<RateLimitRow>({
    model: MODEL,
    where: [
      { field: "key", value: key },
      { field: "lastRequest", operator: "gt", value: now - windowMs },
      { field: "count", operator: "lt", value: limit.max },
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
    return reserveAttempt(adapter, key, limit, retriesLeft - 1);
  }
  if (now - fresh.lastRequest >= windowMs) {
    if (retriesLeft <= 0) {
      throw new Error(
        `email-lockout: se agotaron los reintentos por carrera para la clave ${key}`,
      );
    }
    return reserveAttempt(adapter, key, limit, retriesLeft - 1);
  }
  return {
    allowed: false,
    retryAfter: Math.ceil((fresh.lastRequest + windowMs - now) / 1000),
  };
}

function lockedOut(email: string, ip: string | null, scope: LockoutScope, retryAfter: number): never {
  recordLockout(email, ip, scope, retryAfter);
  throw new APIError(
    "TOO_MANY_REQUESTS",
    { message: "Demasiados intentos para este correo. Intenta de nuevo más tarde." },
    { "X-Retry-After": String(retryAfter) },
  );
}

export const emailLockoutBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;
  const ip = ctx.headers ? clientIpFromHeaders(ctx.headers, XFF_INDEX) : null;

  const perIp = await reserveAttempt(ctx.context.adapter, keyFor(email, ip), PER_IP_LIMIT);
  if (!perIp.allowed) lockedOut(email, ip, "correo+ip", perIp.retryAfter ?? PER_IP_LIMIT.windowSeconds);
  const total = await reserveAttempt(ctx.context.adapter, totalKeyFor(email), PER_EMAIL_LIMIT);
  if (!total.allowed) lockedOut(email, ip, "correo", total.retryAfter ?? PER_EMAIL_LIMIT.windowSeconds);
});

export const emailLockoutAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;

  const ip = ctx.headers ? clientIpFromHeaders(ctx.headers, XFF_INDEX) : null;
  const returned = ctx.context.returned;
  if (returned instanceof APIError) {
    // Ya quedó contado en el before-hook; aquí solo se registra (el bloqueo, 429, ya se registró allá).
    if (returned.statusCode !== 429) logAuthFailed(email, ip);
    return;
  }

  // Login exitoso: libera el cupo de ESTA conexión para que no arrastre intentos previos.
  await ctx.context.adapter.deleteMany({
    model: MODEL,
    where: [{ field: "key", value: keyFor(email, ip) }],
  });
});
