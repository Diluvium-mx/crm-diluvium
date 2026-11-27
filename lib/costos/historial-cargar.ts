// Carga de Dashboard › Historial de costos (21-nov-2026): arma el correo del día 3 (lib/costos/correo.ts) del mes que se
// elija con las reglas de lib/costos/historial.ts. Solo lee la base (lo que ya guardó el worker de cada proveedor) y el
// dólar del Diario Oficial (lib/costos/tipo-cambio.ts, el mismo del correo), que se guarda en memoria unas horas para
// no preguntarle en cada visita. No llama a ningún proveedor.
import { desc, eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { crmCostMonths, organization } from "@/lib/db/schema";
import { aiSpendSummary, loadBillingSnapshots, spendByDay } from "@/lib/dashboard/ai-spend";
import { cargarCostoCrm, resumirCostoCrm, type MesGuardado } from "@/lib/dashboard/costo-crm";
import { metaWhatsappSummary } from "@/lib/dashboard/meta-whatsapp";
import { railwaySummary } from "@/lib/dashboard/railway";
import { zernioSummary } from "@/lib/dashboard/zernio";
import { utcDay } from "@/lib/ai/billing/days";
import { cargarAhorroCelular } from "@/lib/meta-whatsapp/ahorro-celular";
import { cargarComprasReserva } from "./compras-reserva";
import { htmlCorreo } from "./correo";
import { renglonesMesCerrado, renglonesMesEnCurso, type RenglonesMes } from "./historial";
import { type ReporteCostos, armarReporte, mesDe, renglonesIa } from "./mes";
import { leerTipoCambio, type TipoCambio } from "./tipo-cambio";

type Database = Pick<typeof appDb, "select" | "execute">;

export type MesHistorial = { clave: string; nombre: string; enCurso: boolean };

export type HistorialCostos = {
  meses: MesHistorial[];
  // El mes que se ve (null = el que se pidió no existe; se ve el en curso).
  mes: MesHistorial;
  reporte: ReporteCostos;
  html: string;
  // Solo en el mes en curso: el cierre estimado del Costo del CRM (null el primer día del mes).
  cierreUsd: number | null;
};

// El dólar del mes, guardado en memoria: el en curso 6 h (cambia cada día hábil), uno cerrado 7 días.
const tipoCambioCache = new Map<string, { valor: TipoCambio | null; hasta: number }>();
async function tipoCambioDe(clave: string, enCurso: boolean, now: Date): Promise<TipoCambio | null> {
  const hit = tipoCambioCache.get(clave);
  if (hit && hit.hasta > now.getTime()) return hit.valor;
  const valor = await leerTipoCambio(mesDe(clave)).catch(() => null);
  // Si el Diario Oficial no respondió, se vuelve a intentar en 15 min.
  const ttl = valor === null ? 15 * 60_000 : enCurso ? 6 * 3_600_000 : 7 * 86_400_000;
  tipoCambioCache.set(clave, { valor, hasta: now.getTime() + ttl });
  return valor;
}

const nombreMes = (clave: string) => mesDe(clave).nombre.replace(/^./, (c) => c.toUpperCase());

export async function cargarHistorialCostos(
  database: Database,
  organizationId: string,
  pedido: string | undefined,
  options: { now?: Date } = {},
): Promise<HistorialCostos> {
  const now = options.now ?? new Date();
  const [fila0] = await database.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId));
  const org = { id: organizationId, name: fila0?.name ?? "" };
  const enCursoClave = utcDay(now).slice(0, 7);
  const guardados: MesGuardado[] = await database
    .select({
      month: crmCostMonths.month,
      iaUsd: crmCostMonths.iaUsd,
      metaUsd: crmCostMonths.metaUsd,
      railwayUsd: crmCostMonths.railwayUsd,
      zernioUsd: crmCostMonths.zernioUsd,
    })
    .from(crmCostMonths)
    .where(eq(crmCostMonths.organizationId, org.id))
    .orderBy(desc(crmCostMonths.month));
  const cerrados = guardados.filter((g) => g.month < enCursoClave);
  const meses: MesHistorial[] = [
    { clave: enCursoClave, nombre: nombreMes(enCursoClave), enCurso: true },
    ...cerrados.map((g) => ({ clave: g.month, nombre: nombreMes(g.month), enCurso: false })),
  ];
  const mes = meses.find((m) => m.clave === pedido) ?? meses[0];
  const m = mesDe(mes.clave);

  let renglones: RenglonesMes;
  let cierreUsd: number | null = null;
  const compras = await cargarComprasReserva(database, org.id);
  if (mes.enCurso) {
    const [spend, railway, zernio, meta, base] = await Promise.all([
      aiSpendSummary(database, org.id, { now }),
      railwaySummary(database, org.id),
      zernioSummary(database, org.id),
      metaWhatsappSummary(database, org.id, { now }),
      cargarCostoCrm(database, org.id, { now }),
    ]);
    renglones = renglonesMesEnCurso({ spend, railway, zernio, meta, compras, mes: m });
    cierreUsd = resumirCostoCrm({ now, spend, iaProyeccionUsd: base.iaProyeccionUsd, meta, railway, zernio, guardados: base.guardados, compras }).cierreUsd;
  } else {
    const fila = cerrados.find((g) => g.month === mes.clave);
    if (!fila) throw new Error(`Sin costo guardado de ${mes.clave}`);
    const [billing, crmDays] = await Promise.all([loadBillingSnapshots(database, org.id), spendByDay(database, org.id, m.desde)]);
    renglones = renglonesMesCerrado(fila, renglonesIa({ billing, crmDays, mes: m, compras }).renglones);
  }

  const [celular, tipoCambio] = await Promise.all([
    cargarAhorroCelular(database, org.id, m.desde, m.hasta).catch(() => null),
    tipoCambioDe(mes.clave, mes.enCurso, now),
  ]);
  const reporte = armarReporte({
    mes: m,
    organizacion: org.name,
    ia: { renglones: renglones.ia, avisos: [] },
    railway: { renglon: renglones.railway, avisos: [] },
    zernio: { renglon: renglones.zernio, avisos: [] },
    meta: renglones.meta,
    tipoCambio,
    celular: celular ? { mensajes: celular.total.mensajes, ahorroUsd: celular.total.ahorroUsd, cobradosMeta: celular.total.cobradosMeta } : null,
    enCurso: mes.enCurso,
  });
  return { meses, mes, reporte, html: htmlCorreo(reporte), cierreUsd };
}
