// Disparadores humanos y de cliente (Fase D, A6). Todos AISLADOS: nunca
// lanzan; un fallo aquí no debe romper la ingesta ni un cambio de etapa. El
// ejecutor decide (modo del canal, una vez por conversación) y deja rastro.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages, workflows } from "@/lib/db/schema";
import { startWorkflowRun, type StartRunResult } from "./executor";
import { matchesKeyword, parseCommand } from "./steps";

/**
 * Entrante NUEVO del cliente (después del commit de la ingesta): si es texto y
 * contiene una palabra clave de un workflow habilitado, lo dispara. Un mensaje
 * dispara como máximo UN workflow (el primero por posición) para no inundar.
 */
export async function onInboundKeyword(m: { organizationId: string; conversationId: string; messageId: string }): Promise<StartRunResult | null> {
  try {
    const [msg] = await db
      .select({ body: messages.body, type: messages.type, direction: messages.direction })
      .from(messages)
      .where(and(eq(messages.id, m.messageId), eq(messages.organizationId, m.organizationId)))
      .limit(1);
    if (!msg || msg.direction !== "in" || msg.type !== "text" || !msg.body) return null;
    const rows = await db
      .select({ id: workflows.id, keywords: workflows.triggerKeywords, position: workflows.position })
      .from(workflows)
      .where(and(eq(workflows.organizationId, m.organizationId), eq(workflows.enabled, true)))
      .orderBy(workflows.position);
    for (const wf of rows) {
      if (wf.keywords.length === 0) continue;
      if (matchesKeyword(msg.body, wf.keywords)) {
        return await startWorkflowRun({
          organizationId: m.organizationId,
          workflowId: wf.id,
          conversationId: m.conversationId,
          trigger: "keyword",
          payload: { mensaje: msg.body.slice(0, 200) },
        });
      }
    }
    return null;
  } catch (error) {
    console.error(`[workflows] disparador por palabra clave falló (${m.conversationId}); el mensaje ya está guardado`, error);
    return null;
  }
}

/**
 * El contacto ENTRÓ a una etapa por acción humana (panel de contacto o
 * arrastre en el Embudo). Dispara los workflows con esa etapa como disparador
 * sobre la conversación más reciente del contacto. Un `set_stage` dentro de
 * un workflow NO pasa por aquí (evita cadenas y bucles entre workflows).
 */
export async function onContactStageEntered(input: {
  organizationId: string;
  contactId: string;
  stage: string;
  userId: string | null;
}): Promise<StartRunResult[]> {
  try {
    const rows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.organizationId, input.organizationId),
          eq(workflows.enabled, true),
          eq(workflows.triggerStage, input.stage as (typeof workflows.$inferSelect)["triggerStage"] & string),
        ),
      )
      .orderBy(workflows.position);
    if (rows.length === 0) return [];
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.organizationId, input.organizationId), eq(conversations.contactId, input.contactId)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (!conv) return [];
    const out: StartRunResult[] = [];
    for (const wf of rows) {
      out.push(
        await startWorkflowRun({
          organizationId: input.organizationId,
          workflowId: wf.id,
          conversationId: conv.id,
          trigger: "stage",
          triggeredByUserId: input.userId,
          payload: { etapa_disparadora: input.stage },
        }),
      );
    }
    return out;
  } catch (error) {
    console.error(`[workflows] disparador por etapa falló (${input.contactId}); la etapa ya cambió`, error);
    return [];
  }
}

/**
 * Comando del vendedor en el composer ("/tabla"). Devuelve null si el texto no
 * es un comando o no corresponde a un workflow de la organización (entonces
 * el composer lo manda como texto normal). Lanza si el workflow existe pero la
 * corrida no procede (el vendedor debe verlo).
 */
export async function findWorkflowByCommand(organizationId: string, text: string): Promise<{ id: string; name: string; enabled: boolean } | null> {
  const command = parseCommand(text);
  if (!command) return null;
  const [wf] = await db
    .select({ id: workflows.id, name: workflows.name, enabled: workflows.enabled })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.triggerCommand, command)))
    .limit(1);
  return wf ?? null;
}
