// Estimado de lo que Meta cobra por WhatsApp en un mes (reporte de costos, docs/costos.md › Meta). Desde el
// 4-nov-2026 el correo usa lo que REPORTA Meta (docs/meta-whatsapp.md); este estimado queda solo de respaldo para
// un mes sin esa lectura. Cuenta mensaje por mensaje con las reglas que el CRM cree que usa Meta, y cuenta de más
// (~14 %: 3,403 contra 2,985 en oct-2026, porque Meta da a veces más tiempo gratis por anuncio):
// - Solo WhatsApp (Instagram no cobra), sin canales de prueba, sin lo importado ni lo mandado desde el celular,
//   y solo lo entregado o leído.
// - Gratis 72 h desde la primera respuesta (≤ 24 h) a un cliente que llegó por un anuncio.
// - Plantillas: marketing o utilidad según su categoría en Meta (sin categoría = marketing).
// - Mensajes normales (servicio): los primeros 1,000 del mes por número son gratis (desde el 1-oct-2026).
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";

type Database = Pick<typeof appDb, "execute">;

export type MetaConteo = { marketing: number; utilidad: number; servicio: number };

// Lo que cobró Meta por mensaje en oct-2026 (factura del 1-nov: US$44.16, SIN IVA; Meta no cobra IVA). Las de
// antes (0.0431/0.0108/0.0105 «con IVA») salieron de una cifra equivocada del asistente de Meta (3-nov-2026).
// Si Meta cambia sus tarifas, se cambian aquí, en META_FALLBACK_RATE_USD (lib/dashboard/meta-whatsapp.ts) y en
// docs/costos.md.
export const META_TARIFAS_USD = { marketing: 0.0407, utilidad: 0.0084, servicio: 0.0115 } as const;
export const META_SERVICIO_GRATIS_MES = 1000;

export function metaCostoUsd(c: MetaConteo): number {
  const t = META_TARIFAS_USD;
  return c.marketing * t.marketing + c.utilidad * t.utilidad + c.servicio * t.servicio;
}

// Mensajes cobrables del mes (hora de Mazatlán). `desde`/`hasta` = primer y último día "AAAA-MM-DD".
export async function contarMetaCobrables(database: Database, organizationId: string, desde: string, hasta: string): Promise<MetaConteo> {
  const [row] = await database.execute<{ marketing: string; utilidad: string; servicio: string }>(sql`
    with limites as (
      select (${desde}::timestamp at time zone 'America/Mazatlan') at time zone 'UTC' as ini,
             ((${hasta}::date + 1)::timestamp at time zone 'America/Mazatlan') at time zone 'UTC' as fin
    ),
    cat as (
      select distinct on (name) name, upper(category) as category
      from templates where organization_id = ${organizationId}
      order by name, updated_at desc
    ),
    entradas as (
      select e.conversation_id,
        (select min(o.created_at) from messages o
          where o.conversation_id = e.conversation_id and o.direction = 'out' and o.type <> 'system_note'
            and o.created_at >= e.created_at and o.created_at <= e.created_at + interval '24 hours') as resp
      from messages e, limites l
      where e.organization_id = ${organizationId} and e.direction = 'in' and e.ad_referral is not null
        and e.created_at >= l.ini - interval '4 days' and e.created_at < l.fin
    ),
    s as (
      select m.created_at, ch.id as channel_id,
        case when m.template_name is not null or m.type = 'template'
          then (case when c.category in ('UTILITY', 'AUTHENTICATION') then 'utilidad' else 'marketing' end)
          else 'servicio' end as categoria,
        exists (select 1 from entradas w where w.conversation_id = m.conversation_id and w.resp is not null
          and m.created_at >= w.resp and m.created_at < w.resp + interval '72 hours') as gratis_anuncio
      from messages m
      cross join limites l
      join conversations cv on cv.id = m.conversation_id
      join channels ch on ch.id = cv.channel_id and ch.type = 'whatsapp' and not ch.is_test
      left join cat c on c.name = m.template_name
      where m.organization_id = ${organizationId} and m.direction = 'out' and m.imported_at is null
        and m.type <> 'system_note' and m.source <> 'business_app' and m.status in ('delivered', 'read')
        and m.created_at >= l.ini and m.created_at < l.fin
    ),
    servicio as (
      select row_number() over (partition by channel_id order by created_at) as n
      from s where categoria = 'servicio' and not gratis_anuncio
    )
    select
      count(*) filter (where categoria = 'marketing' and not gratis_anuncio)::text as marketing,
      count(*) filter (where categoria = 'utilidad' and not gratis_anuncio)::text as utilidad,
      (select count(*) from servicio where n > ${META_SERVICIO_GRATIS_MES})::text as servicio
    from s
  `);
  return { marketing: Number(row?.marketing ?? 0), utilidad: Number(row?.utilidad ?? 0), servicio: Number(row?.servicio ?? 0) };
}
