// Acciones del cerebro (Fase D, parte b): lo que el modelo pidió con herramientas
// se convierte en corridas de workflow (`trigger: agent`), en el total cotizado del
// contacto o en la verificación de un comprobante. El CRM decide, no el modelo:
// un pago solo se confirma si `verificarComprobante` cuadra (monto contra lo
// cotizado + referencia no repetida); si no cuadra, el texto del modelo se
// descarta y el cliente recibe un texto amable con el motivo. Nada aquí pausa al
// agente. Multi-tenant: toda escritura filtra por organization_id.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, workflows } from "@/lib/db/schema";
import { verificarComprobante, type LecturaComprobante } from "@/lib/cobro/comprobante";
import { contextoParaComprobante, ReferenciaDuplicadaError, registrarPagoConfirmado } from "@/lib/cobro/pagos";
import type { StartRunInput, StartRunResult } from "@/lib/workflows/executor";
import { buildAgentTools, type AgentTools, type ValidToolCall } from "./tools";

// Herramientas de la organización en orden estable (position) para no romper la
// caché del prompt: workflows habilitados con disparador "agente".
export async function loadAgentTools(organizationId: string): Promise<AgentTools> {
  const rows = await db
    .select({ id: workflows.id, slug: workflows.slug, name: workflows.name, description: workflows.agentDescription })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.enabled, true), eq(workflows.triggerAgent, true)))
    .orderBy(asc(workflows.position), asc(workflows.slug));
  return buildAgentTools(rows);
}

export type StartWorkflow = (input: StartRunInput) => Promise<StartRunResult>;

const PAGO_SLUGS = new Set(["pago_confirmado", "anticipo_confirmado"]);
export const SLUG_PAGO_COMPLETO = "pago_confirmado";
export const SLUG_ANTICIPO = "anticipo_confirmado";
export const SLUG_NO_CUADRA = "pago_no_cuadra";

export type PlannedRun = { slug: string; workflowId: string; payload: Record<string, unknown> };

export type ActionPlan = {
  // Texto final para el cliente (el del modelo, o el amable si el comprobante no cuadra).
  text: string;
  runs: PlannedRun[];
  quote: number | null;
  // Pago verificado que se registra justo antes de correr su workflow.
  pago: { referencia: string; montoMxn: number; tipo: "completo" | "anticipo" | "liquidacion"; banco: string | null; fecha: string | null } | null;
  notes: string[];
};

// Texto al cliente cuando el comprobante no cuadra (definición 3 del dueño):
// amable, con el motivo, y un asesor lo revisa. El agente sigue activo.
export function noCuadraText(motivo: string): string {
  return `Gracias por tu comprobante 🙏 Lo revisé y ${motivo}. Ya le avisé a un asesor para que lo revise y te confirme en un momento.`;
}

const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export async function prepareActions(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  calls: readonly ValidToolCall[];
  // Herramientas ofrecidas (para encontrar el workflow de pago que corresponda al tipo).
  workflowsBySlug: ReadonlyMap<string, { id: string; slug: string }>;
  inboundHasImage: boolean;
  modelText: string;
}): Promise<ActionPlan> {
  const plan: ActionPlan = { text: input.modelText, runs: [], quote: null, pago: null, notes: [] };
  let pagoHandled = false;
  for (const c of input.calls) {
    if (c.kind === "cotizacion") {
      plan.quote = c.monto;
      continue;
    }
    if (PAGO_SLUGS.has(c.workflow.slug)) {
      if (pagoHandled) continue;
      pagoHandled = true;
      // Sin imagen en lo que el cliente acaba de mandar, no hay comprobante que verificar.
      if (!input.inboundHasImage) {
        plan.notes.push(`${c.workflow.slug} ignorada: el entrante no trae imagen`);
        continue;
      }
      const lectura: LecturaComprobante = {
        monto: str(c.args.monto),
        fecha: str(c.args.fecha),
        banco: str(c.args.banco),
        referencia: str(c.args.referencia),
      };
      // Si el modelo acaba de fijar la cotización en esta misma respuesta, cuenta.
      const ctx = await contextoParaComprobante(input.organizationId, input.conversationId, input.contactId, lectura.referencia);
      if (plan.quote !== null && (ctx.totalCotizado === null || ctx.totalCotizado <= 0)) ctx.totalCotizado = plan.quote;
      const res = verificarComprobante(lectura, ctx);
      if (!res.ok) {
        plan.text = noCuadraText(res.motivo);
        const wf = input.workflowsBySlug.get(SLUG_NO_CUADRA);
        if (wf) plan.runs.push({ slug: wf.slug, workflowId: wf.id, payload: { motivo: res.motivo, monto: lectura.monto ?? "", referencia: lectura.referencia ?? "" } });
        else plan.notes.push(`comprobante no cuadra (${res.motivo}) y el workflow ${SLUG_NO_CUADRA} no está habilitado`);
        continue;
      }
      const slug = res.tipo === "anticipo" ? SLUG_ANTICIPO : SLUG_PAGO_COMPLETO;
      const wf = input.workflowsBySlug.get(slug);
      plan.pago = { referencia: res.referencia, montoMxn: res.montoMxn, tipo: res.tipo, banco: lectura.banco, fecha: lectura.fecha };
      if (wf) {
        plan.runs.push({
          slug,
          workflowId: wf.id,
          payload: { monto: money(res.montoMxn), fecha: lectura.fecha ?? "sin fecha legible", banco: lectura.banco ?? "banco no legible", referencia: res.referencia, aviso: res.aviso },
        });
      } else plan.notes.push(`pago verificado pero el workflow ${slug} no está habilitado`);
      continue;
    }
    plan.runs.push({ slug: c.workflow.slug, workflowId: c.workflow.id, payload: c.args });
  }
  return plan;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

// Guarda el total cotizado por el AGENTE. Si un vendedor lo fijó a mano en el
// detalle del contacto, manda el vendedor: el agente no lo pisa.
export async function setQuoteByAgent(organizationId: string, contactId: string, monto: number): Promise<boolean> {
  const rows = await db
    .update(contacts)
    .set({
      montoCotizacion: monto.toFixed(2),
      customFields: sql`${contacts.customFields} || '{"cotizacion_por":"agente"}'::jsonb`,
    })
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, organizationId),
        sql`(${contacts.montoCotizacion} is null or ${contacts.customFields}->>'cotizacion_por' = 'agente')`,
      ),
    )
    .returning({ id: contacts.id });
  return rows.length > 0;
}

export type ExecutedActions = { started: string[]; skipped: string[]; notes: string[] };

// Corre el plan DESPUÉS de las burbujas: cotización, registro del pago y corridas
// en el orden en que el modelo las pidió. Cada corrida relee el estado del agente
// antes de cada paso (executor); aquí solo se encolan.
export async function executeActions(
  plan: ActionPlan,
  ctx: { organizationId: string; conversationId: string; contactId: string; now: Date },
  startWorkflow: StartWorkflow,
): Promise<ExecutedActions> {
  const out: ExecutedActions = { started: [], skipped: [], notes: [...plan.notes] };
  if (plan.quote !== null) {
    const ok = await setQuoteByAgent(ctx.organizationId, ctx.contactId, plan.quote);
    if (!ok) out.notes.push("cotización no guardada: la fijó un vendedor");
  }
  if (plan.pago) {
    try {
      await registrarPagoConfirmado({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        referencia: plan.pago.referencia,
        montoMxn: plan.pago.montoMxn,
        tipo: plan.pago.tipo,
        banco: plan.pago.banco,
        fechaComprobante: plan.pago.fecha,
        confirmadoPor: "agente",
      });
    } catch (error) {
      if (!(error instanceof ReferenciaDuplicadaError)) throw error;
      // Carrera: la misma referencia entró dos veces. El workflow de pago no corre.
      out.notes.push(`referencia ${plan.pago.referencia} ya registrada; no se repite la confirmación`);
      plan.runs = plan.runs.filter((r) => !PAGO_SLUGS.has(r.slug));
    }
  }
  for (const r of plan.runs) {
    const res = await startWorkflow({
      organizationId: ctx.organizationId,
      workflowId: r.workflowId,
      conversationId: ctx.conversationId,
      trigger: "agent",
      payload: r.payload,
      now: ctx.now,
    });
    if (res.status === "queued") out.started.push(r.slug);
    else out.skipped.push(`${r.slug}: ${res.reason ?? "omitido"}`);
  }
  return out;
}
