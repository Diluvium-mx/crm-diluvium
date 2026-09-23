// Montos "ya vistos" en una conversación (Fase D, diseño §2.3), para que en la
// parte (b) la guardia de salida acepte que el agente REPITA una cotización o
// confirme un pago ("$16,500") sin abrir la puerta a precios inventados.
//
// Fuera de lib/ai/runtime a propósito: la guardia está congelada hasta el
// cierre de la Fase B. Este módulo solo CALCULA el conjunto; engancharlo a
// `reviewReply` (parámetro `extraKnown`) es tarea B5.
//
// Reglas (definición 6 del dueño):
// 1. Cuentan los montos de SALIENTES previos del CRM (crm / business_app /
//    ai_agent) que sí salieron (sent/delivered/read): un humano o el propio
//    agente ya "aprobó" ese monto. Nunca un aviso interno (system_note).
// 2. Cuentan los montos que el agente reportó en un comprobante confirmado
//    (`workflow_runs.payload.monto` de una corrida `done` de pago_confirmado /
//    anticipo_confirmado).
// 3. NUNCA cuentan los montos escritos por el cliente (entrantes).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, workflowRuns, workflows } from "@/lib/db/schema";
import { amountFromPayload, amountsFromMessages } from "./known-amounts-rules";

export { amountFromPayload, amountsFromMessages } from "./known-amounts-rules";

export const KNOWN_AMOUNTS_MAX_MESSAGES = 60;
export const PAYMENT_WORKFLOW_SLUGS = ["pago_confirmado", "anticipo_confirmado"] as const;

/** Montos (centavos) que la guardia puede aceptar en ESTA conversación además de la base. */
export async function conversationKnownAmounts(organizationId: string, conversationId: string): Promise<Set<number>> {
  const rows = await db
    .select({ direction: messages.direction, source: messages.source, type: messages.type, status: messages.status, body: messages.body })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(sql`coalesce(${messages.sentAt}, ${messages.createdAt})`))
    .limit(KNOWN_AMOUNTS_MAX_MESSAGES);
  const known = amountsFromMessages(rows);
  const runs = await db
    .select({ payload: workflowRuns.payload })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        eq(workflowRuns.conversationId, conversationId),
        eq(workflowRuns.status, "done"),
        inArray(workflows.slug, [...PAYMENT_WORKFLOW_SLUGS]),
      ),
    );
  for (const r of runs) {
    const v = amountFromPayload(r.payload);
    if (v !== null) known.add(v);
  }
  return known;
}
