// Registro y conteo de inicios de sesión fallidos y bloqueos (S3, revisión de
// seguridad CN-007, 30-sep-2026). Un login fallido o un bloqueo deja una línea
// JSON en los logs de Railway con la IP y el correo CODIFICADO (sha256 cortado;
// nunca la contraseña ni el correo en claro). Cada bloqueo NUEVO se anota en
// Redis para que /api/health/inbound avise (issue del monitor) con 3 o más en
// una hora (decisión del dueño). Nada de esto puede frenar un inicio de sesión:
// Redis se carga al usarse y sus fallas solo se registran.
import { createHash, randomUUID } from "node:crypto";
import { safeErrorMessage } from "@/lib/log/safe-error";

/** Bloqueos en una hora a partir de los cuales el monitor abre el issue. */
export const AUTH_LOCKOUT_ALERT = 3;
const LOCKOUTS_KEY = "auth:bloqueos";
const HOUR_MS = 60 * 60 * 1000;
const REDIS_TIMEOUT_MS = 2_000;

export type LockoutScope = "correo+ip" | "correo";

/** Correo codificado para los logs: el mismo correo da siempre el mismo código. */
export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis no respondió")), REDIS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function logAuthFailed(email: string, ip: string | null): void {
  console.warn(JSON.stringify({ event: "auth_failed", emailHash: emailHash(email), ip }));
}

/**
 * Un intento rechazado por bloqueo. Solo el PRIMER rechazo de cada bloqueo cuenta
 * (los demás intentos mientras dura no se vuelven a contar ni a registrar).
 * No se espera: el inicio de sesión responde de inmediato.
 */
export function recordLockout(email: string, ip: string | null, scope: LockoutScope, seconds: number): void {
  const line = JSON.stringify({ event: "auth_locked", scope, emailHash: emailHash(email), ip, seconds });
  void (async () => {
    const { redis } = await import("@/lib/redis");
    const marker = `auth:bloqueo:${scope}:${emailHash(email)}:${scope === "correo" ? "" : (ip ?? "sin-ip")}`;
    const isNew = await withTimeout(redis.set(marker, "1", "EX", Math.max(1, seconds), "NX"));
    if (isNew !== "OK") return;
    const now = Date.now();
    await withTimeout(redis.zadd(LOCKOUTS_KEY, now, `${now}:${randomUUID()}`));
    await withTimeout(redis.zremrangebyscore(LOCKOUTS_KEY, 0, now - HOUR_MS));
    console.warn(line);
  })().catch((error: unknown) => {
    // Sin Redis no hay conteo para la alerta, pero el bloqueo sí queda en el log.
    console.warn(line, "(sin conteo:", safeErrorMessage(error), ")");
  });
}

/** Bloqueos nuevos de la última hora (para el monitor). */
export async function lockoutsLastHour(now = Date.now()): Promise<number> {
  const { redis } = await import("@/lib/redis");
  return withTimeout(redis.zcount(LOCKOUTS_KEY, now - HOUR_MS, "+inf"));
}
