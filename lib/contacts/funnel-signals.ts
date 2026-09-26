// Señales de la tarjeta del Embudo, por contacto (sin migraciones: salen de datos
// que ya existen). Un contacto puede tener conversación en varios canales; se suman.
//   - unread:  suma de conversations.unread_count (círculo naranja, como la Bandeja).
//   - pending: alguna conversación cuyo ÚLTIMO mensaje es del cliente (fondo azul).
//              No cuentan las notas internas ni lo copiado del historial del celular
//              (misma regla que el semáforo de la Bandeja).
//   - urgent:  el Agente IA pasó al cliente a un asesor o necesita ayuda del vendedor
//              (fondo amarillo): hay un aviso abierto de URGENT_NOTICE_KINDS sin una
//              respuesta humana que haya salido DESPUÉS del aviso. agente_error además
//              se apaga al atender la tarjeta (resolved_at).
// Multi-tenant (CLAUDE.md §7): toda lectura filtra por organization_id.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { NoticeKind } from "@/lib/ai/runtime/policy";
import type { FunnelSignal } from "./funnel-tone";

export type { FunnelSignal };

export const URGENT_NOTICE_KINDS = [
  "cliente_pide_humano",
  "pasar_a_humano",
  "cotejar_deposito", // "Depósito recibido"
  "comprobante_dudoso",
  "envio", // WhatsApp no confirmó o rechazó una respuesta del agente
  "agente_error",
] as const satisfies readonly NoticeKind[];

// Tope de conversaciones por lote en tiempo real (el cliente agrupa los eventos del SSE).
export const MAX_SIGNAL_CONVERSATIONS = 200;

const urgentKinds = sql.join(
  URGENT_NOTICE_KINDS.map((k) => sql`${k}`),
  sql`, `,
);

/**
 * Señales de la organización. Sin `conversationIds`: todos los contactos que tienen
 * alguna señal (los demás van en blanco). Con `conversationIds`: los contactos
 * DUEÑOS de esas conversaciones, con TODAS sus conversaciones, e incluye los que
 * quedaron en cero (así la UI apaga lo que ya se atendió).
 */
export async function funnelSignalsForOrg(
  organizationId: string,
  conversationIds?: readonly string[],
): Promise<Record<string, FunnelSignal>> {
  const targeted = conversationIds !== undefined;
  if (targeted && conversationIds.length === 0) return {};

  const scope = targeted
    ? sql`and c.contact_id in (
        select t.contact_id from conversations t
        where t.organization_id = ${organizationId}
          and t.id in (${sql.join(conversationIds.map((id) => sql`${id}`), sql`, `)}))`
    : sql``;

  const rows = await db.execute<{ contact_id: string; unread: number; pending: boolean; urgent: boolean }>(sql`
    select c.contact_id,
           coalesce(sum(c.unread_count), 0)::int as unread,
           coalesce(bool_or(last_msg.direction = 'in'), false) as pending,
           coalesce(bool_or(open_notice.urgent), false) as urgent
    from conversations c
    left join lateral (
      select m.direction
      from messages m
      where m.conversation_id = c.id
        and m.organization_id = ${organizationId}
        and m.type <> 'system_note'
        and m.imported_at is null
      order by coalesce(m.sent_at, m.created_at) desc, m.id desc
      limit 1
    ) last_msg on true
    cross join lateral (
      select exists (
        select 1
        from ai_agent_notices n
        where n.conversation_id = c.id
          and n.organization_id = ${organizationId}
          and n.kind in (${urgentKinds})
          and n.resolved_at is null
          and not exists (
            -- Respuesta humana que SÍ salió (misma regla que el semáforo y la primera
            -- respuesta): desde el CRM con autor, o desde la app del celular.
            select 1
            from messages h
            where h.conversation_id = c.id
              and h.organization_id = ${organizationId}
              and h.direction = 'out'
              and h.type <> 'system_note'
              and h.status in ('sent', 'delivered', 'read')
              and (h.source = 'business_app' or (h.source = 'crm' and h.sent_by_user_id is not null))
              and h.imported_at is null
              and h.created_at > n.created_at
          )
      ) as urgent
    ) open_notice
    where c.organization_id = ${organizationId}
      ${scope}
    group by c.contact_id
    ${targeted ? sql`` : sql`having sum(c.unread_count) > 0 or bool_or(last_msg.direction = 'in') or bool_or(open_notice.urgent)`}
  `);

  const out: Record<string, FunnelSignal> = {};
  for (const r of rows) {
    out[r.contact_id] = { unread: Number(r.unread) || 0, pending: r.pending === true, urgent: r.urgent === true };
  }
  return out;
}
