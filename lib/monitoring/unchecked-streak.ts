// Cuántas revisiones SEGUIDAS lleva cada vigilante sin poder revisar algo en Zernio
// (regla en ./alert-rules.ts → uncheckedAlert). Llave propia por vigilante y revisión:
// worker y web no se suman entre sí. Vence sola a las 2 h (un vigilante que dejó de
// correr no arrastra una falla vieja).
import { redis } from "@/lib/redis";
import type { MonitorSource } from "./account-health";

export type UncheckedCheck = "cuentas" | "webhook";

export const uncheckedStreakKey = (source: MonitorSource, check: UncheckedCheck) => `monitor:sin-revisar:${source}:${check}`;
const STREAK_TTL_SECONDS = 2 * 60 * 60;

/** Registra el resultado de esta revisión y devuelve la racha de fallas (0 si revisó bien). */
export async function recordUncheckedStreak(source: MonitorSource, check: UncheckedCheck, failed: boolean): Promise<number> {
  const key = uncheckedStreakKey(source, check);
  if (!failed) {
    await redis.del(key);
    return 0;
  }
  const streak = await redis.incr(key);
  await redis.expire(key, STREAK_TTL_SECONDS);
  return streak;
}
