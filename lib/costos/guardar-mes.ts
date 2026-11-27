// Guarda el costo del CRM del mes que acaba de cerrar en crm_cost_months (20-nov-2026, docs/costos.md › Dashboard),
// para que el Dashboard pueda dar el total desde que arrancó el CRM: Railway y Zernio solo guardan su periodo actual
// (y Zernio el anterior). Lo corre el worker cada hora. Mismas reglas que el correo del día 3 (lib/costos/mes.ts):
// IA = lo que cobró cada proveedor (los modelos de reserva, lo que se compró de crédito en el mes); Railway = el periodo que EMPIEZA en ese mes; Zernio = su mes anterior ya cerrado;
// Meta = lo que reportó del mes. Durante los primeros días del mes siguiente se vuelve a guardar (Railway cierra el 5
// y los proveedores tardan en reportar); después queda fijo. Un dato que ya no se puede leer (null) no borra el que
// se guardó antes. Los meses cargados a mano (`source = 'manual'`) no se tocan.
import { and, eq, sql } from "drizzle-orm";
import { db as appDb } from "@/lib/db";
import { crmCostMonths, organization, railwayBilling, zernioBilling } from "@/lib/db/schema";
import { loadBillingSnapshots, spendByDay } from "@/lib/dashboard/ai-spend";
import { cargarMetaReportado } from "./cargar";
import { cargarComprasReserva } from "./compras-reserva";
import { type CostoMes, combinar, debeGuardar } from "./cierre-mes";
import { type Mes, mesAnterior, renglonRailway, renglonZernio, renglonesIa } from "./mes";

type Database = Pick<typeof appDb, "select" | "execute" | "insert">;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Lo que costó un mes según lo que ya guardó el worker de cada proveedor (no llama a ninguno).
export async function costoDelMes(database: Database, organizationId: string, mes: Mes, now: Date): Promise<CostoMes> {
  const [billing, crmDays, [railway], [zernio], meta, compras] = await Promise.all([
    loadBillingSnapshots(database, organizationId),
    spendByDay(database, organizationId, mes.desde),
    database.select().from(railwayBilling).where(eq(railwayBilling.organizationId, organizationId)),
    database.select().from(zernioBilling).where(eq(zernioBilling.organizationId, organizationId)),
    cargarMetaReportado(database, organizationId, mes),
    cargarComprasReserva(database, organizationId),
  ]);
  const ia = renglonesIa({ billing, crmDays, mes, compras }).renglones.reduce((sum, r) => sum + (r.usd ?? 0), 0);
  return {
    iaUsd: round2(ia),
    metaUsd: meta ? round2(meta.usd) : null,
    railwayUsd: renglonRailway(railway ?? null, mes, now).renglon.usd,
    zernioUsd: renglonZernio(zernio ?? null, mes).renglon.usd,
  };
}

// El worker (cada hora): guarda el mes anterior de cada organización. Devuelve cuántas filas guardó.
export async function guardarMesCerrado(options: { now?: Date; database?: Database } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const database = options.database ?? appDb;
  const mes = mesAnterior(now);
  const orgs = await database.select({ id: organization.id }).from(organization);
  let guardadas = 0;
  for (const org of orgs) {
    const [fila] = await database
      .select()
      .from(crmCostMonths)
      .where(and(eq(crmCostMonths.organizationId, org.id), eq(crmCostMonths.month, mes.clave)));
    if (!debeGuardar(fila ?? null, now)) continue;
    const valores = combinar(fila ?? null, await costoDelMes(database, org.id, mes, now));
    if (!fila && Object.values(valores).every((v) => v === null)) continue;
    await database
      .insert(crmCostMonths)
      .values({ organizationId: org.id, month: mes.clave, ...valores, source: "auto", updatedAt: now })
      .onConflictDoUpdate({
        target: [crmCostMonths.organizationId, crmCostMonths.month],
        set: { ...valores, updatedAt: now },
        // Si alguien lo cargó a mano mientras tanto, se respeta.
        setWhere: sql`${crmCostMonths.source} = 'auto'`,
      });
    guardadas += 1;
  }
  return guardadas;
}
