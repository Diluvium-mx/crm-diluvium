// Estado Activa/Pausada de un anuncio para la tabla de Anuncios (puro, sin
// base). Lo lee de Meta el worker cada hora (./meta-status.ts); aquí solo se
// decide qué mostrar con lo guardado.

export type AdStatus = "active" | "paused" | "unknown";

/** Cada cuánto se vuelve a preguntar (el trabajo del worker corre cada hora). */
export const STATUS_REFRESH_MS = 3_600_000;
/** Pasado este tiempo sin una lectura buena (Meta falló), el estado ya no se muestra. */
export const STATUS_STALE_MS = 90 * 60_000;

/**
 * ACTIVE = "Activa" (el anuncio está corriendo). Cualquier otro estado que Meta
 * reporte (PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, ARCHIVED, DELETED, en revisión,
 * rechazado…) = "Pausada": no está corriendo. Sin lectura, o lectura vieja → "unknown" ("—").
 */
export function adStatusOf(
  meta: { effectiveStatus: string | null; statusCheckedAt: Date | null } | null | undefined,
  now: Date = new Date(),
): AdStatus {
  if (!meta?.effectiveStatus || !meta.statusCheckedAt) return "unknown";
  if (now.getTime() - meta.statusCheckedAt.getTime() > STATUS_STALE_MS) return "unknown";
  return meta.effectiveStatus === "ACTIVE" ? "active" : "paused";
}
