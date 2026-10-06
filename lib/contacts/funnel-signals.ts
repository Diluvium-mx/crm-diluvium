// Señales de la tarjeta del Embudo, por contacto. Un contacto puede tener conversación
// en varios canales; se suman. La regla de colores (28-sep-2026, dueño):
//   - unread:  suma de conversations.unread_count (círculo naranja, como la Bandeja).
//              Se apaga al abrir el chat o con «Marcar como leído».
//   - pending: el cliente escribió y nadie le ha contestado (fondo AZUL): alguna
//              conversación cuyo ÚLTIMO mensaje es del cliente y llegó DESPUÉS del último
//              «Marcar como leído» (conversations.attended_at). Se apaga con una respuesta
//              que salió (vendedor desde el CRM o el celular, o el Agente IA) o con
//              «Marcar como leído»; abrir el chat NO la apaga. No cuentan las notas
//              internas, lo copiado del historial del celular (misma regla que el semáforo
//              de la Bandeja) ni un saliente que no salió (en cola o rechazado).
//   - urgent:  el Agente IA pasó al cliente a un asesor o necesita ayuda del vendedor
//              (fondo AMARILLO, gana al azul): hay un aviso abierto de URGENT_NOTICE_KINDS
//              sin una respuesta humana que haya salido DESPUÉS del aviso. agente_error
//              además se apaga al atender la tarjeta (resolved_at). «Marcar como leído»
//              no lo apaga; «Quitar tarjeta» sí (conversations.urgent_cleared_at: los
//              avisos anteriores a esa hora ya no cuentan, el aviso sigue abierto).
//   - lastInboundAt: último mensaje del cliente (ordena la columna en vivo).
// Multi-tenant (CLAUDE.md §7): toda lectura filtra por organization_id.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { NoticeKind } from "@/lib/ai/runtime/policy";
import { SERVICE_WINDOW_MS } from "@/lib/messaging/rules";
import type { FunnelSignal } from "./funnel-tone";

export type { FunnelSignal };

export const URGENT_NOTICE_KINDS = [
  "cliente_pide_humano",
  "pasar_a_humano",
  "cotejar_deposito", // "Depósito recibido"
  "comprobante_dudoso",
  "envio", // WhatsApp no confirmó o rechazó una respuesta del agente
  "agente_error",
  "tope_respuestas", // Opciones del bot: llegó al máximo de respuestas; pausado hasta "Activar"
  "sin_respuesta", // Red contra el silencio: ningún modelo le escribió al cliente
  "seguimiento", // Seguimientos: sugerencia presentada, pago pendiente sin respuesta, asesor al final
] as const satisfies readonly NoticeKind[];

// Tope de conversaciones por lote en tiempo real (el cliente agrupa los eventos del SSE).
export const MAX_SIGNAL_CONVERSATIONS = 200;

const urgentKinds = sql.join(
  URGENT_NOTICE_KINDS.map((k) => sql`${k}`),
  sql`, `,
);

/**
 * Último mensaje del cliente a partir de la ventana de 24 h, que se mueve SOLO con
 * entrantes (lib/messaging/ingest.ts + rules.ts: ventana = último entrante + 24 h). Sin
 * leer `messages`: con ~11k contactos el Embudo lo calcula de una sola tabla.
 * `windowMs` = epoch ms de max(window_expires_at) (null = nunca escribió).
 */
export function lastInboundFromWindow(windowMs: number | string | null): number | null {
  if (windowMs === null) return null;
  const ms = Number(windowMs);
  return Number.isFinite(ms) ? ms - SERVICE_WINDOW_MS : null;
}

/**
 * Señales de la organización. Sin `conversationIds`: todos los contactos que tienen
 * alguna señal o escribieron en las últimas 24 h (su hora ordena la columna al
 * reconectar); los demás van en blanco. Con `conversationIds`: los contactos DUEÑOS de
 * esas conversaciones, con TODAS sus conversaciones, e incluye los que quedaron en
 * cero (así la UI apaga lo que ya se atendió).
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
  // Ventana abierta = escribió en las últimas 24 h. ISO con cast: la columna guarda la
  // hora UTC sin zona (la escribe la app), igual que el barrido del agente.
  const now = sql`${new Date().toISOString()}::timestamp`;

  const rows = await db.execute<{
    contact_id: string;
    unread: number;
    pending: boolean;
    urgent: boolean;
    last_window_ms: number | string | null;
  }>(sql`
    select contact_id,
           coalesce(sum(unread_count), 0)::int as unread,
           coalesce(bool_or(pending), false) as pending,
           coalesce(bool_or(urgent), false) as urgent,
           (extract(epoch from max(window_expires_at)) * 1000)::float8 as last_window_ms
    from (
      select c.contact_id,
             c.unread_count,
             c.window_expires_at,
             -- Azul: el último mensaje es del cliente y llegó después de «Marcar como
             -- leído» (misma hora de la base en las dos: created_at y attended_at).
             last_msg.direction = 'in' and (c.attended_at is null or last_msg.created_at > c.attended_at) as pending,
             open_notice.urgent
      from conversations c
      left join lateral (
        select m.direction, m.created_at
        from messages m
        where m.conversation_id = c.id
          and m.organization_id = ${organizationId}
          and m.type <> 'system_note'
          and m.imported_at is null
          and (m.direction = 'in' or m.status in ('sent', 'delivered', 'read'))
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
            -- «Quitar tarjeta» (clic derecho del Embudo): avisos anteriores ya no pintan.
            and (c.urgent_cleared_at is null or n.created_at > c.urgent_cleared_at)
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
    ) per_conversation
    group by contact_id
    ${targeted ? sql`` : sql`having sum(unread_count) > 0 or bool_or(pending) or bool_or(urgent) or max(window_expires_at) > ${now}`}
  `);

  const out: Record<string, FunnelSignal> = {};
  for (const r of rows) {
    out[r.contact_id] = {
      unread: Number(r.unread) || 0,
      pending: r.pending === true,
      urgent: r.urgent === true,
      lastInboundAt: lastInboundFromWindow(r.last_window_ms),
    };
  }
  return out;
}
