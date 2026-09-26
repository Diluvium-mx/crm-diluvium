// Estado Activa/Pausada de cada anuncio, leído de Meta cada hora con el mismo
// token de solo lectura (ads_read). La tabla de Anuncios solo lee la base: si
// Meta falla, nada se frena; el estado envejece y la tabla muestra "—" (la
// regla vive en ./ad-status.ts).
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaAds } from "@/lib/db/schema";
import { STATUS_REFRESH_MS } from "./ad-status";
import { fetchAdStatuses, metaApiConfigFromEnv, type MetaApiConfig } from "./meta-api";

// Tope por corrida: una PyME tiene decenas de anuncios con clientes.
const REFRESH_LIMIT = 1_000;

export type StatusRefreshResult =
  | { status: "actualizado"; checked: number; updated: number }
  | { status: "sin_anuncios" }
  | { status: "error"; error: string };

/**
 * Pregunta a Meta el estado de los anuncios ya identificados (con nombres de
 * Meta) cuya última lectura tiene más de ~1 h. Nunca lanza: un error queda en
 * el log y la siguiente corrida (una hora después) lo vuelve a intentar.
 */
export async function refreshAdStatuses({ config, now = new Date() }: { config?: MetaApiConfig; now?: Date } = {}): Promise<StatusRefreshResult> {
  // Margen de 10 min: la corrida de cada hora no se salta un anuncio leído "hace 59 min".
  const due = new Date(now.getTime() - STATUS_REFRESH_MS + 10 * 60_000);
  const rows = await db
    .select({ organizationId: metaAds.organizationId, adId: metaAds.adId })
    .from(metaAds)
    .where(and(isNotNull(metaAds.fetchedAt), or(isNull(metaAds.statusCheckedAt), lt(metaAds.statusCheckedAt, due))))
    .limit(REFRESH_LIMIT);
  if (rows.length === 0) return { status: "sin_anuncios" };

  let statuses: Map<string, string>;
  try {
    statuses = await fetchAdStatuses(
      rows.map((r) => r.adId),
      config ?? metaApiConfigFromEnv(),
    );
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }

  // Un UPDATE por estado distinto (ACTIVE, PAUSED…), por organización.
  const groups = new Map<string, { organizationId: string; status: string; adIds: string[] }>();
  for (const r of rows) {
    const status = statuses.get(r.adId);
    if (!status) continue;
    const key = `${r.organizationId}\u0000${status}`;
    const g = groups.get(key) ?? { organizationId: r.organizationId, status, adIds: [] };
    g.adIds.push(r.adId);
    groups.set(key, g);
  }
  let updated = 0;
  for (const g of groups.values()) {
    await db
      .update(metaAds)
      .set({ effectiveStatus: g.status, statusCheckedAt: now })
      .where(and(eq(metaAds.organizationId, g.organizationId), inArray(metaAds.adId, g.adIds)));
    updated += g.adIds.length;
  }
  return { status: "actualizado", checked: rows.length, updated };
}
