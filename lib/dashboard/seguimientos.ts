// Tarjeta «Seguimientos del Agente IA» del Dashboard (docs/seguimientos.md, Parte 4; 6-oct-2026).
// Cuenta, en el periodo (días de Mazatlán), los seguimientos que de verdad salieron
// (messages.metadata.seguimiento, modo real) y qué pasó en esos chats:
//   - contestaron: el cliente escribió después del primer seguimiento y antes de 72 h del último;
//   - avanzaron de etapa: hoy está en una etapa más adelante que la que tenía al salir el seguimiento
//     (metadata.seguimiento.etapa; solo los enviados desde el 6-oct-2026 la traen);
//   - compraron: hoy está en la etapa con papel «Venta cerrada» y llegó ahí después del seguimiento.
// Un chat cuenta una vez en el periodo (con el caso de su primer seguimiento). La organización sale de
// la sesión; toda consulta filtra por organization_id.
import { sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { CASE_RULES, isFollowUpCase, WAIT_AFTER_LAST_MS } from "@/lib/followups/cases";
import { DASHBOARD_TIME_ZONE, type DateRange } from "./range";

type Database = typeof appDb;
const tz = DASHBOARD_TIME_ZONE;
const localDayStartUtc = (day: string, plusDays = 0) => sql`(((${day}::date + ${plusDays}::int)::timestamp at time zone ${tz}) at time zone 'UTC')`;

export type FollowUpCaseRow = { caso: string; label: string; chats: number; contestaron: number; avanzaron: number; compraron: number };
export type FollowUpStats = {
  /** Mensajes de seguimiento que salieron (texto o plantilla). */
  salieron: number;
  /** Los que WhatsApp no entregó (error). */
  fallaron: number;
  /** Chats que recibieron al menos uno. */
  chats: number;
  contestaron: number;
  avanzaron: number;
  compraron: number;
  porCaso: FollowUpCaseRow[];
};

export async function followUpStats(database: Database, organizationId: string, range: DateRange): Promise<FollowUpStats> {
  const start = localDayStartUtc(range.desde);
  const end = localDayStartUtc(range.hasta, 1);
  const waitHours = Math.round(WAIT_AFTER_LAST_MS / 3_600_000);
  const rows = await database.execute<{
    caso: string | null;
    salieron: string;
    fallaron: string;
    chats: string;
    contestaron: string;
    avanzaron: string;
    compraron: string;
  }>(sql`
    with s as (
      select m.conversation_id, m.created_at, m.status,
        m.metadata -> 'seguimiento' ->> 'followUpId' as fid,
        m.metadata -> 'seguimiento' ->> 'etapa' as etapa
      from messages m
      where m.organization_id = ${organizationId} and m.direction = 'out'
        and m.metadata ? 'seguimiento'
        and m.created_at >= ${start} and m.created_at < ${end}
    ),
    ok as (select * from s where s.status in ('sent', 'delivered', 'read')),
    conv as (
      select ok.conversation_id,
        min(ok.created_at) as first_at,
        max(ok.created_at) as last_at,
        count(*) as enviados,
        (array_agg(f.caso order by ok.created_at))[1] as caso,
        (array_agg(ok.etapa order by ok.created_at))[1] as etapa
      from ok
      left join follow_ups f on f.id = ok.fid and f.organization_id = ${organizationId}
      group by ok.conversation_id
    ),
    r as (
      select conv.*,
        exists (
          select 1 from messages i
          where i.organization_id = ${organizationId} and i.conversation_id = conv.conversation_id
            and i.direction = 'in' and i.created_at > conv.first_at
            and i.created_at < conv.last_at + make_interval(hours => ${waitHours}::int)
        ) as contesto,
        (now_s.role = 'venta_cerrada' and c.stage_changed_at > conv.first_at) as compro,
        (then_s.position is not null and now_s.position > then_s.position and c.stage_changed_at > conv.first_at) as avanzo
      from conv
      join conversations cv on cv.id = conv.conversation_id and cv.organization_id = ${organizationId}
      join contacts c on c.id = cv.contact_id and c.organization_id = ${organizationId}
      left join funnel_stages now_s on now_s.organization_id = ${organizationId} and now_s.key = c.stage
      left join funnel_stages then_s on then_s.organization_id = ${organizationId} and then_s.key = conv.etapa
    )
    select r.caso,
      sum(r.enviados)::text as salieron,
      '0' as fallaron,
      count(*)::text as chats,
      count(*) filter (where r.contesto)::text as contestaron,
      count(*) filter (where r.avanzo)::text as avanzaron,
      count(*) filter (where r.compro)::text as compraron
    from r group by r.caso
    union all
    select '__fallaron__', '0', (select count(*) from s where s.status = 'failed')::text, '0', '0', '0', '0'
  `);
  const out: FollowUpStats = { salieron: 0, fallaron: 0, chats: 0, contestaron: 0, avanzaron: 0, compraron: 0, porCaso: [] };
  for (const r of rows) {
    if (r.caso === "__fallaron__") {
      out.fallaron = Number(r.fallaron);
      continue;
    }
    const row = { chats: Number(r.chats), contestaron: Number(r.contestaron), avanzaron: Number(r.avanzaron), compraron: Number(r.compraron) };
    out.salieron += Number(r.salieron);
    out.chats += row.chats;
    out.contestaron += row.contestaron;
    out.avanzaron += row.avanzaron;
    out.compraron += row.compraron;
    const caso = r.caso ?? "sin_caso";
    out.porCaso.push({ caso, label: isFollowUpCase(caso) ? CASE_RULES[caso].label : "Sin caso", ...row });
  }
  out.porCaso.sort((a, b) => b.chats - a.chats || a.label.localeCompare(b.label));
  return out;
}
