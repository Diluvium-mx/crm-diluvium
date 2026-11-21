// Cuántos mensajes de servicio GRATIS le quedan este mes a un número de WhatsApp (20-nov-2026, barra del chat;
// lib/inbox/window-bar.ts). Meta no cobra los primeros 1,000 mensajes de servicio del mes por número
// (docs/seguimientos.md §3, desde el 1-oct-2026); después cobra cada uno. Sale de lo que reporta Meta cada hora
// (meta_whatsapp_pricing, días UTC como la factura; docs/meta-whatsapp.md): gratis usados = los free_customer_service
// del mes. Si Meta ya cobró algún mensaje de servicio este mes, no queda ninguno.
// Sin lectura reciente de Meta → null (no se sabe): la barra dice «Con costo», lo seguro.
import { and, eq, gte, lte } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { metaWhatsappPricing, metaWhatsappPricingSync } from "@/lib/db/schema";
import { SERVICIO_GRATIS_MES } from "./ahorro-celular";

// Una lectura de Meta más vieja que esto ya no sirve para decir «gratis» (el worker lee cada hora).
export const GRATIS_MES_LECTURA_MAX_MS = 6 * 3_600_000;

type Database = Pick<typeof appDb, "select">;

type Renglon = { category: string; pricingType: string; volume: number };

/** Primer y último día UTC del mes de `now` (AAAA-MM-DD). */
export function mesUtc(now: Date): { desde: string; hasta: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: dia(new Date(Date.UTC(y, m, 1))), hasta: dia(new Date(Date.UTC(y, m + 1, 0))) };
}

// PURO: los gratis que quedan con los renglones del mes y la última lectura buena de Meta.
export function gratisQueQuedan(renglones: Renglon[], leidoAt: Date | null, now: Date): number | null {
  if (!leidoAt || now.getTime() - leidoAt.getTime() > GRATIS_MES_LECTURA_MAX_MS) return null;
  if (renglones.some((r) => r.pricingType === "regular" && r.category === "service" && r.volume > 0)) return 0;
  const usados = renglones.filter((r) => r.pricingType === "free_customer_service").reduce((s, r) => s + r.volume, 0);
  return Math.max(0, SERVICIO_GRATIS_MES - usados);
}

/** Gratis que quedan y hasta cuándo vale el dato: 6 h después de la lectura de Meta o el fin del mes UTC, lo que pase
 *  antes. La barra lo deja de creer después (un chat abierto horas no debe seguir diciendo «Gratis»). */
export type ServicioGratis = { quedan: number; hasta: Date };

// PURO: hasta cuándo vale una lectura de Meta hecha en `leidoAt`.
export function vigenciaGratis(leidoAt: Date): Date {
  const finMes = Date.UTC(leidoAt.getUTCFullYear(), leidoAt.getUTCMonth() + 1, 1);
  return new Date(Math.min(leidoAt.getTime() + GRATIS_MES_LECTURA_MAX_MS, finMes));
}

export async function servicioGratisQuedan(database: Database, organizationId: string, channelId: string, now: Date): Promise<ServicioGratis | null> {
  const { desde, hasta } = mesUtc(now);
  const [renglones, [sync]] = await Promise.all([
    database
      .select({ category: metaWhatsappPricing.category, pricingType: metaWhatsappPricing.pricingType, volume: metaWhatsappPricing.volume })
      .from(metaWhatsappPricing)
      .where(
        and(
          eq(metaWhatsappPricing.organizationId, organizationId),
          eq(metaWhatsappPricing.channelId, channelId),
          gte(metaWhatsappPricing.day, desde),
          lte(metaWhatsappPricing.day, hasta),
        ),
      ),
    database
      .select({ fetchedAt: metaWhatsappPricingSync.fetchedAt })
      .from(metaWhatsappPricingSync)
      .where(eq(metaWhatsappPricingSync.organizationId, organizationId)),
  ]);
  const leidoAt = sync?.fetchedAt ?? null;
  const quedan = gratisQueQuedan(renglones, leidoAt, now);
  return quedan === null || !leidoAt ? null : { quedan, hasta: vigenciaGratis(leidoAt) };
}
