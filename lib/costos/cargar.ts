// Carga de la base lo que necesita el reporte mensual de costos de UNA organización (docs/costos.md) y lo arma
// con lib/costos/mes.ts. Solo lee: en GitHub corre con el usuario de solo lectura de los respaldos. Las
// lecturas de cobro (IA, Railway, Zernio) las deja el worker cada 5–15 min; aquí no se llama a ningún proveedor.
import { eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { railwayBilling, zernioBilling } from "@/lib/db/schema";
import { loadBillingSnapshots, spendByDay } from "@/lib/dashboard/ai-spend";
import { contarMetaCobrables } from "./meta-estimado";
import { type Mes, type ReporteCostos, armarReporte, renglonMeta, renglonRailway, renglonZernio, renglonesIa } from "./mes";
import type { TipoCambio } from "./tipo-cambio";

type Database = Pick<typeof appDb, "select" | "execute">;

// Ventas del mes, como en el informe del primer mes (27-oct-2026): contactos que HOY están en la etapa de venta
// (papel `venta_cerrada`) y entraron a ella en el mes, hora de Mazatlán. El que entró y regresó a otra etapa no
// cuenta, ni los contactos de prueba. No depende del Historial de etapas (existe solo desde el 9-oct-2026).
export async function contarVentas(database: Database, organizationId: string, mes: Mes): Promise<number> {
  const [row] = await database.execute<{ ventas: string }>(sql`
    select count(*)::text as ventas
    from contacts c
    join funnel_stages f on f.organization_id = c.organization_id and f.key = c.stage and f.role = 'venta_cerrada'
    where c.organization_id = ${organizationId} and not c.es_prueba
      and c.stage_changed_at >= (${mes.desde}::timestamp at time zone 'America/Mazatlan') at time zone 'UTC'
      and c.stage_changed_at < ((${mes.hasta}::date + 1)::timestamp at time zone 'America/Mazatlan') at time zone 'UTC'
  `);
  return Number(row?.ventas ?? 0);
}

export async function cargarReporte(
  database: Database,
  org: { id: string; name: string },
  mes: Mes,
  now: Date,
  tipoCambio: TipoCambio | null,
): Promise<ReporteCostos> {
  const [billing, crmDays, [railway], [zernio], meta, ventas] = await Promise.all([
    loadBillingSnapshots(database, org.id),
    spendByDay(database, org.id, mes.desde),
    database.select().from(railwayBilling).where(eq(railwayBilling.organizationId, org.id)),
    database.select().from(zernioBilling).where(eq(zernioBilling.organizationId, org.id)),
    contarMetaCobrables(database, org.id, mes.desde, mes.hasta),
    contarVentas(database, org.id, mes),
  ]);
  return armarReporte({
    mes,
    organizacion: org.name,
    ia: renglonesIa({ billing, crmDays, mes }),
    railway: renglonRailway(railway ?? null, mes, now),
    zernio: renglonZernio(zernio ?? null, mes),
    meta: renglonMeta(meta),
    ventas,
    tipoCambio,
  });
}
