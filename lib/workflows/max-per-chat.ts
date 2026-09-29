// «Máximo de envíos por chat» (29-sep-2026, decisiones del dueño; workflows.max_sends_per_chat).
//
// Para la Tabla de tamaños: la foto sale máximo 2 veces en un chat. Se cuenta lo que YA SALIÓ en
// ESTA conversación:
// - workflow con archivos: cuántas veces salió su archivo (el que más veces salió), venga del
//   workflow que venga — la foto de la tabla dentro de «Precio 2» o «Información» también cuenta
//   ("cuenta la foto"), y el comando del vendedor (/tamaños) también suma;
// - sin archivos: sus corridas que mandaron algo.
// Un envío fallido no cuenta; uno en camino sí. El límite frena a la palabra clave y al Agente IA;
// el comando del vendedor PUEDE pasarlo (lo decide él) y la etapa de un vendedor también.
// Multi-tenant (CLAUDE.md §7): todo filtra por organization_id.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets, workflowSteps, workflows } from "@/lib/db/schema";
import type { RunTrigger } from "./executor";

export type LimitedWorkflow = { id: string; name: string; maxSendsPerChat: number | null };

// ¿El máximo aplica a este disparador?
export function maxPerChatApplies(trigger: RunTrigger): boolean {
  return trigger === "keyword" || trigger === "agent";
}

async function assetKeysOf(organizationId: string, workflowId: string): Promise<{ assetIds: string[]; keys: string[] }> {
  const steps = await db
    .select({ payload: workflowSteps.payload })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.organizationId, organizationId), eq(workflowSteps.workflowId, workflowId), eq(workflowSteps.kind, "send_media")));
  const assetIds = [...new Set(steps.flatMap((s) => (s.payload.kind === "send_media" && s.payload.assetId ? [s.payload.assetId] : [])))];
  if (assetIds.length === 0) return { assetIds, keys: [] };
  const rows = await db
    .select({ key: mediaAssets.storageKey })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.organizationId, organizationId), inArray(mediaAssets.id, assetIds)));
  return { assetIds, keys: rows.map((r) => r.key) };
}

/**
 * Cuántas veces ya salió este workflow en la conversación (ver arriba). `includeLive`: también
 * las corridas en cola o en curso que todavía no lo mandan (al decidir si se crea otra o si se le
 * ofrece al Agente IA); al ARRANCAR una corrida no hace falta: en una conversación corre una a la
 * vez y las anteriores ya dejaron su mensaje. `exceptRunId`: la corrida que se está evaluando.
 */
export async function sendsInChat(
  organizationId: string,
  conversationId: string,
  workflowId: string,
  opts: { includeLive?: boolean; exceptRunId?: string } = {},
): Promise<number> {
  const { assetIds, keys } = await assetKeysOf(organizationId, workflowId);
  const except = opts.exceptRunId ? sql`and r.id <> ${opts.exceptRunId}` : sql``;
  if (keys.length > 0) {
    const perKey = await Promise.all(
      keys.map(async (key) => {
        const [row] = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from messages m
          where m.organization_id = ${organizationId} and m.conversation_id = ${conversationId}
            and m.direction = 'out' and m.status <> 'failed'
            and m.attachments @> jsonb_build_array(jsonb_build_object('storageKey', ${key}::text))
        `);
        return Number(row?.n ?? 0);
      }),
    );
    let sent = Math.max(...perKey);
    if (opts.includeLive) {
      // Corridas vivas de CUALQUIER workflow con ese archivo que aún no lo mandaron.
      const [live] = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from workflow_runs r
        where r.organization_id = ${organizationId} and r.conversation_id = ${conversationId}
          and r.status in ('queued', 'running') ${except}
          and exists (select 1 from workflow_steps s where s.organization_id = r.organization_id and s.workflow_id = r.workflow_id
                        and s.kind = 'send_media' and s.payload->>'assetId' in (${sql.join(assetIds.map((a) => sql`${a}`), sql`, `)}))
          and not exists (select 1 from messages m where m.organization_id = r.organization_id and r.message_ids ? m.id
                            and m.status <> 'failed' and jsonb_array_length(m.attachments) > 0)
      `);
      sent += Number(live?.n ?? 0);
    }
    return sent;
  }
  const live = opts.includeLive ? sql`r.status in ('queued', 'running') or` : sql``;
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from workflow_runs r
    where r.organization_id = ${organizationId} and r.conversation_id = ${conversationId} and r.workflow_id = ${workflowId} ${except}
      and (${live} exists (select 1 from messages m where m.organization_id = r.organization_id and r.message_ids ? m.id and m.status <> 'failed'))
  `);
  return Number(row?.n ?? 0);
}

/** ¿Ya llegó al máximo? (false si no tiene máximo). */
export async function atMaxPerChat(
  organizationId: string,
  conversationId: string,
  wf: { id: string; maxSendsPerChat: number | null },
  opts: { includeLive?: boolean; exceptRunId?: string } = {},
): Promise<boolean> {
  if (!wf.maxSendsPerChat) return false;
  return (await sendsInChat(organizationId, conversationId, wf.id, opts)) >= wf.maxSendsPerChat;
}

/** Cuántas veces salió cada workflow con máximo (para el Agente IA y sus herramientas). */
export async function sendsByWorkflow(
  organizationId: string,
  conversationId: string,
  rows: readonly LimitedWorkflow[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const w of rows) {
    if (w.maxSendsPerChat) out.set(w.id, await sendsInChat(organizationId, conversationId, w.id, { includeLive: true }));
  }
  return out;
}

/**
 * Línea para el contexto del CRM del Agente IA: cuántas veces ya salió cada workflow con máximo
 * que el Agente IA puede usar ("La tabla… ya se envió 1 de 2 veces en este chat").
 */
export async function maxPerChatContextFor(organizationId: string, conversationId: string): Promise<string> {
  const rows = await db
    .select({ id: workflows.id, name: workflows.name, maxSendsPerChat: workflows.maxSendsPerChat })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.enabled, true), eq(workflows.triggerAgent, true), sql`${workflows.maxSendsPerChat} is not null`))
    .orderBy(workflows.position);
  if (rows.length === 0) return "";
  const sent = await sendsByWorkflow(organizationId, conversationId, rows);
  return rows
    .map((w) => {
      const n = sent.get(w.id) ?? 0;
      const max = w.maxSendsPerChat!;
      return n >= max
        ? `«${w.name}» ya se envió ${n} de ${max} veces en este chat: ya no se puede volver a mandar.`
        : `«${w.name}» se ha enviado ${n} de ${max} veces en este chat.`;
    })
    .join("\n");
}
