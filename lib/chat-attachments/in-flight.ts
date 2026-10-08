// Tope de subidas SIMULTÁNEAS por usuario (28-sep-2026, revisión de seguridad):
// cada subida retiene ~10 MB en el web mientras va al bucket; sin tope, una
// sesión podría abrir cientos a la vez. Contador en Redis con vencimiento; si
// Redis no responde, se deja pasar (igual que el límite por IP de lib/rate-limit):
// un corte de Redis no debe impedir que el vendedor adjunte.
import { redis } from "@/lib/redis";
import { logError } from "@/lib/log/safe-error";

/** Una vista previa sube hasta 10 archivos a la vez; margen para un segundo chat abierto. */
export const UPLOADS_IN_FLIGHT_MAX = 12;
const KEY_TTL_SECONDS = 20 * 60;
const REDIS_TIMEOUT_MS = 500;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis no respondió")), REDIS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type UploadSlot = { ok: true; release: () => Promise<void> } | { ok: false };

export async function acquireUploadSlot(userId: string): Promise<UploadSlot> {
  const key = `adjuntos:en-curso:${userId}`;
  try {
    const n = await withTimeout(redis.incr(key));
    await withTimeout(redis.expire(key, KEY_TTL_SECONDS));
    if (n > UPLOADS_IN_FLIGHT_MAX) {
      await withTimeout(redis.decr(key)).catch(() => undefined);
      return { ok: false };
    }
    return { ok: true, release: () => withTimeout(redis.decr(key)).then(() => undefined, () => undefined) };
  } catch (error) {
    logError("[adjuntos] sin tope de subidas simultáneas (Redis no respondió); se deja pasar", error);
    return { ok: true, release: async () => undefined };
  }
}
