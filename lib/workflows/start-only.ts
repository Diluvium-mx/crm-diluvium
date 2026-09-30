// «Solo al inicio» (29-sep-2026, regla ESTRICTA del dueño; columna workflows.trigger_start_only).
//
// Para las respuestas ya definidas de primer contacto (p. ej. «Precio 2»: el cliente llega de un
// anuncio y su primer mensaje es "precio"). Por palabra clave o por el Agente IA, un workflow con
// esta opción:
// - solo se dispara AL INICIO: mientras ni el Agente IA (con texto propio) ni un vendedor (desde el
//   CRM o el celular) le han contestado al cliente. El historial copiado del celular sí cuenta: ese
//   cliente ya habló con un vendedor.
// - sale a lo mucho UNA vez por contacto, por cualquier camino: nunca se repite.
// - UNA SOLA respuesta de inicio por cliente (30-sep-2026, decisión del dueño): si ya le salió OTRO
//   workflow «Solo al inicio» (cualquiera de las dos opciones: «Información», «Precio 2», la Tabla),
//   este ya no sale; lo siguiente lo contesta el Agente IA. Antes lo de otros workflows no contaba
//   y en 7 chats del 29–30 sep salieron dos seguidos (Tabla → «Precio 2» con la misma foto;
//   «Información» → «Precio 2» a 2 s; «Información» → Tabla por «…checo las medidas»).
// El comando del vendedor ("/precio2") y la etapa que mueve un vendedor salen siempre: los pidió él.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, workflowRuns, workflows } from "@/lib/db/schema";

export type StartOnlyBlock = "ya_enviado" | "no_inicio" | "otra_de_inicio";

// Workflows «Solo al inicio» de la organización (las respuestas de inicio), sin `exceptId`.
async function startOnlyWorkflowIds(organizationId: string, exceptId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.triggerStartOnly, true), exceptId ? ne(workflows.id, exceptId) : undefined));
  return rows.map((r) => r.id);
}

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
  if (!(await conversationAtStart(input.organizationId, input.conversationId))) return "no_inicio";
  const others = await startOnlyWorkflowIds(input.organizationId, input.workflowId);
  return (await startOnlyAlreadySent(input.organizationId, input.contactId, others, input)).size > 0 ? "otra_de_inicio" : null;
}

/**
 * De estos workflows «solo al inicio», los que SÍ pueden dispararse ahora en esta conversación: al
 * inicio y solo si a este contacto no le ha salido NINGUNA respuesta de inicio (ni ese mismo ni otro).
 */
export async function startOnlyEligible(organizationId: string, conversationId: string, contactId: string, workflowIds: readonly string[]): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  if (!(await conversationAtStart(organizationId, conversationId))) return new Set();
  const all = [...new Set([...workflowIds, ...(await startOnlyWorkflowIds(organizationId))])];
  if ((await startOnlyAlreadySent(organizationId, contactId, all)).size > 0) return new Set();
  return new Set(workflowIds);
}
