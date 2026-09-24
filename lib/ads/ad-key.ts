// Clave de la página de un anuncio (/anuncios/{clave}). Con id de Meta, el id.
// Una ficha SIN id (incompleta, o respaldo sin source_id) NO se junta con
// otras: se agrupa por su huella (link + titular + texto; mismo anuncio →
// misma huella) y, si no trae nada con qué reconocerla, queda sola (por clic).
// La versión JS y la SQL deben dar EXACTAMENTE lo mismo (md5 en UTF-8).
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

export type AdKeyInput = {
  id: string;
  adId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
};

export function adKeyOf(c: AdKeyInput): string {
  if (c.adId) return c.adId;
  if (c.sourceUrl !== null || c.headline !== null || c.body !== null) {
    const print = `${c.sourceUrl ?? ""}|${c.headline ?? ""}|${c.body ?? ""}`;
    return `f-${createHash("md5").update(print, "utf8").digest("hex").slice(0, 12)}`;
  }
  return `c-${c.id}`;
}

/** Misma clave en SQL, sobre las columnas de ad_clicks (o de un alias `c`). */
export function adKeySql(alias?: string): SQL {
  const col = (name: string) => (alias ? sql.raw(`${alias}.${name}`) : sql.raw(`"ad_clicks"."${name}"`));
  return sql`(case
    when ${col("ad_id")} is not null then ${col("ad_id")}
    when ${col("source_url")} is not null or ${col("headline")} is not null or ${col("body")} is not null
      then 'f-' || left(md5(coalesce(${col("source_url")}, '') || '|' || coalesce(${col("headline")}, '') || '|' || coalesce(${col("body")}, '')), 12)
    else 'c-' || ${col("id")}
  end)`;
}

/** Forma válida de una clave (para no consultar con basura de la URL). */
export function isAdKey(key: string): boolean {
  return /^\d{5,25}$/.test(key) || /^f-[0-9a-f]{12}$/.test(key) || /^c-[0-9a-f-]{36}$/.test(key);
}

export function adHrefOf(c: AdKeyInput): string {
  return `/anuncios/${adKeyOf(c)}`;
}
