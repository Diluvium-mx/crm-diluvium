// «Solo al inicio» (29-sep-2026, regla ESTRICTA del dueño; columna workflows.trigger_start_only).
//
// Para las respuestas ya definidas de primer contacto (p. ej. «Precio 2»: el cliente llega de un
// anuncio y su primer mensaje es "precio"). Por palabra clave o por el Agente IA, un workflow con
// esta opción:
// - solo se dispara AL INICIO: mientras ni el Agente IA (con texto propio) ni un vendedor (desde el
//   CRM o el celular) le han contestado al cliente. Lo que mandan otros workflows automáticos no
//   cuenta ("Quiero más información" → «Información», luego "Precio" → «Precio 2» sí sale). El
//   historial copiado del celular sí cuenta: ese cliente ya habló con un vendedor.
// - sale a lo mucho UNA vez por contacto, por cualquier camino: nunca se repite.
// El comando del vendedor ("/precio2") y la etapa que mueve un vendedor salen siempre: los pidió él.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, workflowRuns } from "@/lib/db/schema";

export type StartOnlyBlock = "ya_enviado" | "no_inicio";

/**
 * ¿La conversación sigue al inicio? Ningún saliente que cuente como respuesta: de un vendedor
 * (crm, business_app) o del Agente IA con texto propio (ai_agent que no es de una corrida de
 * workflow). Sin avisos internos ni envíos fallidos.
 */
export async function conversationAtStart(organizationId: string, conversationId: string): Promise<boolean> {
  const [reply] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        ne(messages.status, "failed"),
        ne(messages.type, "system_note"),
        sql`(${messages.source} in ('crm', 'business_app') or (${messages.source} = 'ai_agent' and not exists (
          select 1 from workflow_runs r
          where r.organization_id = ${messages.organizationId} and r.conversation_id = ${messages.conversationId}
            and r.message_ids ? ${messages.id}
        )))`,
      ),
    )
    .limit(1);
  return !reply;
}

/**
 * De estos workflows, cuáles YA le salieron a este contacto (cualquier disparador, cualquier
 * conversación): corrida hecha o que mandó algo que no falló. `includeQueued`: también las que
 * esperan en cola o corren (al decidir si se crea otra). Al reclamar una corrida se pasa false:
 * gana la primera que arrancó y la otra se salta.
 */
export async function startOnlyAlreadySent(
  organizationId: string,
  contactId: string,
  workflowIds: readonly string[],
  opts: { exceptRunId?: string; includeQueued?: boolean } = {},
): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  const live = opts.includeQueued === false ? sql`('running', 'done')` : sql`('queued', 'running', 'done')`;
  const rows = await db
    .selectDistinct({ workflowId: workflowRuns.workflowId })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        eq(workflowRuns.contactId, contactId),
        inArray(workflowRuns.workflowId, [...workflowIds]),
        opts.exceptRunId ? ne(workflowRuns.id, opts.exceptRunId) : undefined,
        sql`(${workflowRuns.status} in ${live} or exists (
          select 1 from messages m
          where m.organization_id = ${workflowRuns.organizationId} and ${workflowRuns.messageIds} ? m.id and m.status <> 'failed'
        ))`,
      ),
    );
  return new Set(rows.map((r) => r.workflowId));
}

/** Motivo por el que un workflow «solo al inicio» NO se dispara ahora (o null si sí). */
export async function startOnlyBlock(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  workflowId: string;
  exceptRunId?: string;
  includeQueued?: boolean;
}): Promise<StartOnlyBlock | null> {
  const sent = await startOnlyAlreadySent(input.organizationId, input.contactId, [input.workflowId], input);
  if (sent.has(input.workflowId)) return "ya_enviado";
  return (await conversationAtStart(input.organizationId, input.conversationId)) ? null : "no_inicio";
}

/** De estos workflows «solo al inicio», los que SÍ pueden dispararse ahora en esta conversación. */
export async function startOnlyEligible(organizationId: string, conversationId: string, contactId: string, workflowIds: readonly string[]): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  if (!(await conversationAtStart(organizationId, conversationId))) return new Set();
  const sent = await startOnlyAlreadySent(organizationId, contactId, workflowIds);
  return new Set(workflowIds.filter((id) => !sent.has(id)));
}
