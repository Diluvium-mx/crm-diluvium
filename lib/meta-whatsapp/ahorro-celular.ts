// Ahorro por contestar desde el celular o WhatsApp Web (11-nov-2026, pedido del dueño; docs/meta-whatsapp.md). Lo que
// manda una persona desde la app del celular o WhatsApp Web no lo cobra Meta (coexistencia, docs/seguimientos.md [M4]);
// desde el CRM sí. Por cada mensaje así se calcula cuánto habría costado mandarlo desde el CRM:
// - nada si el chat estaba en el tiempo gratis del anuncio (la marca de Meta o, sin marca, las 72 h del CRM);
// - con el chat abierto (el cliente escribió en las últimas 24 h), un mensaje normal, que es gratis mientras queden los
//   1,000 del mes (el día en que se acabaron sale de lo que reporta Meta);
// - con el chat cerrado, desde el CRM habría sido una plantilla de marketing (una por chat y día, no una por mensaje).
// Si Meta marca alguno como cobrado, ese no cuenta como ahorro y se dice aparte: entonces la regla no se cumplió.
// Días UTC, como la factura de Meta. Se calcula con lo guardado (mensajes y lo que reporta Meta): nada se borra.
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { addDays } from "@/lib/ai/billing/days";
import { loadPricingRows, ratesFrom, type MetaPricingRow } from "./rates";

type Database = Pick<typeof appDb, "select" | "execute">;

// Meta cobra los mensajes normales desde el 1-oct-2026, después de los primeros 1,000 del mes.
export const SERVICIO_COBRADO_DESDE = "2026-10";
export const SERVICIO_GRATIS_MES = 1000;
// Si un mes no tiene lo que reporta Meta, se supone que los 1,000 se acaban el día 7 (lo que pasó en octubre).
const DIA_SIN_DATO = 7;

// Mensajes del celular de un chat en un día, con su situación.
export type CelularDia = { day: string; conversationId: string; gratisAnuncio: boolean; ventana: boolean; mensajes: number; cobradosMeta: number };

export type AhorroCelular = {
  mensajes: number;
  // Habrían sido gratis desde el CRM.
  gratisAnuncio: number;
  gratisMil: number;
  // Desde el CRM habrían costado: mensajes normales y plantillas (chats-día).
  normales: number;
  plantillas: number;
  ahorroUsd: number;
  // Los que Meta marcó como cobrados: ahí no hubo ahorro.
  cobradosMeta: number;
};

export type AhorroMes = AhorroCelular & { mes: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

// PURO: por mes, el día (AAAA-MM-DD) en que se acabaron los 1,000 mensajes normales gratis según Meta; null = no se
// acabaron. Un mes sin ningún renglón de Meta usa el día 7.
export function diaSinGratis(rows: MetaPricingRow[], mes: string): string | null {
  const delMes = rows.filter((r) => r.day.startsWith(mes));
  if (delMes.length === 0) return `${mes}-${String(DIA_SIN_DATO).padStart(2, "0")}`;
  const porDia = new Map<string, number>();
  for (const r of delMes) if (r.pricingType === "free_customer_service") porDia.set(r.day, (porDia.get(r.day) ?? 0) + r.volume);
  let suma = 0;
  for (const day of [...porDia.keys()].sort()) {
    suma += porDia.get(day) ?? 0;
    if (suma >= SERVICIO_GRATIS_MES) return day;
  }
  return null;
}

const vacio = (): AhorroCelular => ({ mensajes: 0, gratisAnuncio: 0, gratisMil: 0, normales: 0, plantillas: 0, ahorroUsd: 0, cobradosMeta: 0 });

// PURO: el ahorro de esos mensajes, en total y por mes. El día en que se acaban los 1,000 cuenta todavía como gratis.
export function calcularAhorroCelular(dias: CelularDia[], pricing: MetaPricingRow[]): { total: AhorroCelular; porMes: AhorroMes[] } {
  const total = vacio();
  const meses = new Map<string, AhorroCelular>();
  const tarifas = new Map<string, Record<string, number>>();
  const cortes = new Map<string, string | null>();
  for (const d of dias) {
    const mes = d.day.slice(0, 7);
    if (!meses.has(mes)) {
      meses.set(mes, vacio());
      tarifas.set(mes, ratesFrom(pricing.filter((r) => r.day.startsWith(mes))));
      cortes.set(mes, mes < SERVICIO_COBRADO_DESDE ? `${mes}-31` : diaSinGratis(pricing, mes));
    }
    const m = meses.get(mes)!;
    const tarifa = tarifas.get(mes)!;
    const corte = cortes.get(mes) ?? null;
    const libres = Math.max(0, d.mensajes - d.cobradosMeta);
    let usd = 0;
    const suma = (k: "gratisAnuncio" | "gratisMil" | "normales" | "plantillas", n: number) => {
      m[k] += n;
      total[k] += n;
    };
    if (d.gratisAnuncio) suma("gratisAnuncio", libres);
    else if (d.ventana) {
      if (corte === null || d.day <= corte) suma("gratisMil", libres);
      else {
        suma("normales", libres);
        usd = libres * (tarifa.service ?? 0);
      }
    } else if (libres > 0) {
      suma("plantillas", 1);
      usd = tarifa.marketing ?? 0;
    }
    for (const t of [m, total]) {
      t.mensajes += d.mensajes;
      t.cobradosMeta += d.cobradosMeta;
      t.ahorroUsd += usd;
    }
  }
  total.ahorroUsd = round2(total.ahorroUsd);
  const porMes = [...meses].map(([mes, a]) => ({ mes, ...a, ahorroUsd: round2(a.ahorroUsd) })).sort((a, b) => b.mes.localeCompare(a.mes));
  return { total, porMes };
}

// Mensajes del celular o WhatsApp Web entre dos días UTC (inclusivos), agrupados por chat y día con su situación.
export async function cargarCelularDias(database: Database, organizationId: string, desde: string, hasta: string): Promise<CelularDia[]> {
  const fin = addDays(hasta, 1);
  const rows = await database.execute<{ day: string; conversation_id: string; gratis_anuncio: boolean; ventana: boolean; mensajes: number; cobrados_meta: number }>(sql`
    with cel as (
      select m.conversation_id, m.created_at, m.meta_billable
      from messages m
      join conversations cv on cv.id = m.conversation_id
      join channels ch on ch.id = cv.channel_id and ch.type = 'whatsapp' and not ch.is_test
      where m.organization_id = ${organizationId} and m.direction = 'out' and m.source = 'business_app' and m.imported_at is null
        and m.created_at >= ${desde}::timestamp and m.created_at < ${fin}::timestamp
    )
    select to_char(c.created_at, 'YYYY-MM-DD') as day, c.conversation_id,
      (exists (select 1 from messages w where w.conversation_id = c.conversation_id and w.meta_pricing_type = 'free_entry_point'
          and w.created_at <= c.created_at and w.meta_window_expires_at > c.created_at)
       or exists (select 1 from messages e where e.conversation_id = c.conversation_id and e.direction = 'in' and e.ad_referral is not null
          and e.created_at <= c.created_at and e.created_at > c.created_at - interval '4 days'
          and (select min(o.created_at) from messages o where o.conversation_id = e.conversation_id and o.direction = 'out'
                and o.type <> 'system_note' and o.created_at >= e.created_at and o.created_at <= e.created_at + interval '24 hours')
              > c.created_at - interval '72 hours')) as gratis_anuncio,
      exists (select 1 from messages i where i.conversation_id = c.conversation_id and i.direction = 'in'
          and i.created_at <= c.created_at and i.created_at > c.created_at - interval '24 hours') as ventana,
      count(*)::int as mensajes,
      (count(*) filter (where c.meta_billable))::int as cobrados_meta
    from cel c
    group by 1, 2, 3, 4`);
  return [...rows].map((r) => ({
    day: r.day,
    conversationId: r.conversation_id,
    gratisAnuncio: r.gratis_anuncio,
    ventana: r.ventana,
    mensajes: Number(r.mensajes),
    cobradosMeta: Number(r.cobrados_meta),
  }));
}

// El ahorro de un periodo (y por mes) con lo guardado.
export async function cargarAhorroCelular(
  database: Database,
  organizationId: string,
  desde: string,
  hasta: string,
): Promise<{ total: AhorroCelular; porMes: AhorroMes[] }> {
  const [dias, pricing] = await Promise.all([
    cargarCelularDias(database, organizationId, desde, hasta),
    loadPricingRows(database, organizationId, `${desde.slice(0, 7)}-01`, hasta),
  ]);
  return calcularAhorroCelular(dias, pricing);
}
