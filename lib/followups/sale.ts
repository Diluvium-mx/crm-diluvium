// El contacto llegó a la etapa con papel "Venta cerrada" (Compra): su seguimiento abierto se
// cancela EN ESE MOMENTO, no hasta la hora del intento (decisión del dueño, 3-oct-2026). Se
// llama dentro de la transacción del cambio de etapa; el aviso a la píldora 🤖 sale al confirmar.
import { sql } from "drizzle-orm";
import type { NotifyExecutor } from "@/lib/contacts/notify-updated";

export async function cancelFollowUpsOnSale(exec: NotifyExecutor, organizationId: string, contactId: string, stageKey: string): Promise<void> {
  await exec.execute(sql`
    with cancelled as (
      update follow_ups f
      set status = 'cancelado', cancel_reason = 'venta_cerrada', closed_at = now(), updated_at = now()
      where f.organization_id = ${organizationId} and f.contact_id = ${contactId}
        and f.status in ('programado', 'esperando')
        and exists (
          select 1 from funnel_stages s
          where s.organization_id = ${organizationId} and s.key = ${stageKey} and s.role = 'venta_cerrada'
        )
      returning f.conversation_id
    )
    select pg_notify('inbox_events', json_build_object(
      'org', ${organizationId}::text, 'type', 'followup.updated',
      'conversationId', c.conversation_id, 'contactId', ${contactId}::text
    )::text)
    from cancelled c
  `);
}
