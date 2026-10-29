// Reporte mensual de costos del CRM (28-oct-2026, decisión del dueño; docs/costos.md). Lista FIJA de lo que
// se cuenta: IA (lo que COBRÓ cada proveedor), Railway, Zernio y Meta por WhatsApp. Nada más (sin
// suscripciones de Claude/ChatGPT, publicidad, guías ni dominio). Todo PURO: recibe las lecturas ya cargadas
// (lib/costos/cargar.ts) y arma los renglones que salen en el correo (lib/costos/correo.ts).
import { addDays } from "@/lib/ai/billing/days";
import type { BillingSnapshot, DaySpend } from "@/lib/dashboard/ai-spend";
import { providerLabel } from "@/lib/dashboard/ai-spend";
import { monthLabel } from "@/lib/dashboard/ai-spend-history";
import { billingAlertFor as railwayAlertFor, shortDate, summarizeRailway } from "@/lib/dashboard/railway";
import { billingAlertFor as zernioAlertFor } from "@/lib/dashboard/zernio";
import { type MetaConteo, metaCostoUsd } from "./meta-estimado";
import type { TipoCambio } from "./tipo-cambio";

const ZONA = "America/Mazatlan";

// Nota que sale UNA sola vez, en el correo de ese mes (decisión del dueño 28-oct-2026).
const NOTAS_DEL_MES: Record<string, string> = {
  "2026-10":
    "Es el primer mes completo del CRM: todavía no hay un mes anterior con qué compararlo, y salió un poco alto por pruebas y ajustes. Desde noviembre el costo ya debe ser más razonable.",
};

// "2026-10" → del 1 al último día. Los proveedores cobran por día UTC; las ventas y los mensajes de Meta
// se cuentan con el mes en hora de Mazatlán (lib/costos/cargar.ts).
export type Mes = { clave: string; desde: string; hasta: string; nombre: string };

export type Renglon = {
  servicio: string;
  paraQue: string;
  // null = sin dato ese mes (sale «sin dato» y no suma al total).
  usd: number | null;
  nota: string | null;
};

// En pesos con el tipo de cambio del mes (null = sin tipo de cambio o sin dato).
export type RenglonReporte = Renglon & { mxn: number | null };

export type ReporteCostos = {
  mes: Mes;
  organizacion: string;
  renglones: RenglonReporte[];
  totalUsd: number;
  totalMxn: number | null;
  // Servicios que no tuvieron dato: el total va sin ellos.
  sinDato: string[];
  // Contactos que llegaron a la etapa de venta en el mes (null = no se pudo contar).
  ventas: number | null;
  costoPorVentaUsd: number | null;
  costoPorVentaMxn: number | null;
  // Promedio del dólar en el mes (Diario Oficial); null = no se pudo leer y todo va en dólares.
  tipoCambio: TipoCambio | null;
  // Nota de una sola vez para ese mes (NOTAS_DEL_MES).
  nota: string | null;
  // Avisos para el dueño: cobro pendiente, lectura vieja o con error.
  avisos: string[];
};

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function mesDe(clave: string): Mes {
  const m = MES_RE.exec(clave);
  if (!m) throw new Error(`Mes inválido: «${clave}» (usa AAAA-MM, por ejemplo 2026-10).`);
  const [y, mm] = [Number(m[1]), Number(m[2])];
  const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { clave, desde: `${clave}-01`, hasta: `${clave}-${String(ultimo).padStart(2, "0")}`, nombre: monthLabel(clave) };
}

// El mes calendario anterior a `now`, en hora de Mazatlán (el día 3 de noviembre → octubre).
export function mesAnterior(now: Date): Mes {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).format(now);
  const [y, m] = hoy.split("-").map(Number);
  return mesDe(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- IA ----

// Proveedores que siempre salen (aunque el mes dé 0); los demás solo si gastaron algo.
const IA_FIJOS = ["anthropic", "openai"];
const IA_PARA_QUE: Record<string, string> = {
  anthropic: "Agente IA (Sonnet)",
  openai: "Agente IA (Luna) y audios",
};

// Por proveedor: lo que COBRÓ según su reporte (ai_provider_billing, incluye pruebas). Sin lectura del
// proveedor (Google no da su cobro por API) se usa lo que registró el CRM y la nota lo dice.
export function renglonesIa(input: {
  billing: readonly BillingSnapshot[];
  crmDays: readonly DaySpend[];
  mes: Mes;
}): { renglones: Renglon[]; avisos: string[] } {
  const { mes } = input;
  const snaps = new Map(input.billing.filter((b) => b.fetchedAt).map((b) => [b.provider, b]));
  const otros = [...new Set([...snaps.keys(), ...input.crmDays.map((d) => d.provider)])].filter((p) => !IA_FIJOS.includes(p)).sort();
  const providers = [...IA_FIJOS, ...otros];
  const renglones: Renglon[] = [];
  const avisos: string[] = [];
  // Una lectura hecha antes de que acabara el mes (más 1 día por el retraso de los reportes) puede venir corta.
  const leerDesde = new Date(`${addDays(mes.hasta, 1)}T23:59:59Z`);
  for (const provider of providers) {
    const snap = snaps.get(provider);
    let usd = 0;
    let nota: string | null = null;
    if (snap) {
      for (const [day, v] of Object.entries(snap.days)) if (day >= mes.desde && day <= mes.hasta) usd += v.todo;
      if (snap.fetchedAt && snap.fetchedAt < leerDesde) {
        avisos.push(`${providerLabel(provider)}: el último dato leído es del ${shortDate(snap.fetchedAt)}; el monto del mes puede venir incompleto.`);
      }
    } else {
      for (const d of input.crmDays) if (d.provider === provider && d.day >= mes.desde && d.day <= mes.hasta) usd += d.usd;
      if (usd > 0) nota = "calculado por el CRM (el proveedor no da su cobro)";
    }
    const failed = input.billing.find((b) => b.provider === provider)?.lastError;
    if (failed) avisos.push(`${providerLabel(provider)}: la última lectura del cobro falló; revisa el Dashboard.`);
    if (!IA_FIJOS.includes(provider) && round2(usd) === 0) continue;
    renglones.push({ servicio: `IA · ${providerLabel(provider)}`, paraQue: IA_PARA_QUE[provider] ?? "Agente IA", usd: round2(usd), nota });
  }
  return { renglones, avisos };
}

// ---- Railway ----

export type RailwayFila = Parameters<typeof summarizeRailway>[0];

// Railway cobra del 5 al 5 (corte a las 16:44 de Mazatlán). El reporte de un mes lleva el periodo que EMPIEZA
// en ese mes: el día 3 todavía no cierra, así que sale la factura estimada (plan + uso proyectado al corte).
export function renglonRailway(fila: RailwayFila | null, mes: Mes, now: Date): { renglon: Renglon; avisos: string[] } {
  const base = { servicio: "Railway", paraQue: "Servidores del CRM" };
  if (!fila) return { renglon: { ...base, usd: null, nota: "sin lectura de Railway" }, avisos: [] };
  const avisos: string[] = [];
  const alerta = railwayAlertFor(fila.state);
  if (alerta) avisos.push(alerta);
  if (fila.lastError) avisos.push("Railway: la última lectura del cobro falló; revisa el Dashboard.");
  const inicio = fila.periodStart ? new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).format(fila.periodStart) : null;
  if (inicio !== mes.clave || !fila.periodEnd) {
    return { renglon: { ...base, usd: null, nota: "Railway ya no tiene el periodo de ese mes" }, avisos };
  }
  const s = summarizeRailway(fila, now);
  const usd = s.estimatedBillUsd ?? s.usageUsd;
  const cierra = shortDate(fila.periodEnd);
  const cerrado = now >= fila.periodEnd;
  const nota = `periodo ${s.periodStartLabel} → ${cierra}; ${cerrado ? "ya cerró" : `estimado, se cobra el ${cierra}`}`;
  return { renglon: { ...base, usd: usd === null ? null : round2(usd), nota }, avisos };
}

// ---- Zernio ----

export type ZernioFila = {
  periodStart: Date | null;
  totalUsd: number | null;
  prevTotalUsd: number | null;
  prevPeriodStart: Date | null;
  suspended: boolean;
  declineReason: string | null;
  openInvoice: boolean;
  lastError: string | null;
};

const mesUtc = (d: Date) => d.toISOString().slice(0, 7);

// Zernio cobra por mes calendario (días UTC). El día 3 su «mes anterior» ya está cerrado.
export function renglonZernio(fila: ZernioFila | null, mes: Mes): { renglon: Renglon; avisos: string[] } {
  const base = { servicio: "Zernio", paraQue: "Conecta WhatsApp e Instagram" };
  if (!fila) return { renglon: { ...base, usd: null, nota: "sin lectura de Zernio" }, avisos: [] };
  const avisos: string[] = [];
  const alerta = zernioAlertFor(fila);
  if (alerta) avisos.push(alerta);
  if (fila.lastError) avisos.push("Zernio: la última lectura del cobro falló; revisa el Dashboard.");
  if (fila.prevPeriodStart && mesUtc(fila.prevPeriodStart) === mes.clave && fila.prevTotalUsd !== null) {
    return { renglon: { ...base, usd: round2(fila.prevTotalUsd), nota: null }, avisos };
  }
  return { renglon: { ...base, usd: null, nota: "Zernio ya no da el cobro de ese mes" }, avisos };
}

// ---- Meta ----

// Meta todavía no le da su cobro al CRM (falta el token de feat/meta-costos): se estima mensaje por mensaje.
export function renglonMeta(conteo: MetaConteo | null): Renglon {
  const base = { servicio: "Meta (WhatsApp)", paraQue: "Plantillas y mensajes cobrados" };
  if (!conteo) return { ...base, usd: null, nota: "no se pudo contar" };
  const cobrados = conteo.marketing + conteo.utilidad + conteo.servicio;
  return {
    ...base,
    usd: round2(metaCostoUsd(conteo)),
    nota: `estimado por el CRM con IVA (${cobrados.toLocaleString("es-MX")} mensajes cobrables); el monto exacto está en Meta Business Suite`,
  };
}

// ---- Reporte ----

export function armarReporte(input: {
  mes: Mes;
  organizacion: string;
  ia: ReturnType<typeof renglonesIa>;
  railway: ReturnType<typeof renglonRailway>;
  zernio: ReturnType<typeof renglonZernio>;
  meta: Renglon;
  ventas: number | null;
  tipoCambio: TipoCambio | null;
}): ReporteCostos {
  const tc = input.tipoCambio?.mxnPorUsd ?? null;
  const renglones = [...input.ia.renglones, input.railway.renglon, input.zernio.renglon, input.meta].map((r) => ({
    ...r,
    mxn: tc !== null && r.usd !== null ? round2(r.usd * tc) : null,
  }));
  const totalUsd = round2(renglones.reduce((s, r) => s + (r.usd ?? 0), 0));
  // Suma de los renglones en pesos (no total × tipo de cambio) para que cuadre centavo por centavo.
  const totalMxn = tc === null ? null : round2(renglones.reduce((s, r) => s + (r.mxn ?? 0), 0));
  const sinDato = renglones.filter((r) => r.usd === null).map((r) => r.servicio);
  const ventas = input.ventas;
  const avisos = [...input.ia.avisos, ...input.railway.avisos, ...input.zernio.avisos];
  if (tc === null) avisos.push("No se pudo leer el tipo de cambio del Diario Oficial: los montos van solo en dólares.");
  return {
    mes: input.mes,
    organizacion: input.organizacion,
    renglones,
    totalUsd,
    totalMxn,
    sinDato,
    ventas,
    costoPorVentaUsd: ventas ? round2(totalUsd / ventas) : null,
    costoPorVentaMxn: ventas && totalMxn !== null ? round2(totalMxn / ventas) : null,
    tipoCambio: input.tipoCambio,
    nota: NOTAS_DEL_MES[input.mes.clave] ?? null,
    avisos,
  };
}
