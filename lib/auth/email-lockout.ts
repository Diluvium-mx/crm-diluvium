// Límite de intentos fallidos por email en /sign-in/email — capa PRINCIPAL
// contra fuerza bruta dirigida a una cuenta. El límite de IP de Better Auth
// (node_modules/better-auth/dist/api/rate-limiter/index.mjs) corre antes,
// a nivel de router, y solo cuenta por IP+path sin forma de agregar el email
// a la clave (ver el customRules de lib/auth/index.ts para la capa de IP,
// suavizada ahí para que esta capa sea la que se dispare primero).
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
// before: solo LEE el conteo y bloquea si ya se pasó — nunca incrementa,
// porque en este punto todavía no se sabe si el intento va a fallar.
// after: sabe si falló viendo ctx.context.returned instanceof APIError
// (dispatchAuthEndpoint asigna el APIError ahí incluso cuando el handler
// lo lanzó — node_modules/better-auth/dist/api/dispatch.mjs:236-241) y
// SOLO ahí incrementa, replicando el incrementOne atómico que usa el
// storage de base de datos del propio Better Auth
// (node_modules/better-auth/dist/api/rate-limiter/index.mjs:76-165).
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "@better-auth/core";

const SIGN_IN_EMAIL_PATH = "/sign-in/email";
const MODEL = "rateLimit";

// 5 intentos fallidos por email en 5 minutos, después bloqueado hasta que
// pasen 5 minutos desde el último fallo. Debe ser MENOR que el customRule
// de IP en lib/auth/index.ts (30/300s) para que esta capa se dispare primero
// en un ataque a una sola cuenta.
const WINDOW_SECONDS = 300;
const MAX_FAILURES = 5;

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

async function consumeFailure(
  adapter: DBAdapter<BetterAuthOptions>,
  key: string,
): Promise<void> {
  const windowMs = WINDOW_SECONDS * 1000;
  const now = Date.now();
  const data = await readRow(adapter, key);

  if (!data) {
    try {
      await adapter.create<RateLimitRow>({
        model: MODEL,
        data: { key, count: 1, lastRequest: now },
      });
    } catch {
      // Otro request concurrente ya creó la fila primero — reintenta como incremento.
      await consumeFailure(adapter, key);
    }
    return;
  }

  if (now - data.lastRequest >= windowMs) {
    // Ventana expirada: reinicia el conteo en vez de acumular sobre un fallo viejo.
    await adapter.incrementOne<RateLimitRow>({
      model: MODEL,
      where: [
        { field: "key", value: key },
        { field: "lastRequest", operator: "lte", value: data.lastRequest },
      ],
      increment: {},
      set: { count: 1, lastRequest: now },
    });
    return;
  }

  // Incremento atómico condicionado a seguir bajo el máximo — si ya está en
  // MAX_FAILURES, el WHERE no matchea y el conteo se queda congelado ahí
  // hasta que expire la ventana, igual que el storage de base de datos
  // nativo de Better Auth.
  await adapter.incrementOne<RateLimitRow>({
    model: MODEL,
    where: [
      { field: "key", value: key },
      { field: "lastRequest", operator: "gt", value: now - windowMs },
      { field: "count", operator: "lt", value: MAX_FAILURES },
    ],
    increment: { count: 1 },
    set: { lastRequest: now },
  });
}

export const emailLockoutBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;

  const adapter = ctx.context.adapter;
  const key = keyFor(email);
  const data = await readRow(adapter, key);
  if (!data) return;

  const windowMs = WINDOW_SECONDS * 1000;
  const now = Date.now();
  if (now - data.lastRequest >= windowMs) return;
  if (data.count < MAX_FAILURES) return;

  const retryAfter = Math.ceil((data.lastRequest + windowMs - now) / 1000);
  throw new APIError(
    "TOO_MANY_REQUESTS",
    { message: "Demasiados intentos fallidos para este correo. Intenta de nuevo más tarde." },
    { "X-Retry-After": String(retryAfter) },
  );
});

export const emailLockoutAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
  const email = readEmail(ctx.body);
  if (!email) return;

  const adapter = ctx.context.adapter;
  const key = keyFor(email);
  const failed = ctx.context.returned instanceof APIError;

  if (!failed) {
    // Login exitoso: no arrastrar fallos previos contra el próximo intento.
    await adapter.deleteMany({ model: MODEL, where: [{ field: "key", value: key }] });
    return;
  }

  await consumeFailure(adapter, key);
});
