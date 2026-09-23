// Lecturas del Dashboard (A2) con la organización EXPLÍCITA: la resuelve la
// página desde la sesión, nunca viene del cliente (CLAUDE.md §7).
//
// "Conversación nueva" = contacto creado en el rango que ESCRIBIÓ (tiene al
// menos un mensaje entrante). Se excluyen los que entraron por importación
// (source ghl_import) y los de prueba (seed): el import de GHL guardó ~10,900
// contactos con created_at del día del import (no guardó la fecha original), así
// que contarlos pintaría un pico falso. Tampoco cuentan los creados a mano ni
// los que solo tienen salientes (p. ej. el vendedor escribió primero desde la
// app del celular) hasta que el cliente conteste.
//
// Los días son LOCALES de America/Mazatlan. created_at es `timestamp` sin zona
// guardado en UTC (defaultNow del servidor en UTC y los Date de JS llegan en
// UTC), por eso se convierte UTC → local antes de agrupar por día.
import { sql, type SQL } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { DASHBOARD_TIME_ZONE, type DateRange } from "./range";

type Database = typeof appDb;

export const EXCLUDED_SOURCES = ["ghl_import", "seed"] as const;

export type DailyCount = { dia: string; total: number };
export type Bucket = { clave: string; total: number };
export type Breakdown = {
  total: number;
  porCanal: Bucket[];
  porEtapa: Bucket[];
  porAnuncio: number;
};
export type PeriodComparison = { actual: number; anterior: number };
export type PeriodCards = {
  hoy: PeriodComparison;
  semana: PeriodComparison;
  mes: PeriodComparison;
};

const tz = DASHBOARD_TIME_ZONE;

// El contacto escribió al menos una vez (en cualquiera de sus conversaciones).
const wroteIn = sql`exists (
  select 1 from conversations cv
  join messages m on m.conversation_id = cv.id
  where cv.organization_id = c.organization_id and cv.contact_id = c.id and m.direction = 'in'
)`;

// created_at (UTC, sin zona) → hora local de Mazatlán (sin zona).
const localCreatedAt = sql`((c.created_at at time zone 'UTC') at time zone ${tz})`;

// Día local YYYY-MM-DD → instante UTC (sin zona) de su medianoche local, para
// que el filtro sobre created_at use el valor crudo de la columna.
function localDayStartUtc(day: string, plusDays = 0): SQL {
  return sql`(((${day}::date + ${plusDays}::int)::timestamp at time zone ${tz}) at time zone 'UTC')`;
}

function newContactsWhere(organizationId: string, range: DateRange): SQL {
  return sql`c.organization_id = ${organizationId}
    and coalesce(c.source, '') not in (${sql.join(
      EXCLUDED_SOURCES.map((source) => sql`${source}`),
      sql`, `,
    )})
    and c.created_at >= ${localDayStartUtc(range.desde)}
    and c.created_at < ${localDayStartUtc(range.hasta, 1)}
    and ${wroteIn}`;
}

/** Conversaciones nuevas por día local del rango (días sin datos = 0). */
export async function newConversationsByDay(
  database: Database,
  organizationId: string,
  range: DateRange,
): Promise<DailyCount[]> {
  const rows = await database.execute<{ dia: string; total: number }>(sql`
    with dias as (
      select d::date as dia
      from generate_series(${range.desde}::date, ${range.hasta}::date, interval '1 day') d
    ),
    nuevos as (
      select (${localCreatedAt})::date as dia, count(*)::int as total
      from contacts c
      where ${newContactsWhere(organizationId, range)}
      group by 1
    )
    select to_char(dias.dia, 'YYYY-MM-DD') as dia, coalesce(nuevos.total, 0)::int as total
    from dias left join nuevos using (dia)
    order by dias.dia
  `);
  return rows.map((row) => ({ dia: row.dia, total: Number(row.total) }));
}

/** Desglose del rango: por canal, por etapa actual y cuántas llegaron por anuncio. */
export async function newConversationsBreakdown(
  database: Database,
  organizationId: string,
  range: DateRange,
): Promise<Breakdown> {
  const where = newContactsWhere(organizationId, range);
  const [porCanal, porEtapa, resumen] = await Promise.all([
    database.execute<{ clave: string; total: number }>(sql`
      select coalesce(c.source_channel, 'otro') as clave, count(*)::int as total
      from contacts c where ${where}
      group by 1 order by 2 desc, 1
    `),
    database.execute<{ clave: string; total: number }>(sql`
      select c.stage::text as clave, count(*)::int as total
      from contacts c where ${where}
      group by 1 order by 1
    `),
    // Anuncio: alguna conversación del contacto trae el referral de clic a
    // WhatsApp (conversations.ad_referral, lo guarda la ingesta).
    database.execute<{ total: number; por_anuncio: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where exists (
               select 1 from conversations cv
               where cv.organization_id = c.organization_id
                 and cv.contact_id = c.id
                 and cv.ad_referral is not null
             ))::int as por_anuncio
      from contacts c where ${where}
    `),
  ]);
  const toBuckets = (rows: { clave: string; total: number }[]) =>
    rows.map((row) => ({ clave: row.clave, total: Number(row.total) }));
  return {
    total: Number(resumen[0]?.total ?? 0),
    porCanal: toBuckets(porCanal),
    porEtapa: toBuckets(porEtapa),
    porAnuncio: Number(resumen[0]?.por_anuncio ?? 0),
  };
}

/**
 * Tarjetas hoy / semana / mes contra el MISMO tramo del periodo anterior
 * (comparación justa a mitad de periodo): hoy hasta esta hora vs ayer hasta
 * esta hora; semana (lunes) hasta ahora vs la semana pasada hasta el mismo
 * momento; mes hasta hoy vs el mes pasado hasta el mismo día.
 */
export async function newConversationsCards(
  database: Database,
  organizationId: string,
  now: Date = new Date(),
): Promise<PeriodCards> {
  const rows = await database.execute<{
    hoy: number;
    hoy_anterior: number;
    semana: number;
    semana_anterior: number;
    mes: number;
    mes_anterior: number;
  }>(sql`
    with k as (
      select ahora,
             date_trunc('day', ahora) as hoy_ini,
             date_trunc('week', ahora) as sem_ini,
             date_trunc('month', ahora) as mes_ini
      from (select (${now.toISOString()}::timestamptz at time zone ${tz}) as ahora) b
    ),
    nuevos as (
      select ${localCreatedAt} as local
      from contacts c, k
      where c.organization_id = ${organizationId}
        and coalesce(c.source, '') not in (${sql.join(
          EXCLUDED_SOURCES.map((source) => sql`${source}`),
          sql`, `,
        )})
        and c.created_at >= (((k.mes_ini - interval '1 month') at time zone ${tz}) at time zone 'UTC')
        and ${wroteIn}
    )
    select
      count(*) filter (where local >= k.hoy_ini and local <= k.ahora)::int as hoy,
      count(*) filter (where local >= k.hoy_ini - interval '1 day'
                         and local <= k.ahora - interval '1 day')::int as hoy_anterior,
      count(*) filter (where local >= k.sem_ini and local <= k.ahora)::int as semana,
      count(*) filter (where local >= k.sem_ini - interval '7 days'
                         and local <= k.ahora - interval '7 days')::int as semana_anterior,
      count(*) filter (where local >= k.mes_ini and local <= k.ahora)::int as mes,
      count(*) filter (where local >= k.mes_ini - interval '1 month'
                         and local <= k.ahora - interval '1 month')::int as mes_anterior
    from nuevos cross join k
  `);
  const row = rows[0];
  const n = (value: number | undefined) => Number(value ?? 0);
  return {
    hoy: { actual: n(row?.hoy), anterior: n(row?.hoy_anterior) },
    semana: { actual: n(row?.semana), anterior: n(row?.semana_anterior) },
    mes: { actual: n(row?.mes), anterior: n(row?.mes_anterior) },
  };
}
