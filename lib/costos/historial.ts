// Historial de costos (21-nov-2026, pedido del dueño): Dashboard › Historial de costos enseña el correo del día 3
// (lib/costos/correo.ts) tal como llega, para el mes en curso EN VIVO y para cada mes cerrado guardado en
// crm_cost_months. Aquí van las reglas PURAS de qué renglones lleva cada mes; la carga está en historial-cargar.ts.
// - Mes cerrado: Railway, Zernio y Meta salen de lo guardado (ya no se pueden volver a leer); la IA va por proveedor
//   con lo que cobró cada uno (y los modelos de reserva con lo que se compró) si suma lo mismo que lo guardado, y si
//   no, un solo renglón con lo guardado.
// - Mes en curso: lo que VA de cada servicio, con lo que ya calcularon las tarjetas del Dashboard (igual que el «va»
//   del Costo del CRM). La nota de Railway y Zernio dice su factura estimada.
import type { AiSpendSummary } from "@/lib/dashboard/ai-spend";
import type { MesGuardado } from "@/lib/dashboard/costo-crm";
import type { MetaWhatsappSummary } from "@/lib/dashboard/meta-whatsapp";
import type { RailwaySummary } from "@/lib/dashboard/railway";
import type { ZernioSummary } from "@/lib/dashboard/zernio";
import { formatUsd } from "@/lib/usd-format";
import { type CompraIa, IA_FIJOS, IA_PARA_QUE, IA_RESERVA, type Mes, type Renglon, renglonReserva } from "./mes";

export type RenglonesMes = { ia: Renglon[]; railway: Renglon; zernio: Renglon; meta: Renglon };

const round2 = (n: number) => Math.round(n * 100) / 100;

const BASE = {
  railway: { servicio: "Railway", paraQue: "Servidores del CRM" },
  zernio: { servicio: "Zernio", paraQue: "Conecta WhatsApp e Instagram" },
  meta: { servicio: "Meta (WhatsApp)", paraQue: "Plantillas y mensajes cobrados" },
};

function guardado(base: { servicio: string; paraQue: string }, usd: number | null, notaConCobro: string | null): Renglon {
  if (usd === null) return { ...base, usd: null, nota: "sin dato de ese mes" };
  if (round2(usd) === 0) return { ...base, usd: 0, nota: "sin cobro ese mes" };
  return { ...base, usd: round2(usd), nota: notaConCobro };
}

// PURO: renglones de un mes cerrado. `iaPorProveedor` = renglonesIa() de ese mes (lo que cobró cada proveedor).
export function renglonesMesCerrado(fila: MesGuardado, iaPorProveedor: readonly Renglon[]): RenglonesMes {
  const sumaIa = round2(iaPorProveedor.reduce((s, r) => s + (r.usd ?? 0), 0));
  const iaGuardada = fila.iaUsd === null ? null : round2(fila.iaUsd);
  const ia =
    iaGuardada === null || Math.abs(sumaIa - iaGuardada) <= 0.01
      ? [...iaPorProveedor]
      : [{ servicio: "IA", paraQue: "Agente IA y audios", usd: iaGuardada, nota: "total guardado del mes" }];
  return {
    ia,
    railway: guardado(BASE.railway, fila.railwayUsd, "el periodo de cobro que empezó en el mes"),
    zernio: guardado(BASE.zernio, fila.zernioUsd, null),
    meta: guardado(BASE.meta, fila.metaUsd, "lo que cobró Meta, sin IVA"),
  };
}

// PURO: renglones del mes en curso con lo que VA de cada servicio (null = sin esa tarjeta: no hay lectura).
// Los modelos de reserva van en un solo renglón con lo que se compró de crédito este mes, solo si se compró
// (lib/costos/mes.ts).
export function renglonesMesEnCurso(input: {
  spend: AiSpendSummary | null;
  railway: RailwaySummary | null;
  zernio: ZernioSummary | null;
  meta: MetaWhatsappSummary | null;
  compras: readonly CompraIa[];
  mes: Mes;
}): RenglonesMes {
  const providers = input.spend?.providers ?? [];
  const ia: Renglon[] = providers
    .filter((p) => !IA_RESERVA.includes(p.provider) && (IA_FIJOS.includes(p.provider) || Math.round(p.monthUsd * 100) !== 0))
    .map((p) => ({ servicio: `IA · ${p.label}`, paraQue: IA_PARA_QUE[p.provider] ?? "Agente IA", usd: round2(p.monthUsd), nota: null }));
  const reserva = renglonReserva(input.compras, input.mes);
  if (reserva) ia.push(reserva);

  const r = input.railway;
  let railway: Renglon = { ...BASE.railway, usd: null, nota: "sin lectura de Railway" };
  if (r && r.usageUsd !== null) {
    const periodo = r.periodStartLabel && r.periodEndLabel ? `periodo ${r.periodStartLabel} → ${r.periodEndLabel}; ` : "";
    const estimado = r.estimatedBillUsd === null ? "" : ` (estimado al corte ≈ ${formatUsd(r.estimatedBillUsd)})`;
    railway = { ...BASE.railway, usd: round2(Math.max(r.includedUsd ?? 0, r.usageUsd)), nota: `${periodo}va${estimado}` };
  }

  const z = input.zernio;
  const zernio: Renglon =
    z && z.totalUsd !== null
      ? { ...BASE.zernio, usd: round2(z.totalUsd), nota: z.estimatedBillUsd === null ? "va" : `va (estimado del mes ≈ ${formatUsd(z.estimatedBillUsd)})` }
      : { ...BASE.zernio, usd: null, nota: "sin lectura de Zernio" };

  const m = input.meta;
  const meta: Renglon =
    m && m.totalUsd !== null
      ? { ...BASE.meta, usd: round2(m.totalUsd), nota: "va; lo que reporta Meta hasta hoy, sin IVA" }
      : { ...BASE.meta, usd: null, nota: "sin lectura de Meta" };

  return { ia, railway, zernio, meta };
}
