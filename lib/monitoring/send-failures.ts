// Alarma de envíos que fallan en serie (P4, 22-oct-2026). El 21-oct, de 15:45 a 09:10 del día
// siguiente, 58 archivos no le llegaron a 53 clientes (131053: Railway cambió las llaves del
// bucket) y nada avisó: se notó por las tarjetas amarillas. Ahora, 3 o más envíos con el MISMO
// error en la última hora son alarma: franja roja en la Bandeja (todos la ven) y problema del
// vigilante (/api/health/inbound → issue `alerta-whatsapp` por correo, y el log del worker).
// Medido en prod (30 días al 22-oct, sin el incidente): ningún código pasó de 3 en una hora, y
// solo los esperados (abajo) llegaron a 3.
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { plainSendReason } from "@/lib/messaging/send-reasons";

export const SEND_FAILURE_ALERT = 3;
export const SEND_FAILURE_WINDOW_MS = 60 * 60_000;
// Fallas normales del día a día, no de un proveedor: 131049 (Meta limita marketing a ese cliente),
// 130472 (el número está en un experimento de Meta), 131050 (se dio de baja de promociones).
export const EXPECTED_FAILURE_CODES: ReadonlySet<string> = new Set(["131049", "130472", "131050"]);

export type SendFailureGroup = { code: string; count: number; sample: string | null };

/** Grupos que ya son alarma (puro): mismo código, SEND_FAILURE_ALERT o más, sin los esperados. */
export function alarmingGroups(groups: readonly SendFailureGroup[], threshold = SEND_FAILURE_ALERT): SendFailureGroup[] {
  return groups.filter((g) => g.count >= threshold && !EXPECTED_FAILURE_CODES.has(g.code)).sort((a, b) => b.count - a.count);
}

/** Problema del vigilante (puro). El issue es PÚBLICO: solo conteo y código, nunca el texto del error. */
export function sendFailureProblems(groups: readonly SendFailureGroup[]): string[] {
  return alarmingGroups(groups).map((g) => `${g.count} envíos fallaron con el mismo error (código ${g.code}) en la última hora`);
}

/** Línea de la franja de la Bandeja (puro): con el motivo en palabras simples. */
export function sendFailureBannerLines(groups: readonly SendFailureGroup[]): string[] {
  return alarmingGroups(groups).map(
    (g) => `${g.count} envíos no le llegaron a los clientes en la última hora por el mismo motivo: ${plainSendReason(g.code, g.sample)}. Revisa los chats con tarjeta.`,
  );
}

/** Salientes fallidos de la última hora, por código (de una organización, o de todas para el vigilante). */
export async function recentSendFailures(opts: { now?: Date; organizationId?: string } = {}): Promise<SendFailureGroup[]> {
  const now = opts.now ?? new Date();
  const code = sql<string>`coalesce(${messages.errorCode}, 'sin_codigo')`;
  const rows = await db
    .select({ code, count: sql<number>`count(*)::int`, sample: sql<string | null>`max(${messages.errorMessage})` })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "out"),
        eq(messages.status, "failed"),
        gt(messages.createdAt, new Date(now.getTime() - SEND_FAILURE_WINDOW_MS)),
        ...(opts.organizationId ? [eq(messages.organizationId, opts.organizationId)] : []),
      ),
    )
    .groupBy(code);
  return rows;
}
