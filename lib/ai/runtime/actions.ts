// Acciones del cerebro (Fase D, parte b): lo que el modelo pidió con herramientas
// se convierte en corridas de workflow (`trigger: agent`), en el total cotizado del
// contacto o en la verificación de un comprobante. El CRM decide, no el modelo:
// un pago solo se confirma si `verificarComprobante` cuadra (monto contra lo
// cotizado + referencia no repetida); si no cuadra, el texto del modelo se
// descarta y el cliente recibe un texto amable con el motivo. Nada aquí pausa al
// agente. Multi-tenant: toda escritura filtra por organization_id.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, workflowRuns, workflows, workflowSteps } from "@/lib/db/schema";
import { and as andSql, gte, inArray } from "drizzle-orm";
import { verificarComprobante, type LecturaComprobante } from "@/lib/cobro/comprobante";
import { contextoParaComprobante, conversacionDeReferencia, ReferenciaDuplicadaError, registrarPagoConfirmado } from "@/lib/cobro/pagos";
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
const SLUG_CAMBIAR_ETAPA = "cambiar_etapa";
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
  pago: { referencia: string; montoMxn: number; tipo: "completo" | "anticipo" | "liquidacion"; banco: string | null; fecha: string | null; cotizacionPor: string | null } | null;
  // Para el vendedor (aviso en el hilo tal cual).
  notes: string[];
  warnings: string[];
};

// Texto al cliente cuando el comprobante no cuadra (definición 3 del dueño):
// amable, con el motivo, y un asesor lo revisa. El agente sigue activo.
export function noCuadraText(motivo: string): string {
  return `Gracias por tu comprobante 🙏 Lo revisé y ${motivoParaCliente(motivo)}. Ya le avisé a un asesor para que lo revise y te confirme en un momento.`;
}

// Los motivos de verificarComprobante son para el vendedor; al cliente le llega
// una frase sin jerga interna ni acusaciones.
export function motivoParaCliente(motivo: string): string {
  if (/no tiene monto de cotizaci/i.test(motivo)) return "todavía no tengo registrado el total de tu pedido";
  if (/ya se usó/i.test(motivo)) return "esa referencia ya la tenemos registrada de un pago anterior";
  return motivo.replace(/\s*\(posible captura reenviada\)/i, "");
}

// El modelo pidió confirmar un pago sin que haya una foto reciente del cliente.
export const PIDE_FOTO_TEXT = "Para confirmar tu pago necesito la foto del comprobante 🙏 Mándamela aquí mismo y lo reviso.";
// La misma referencia ya está confirmada en ESTA conversación (el cliente reenvió
// su captura por seguridad): no se acusa ni se corre pago_no_cuadra.
export const YA_REGISTRADO_TEXT = "Ese pago ya lo tenemos registrado ✅ Gracias, seguimos con tu pedido.";

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
  // Llegada del primer entrante que se está atendiendo: una corrida por palabra
  // clave del mismo workflow desde entonces ya mandó ese contenido (no se repite).
  pendingSince: Date | null;
}): Promise<ActionPlan> {
  const plan: ActionPlan = { text: input.modelText, runs: [], quote: null, pago: null, notes: [], warnings: [] };
  let pagoHandled = false;
  // Cotización y comprobante NUNCA en la misma vuelta: un cliente podría dictarle
  // al modelo un total bajo ("me cotizaron en $500") y "cuadrar" un comprobante
  // barato. La cotización solo cuenta si ya estaba guardada de una vuelta anterior.
  const pideConfirmarPago = input.calls.some((c) => c.kind === "workflow" && PAGO_SLUGS.has(c.workflow.slug));
  for (const c of input.calls) {
    if (c.kind === "cotizacion") {
      if (pideConfirmarPago) plan.notes.push("fijar_cotizacion ignorada: vino junto con un comprobante");
      // Solo cuenta un total que el AGENTE le está diciendo al cliente en este
      // mismo texto (un cliente que "dicta" un total al modelo no lo fija).
      else if (!textoMencionaMonto(input.modelText, c.monto)) plan.notes.push(`fijar_cotizacion ignorada: $${c.monto} no aparece en el texto del agente`);
      else plan.quote = c.monto;
      continue;
    }
    if (c.workflow.slug === SLUG_CAMBIAR_ETAPA && c.args.etapa === "compra") {
      // A "Compra" solo se llega con un pago verificado (pago_confirmado): la
      // petición se IGNORA (reescribirla a cerca_compra retrocedería a un comprado).
      plan.notes.push("cambiar_etapa a compra ignorada: a Compra solo se llega con un pago verificado");
      continue;
    }
    if (PAGO_SLUGS.has(c.workflow.slug)) {
      if (pagoHandled) continue;
      pagoHandled = true;
      // Sin foto reciente del cliente no hay comprobante que verificar: se le pide
      // (el texto del modelo, "pago recibido", NO sale).
      if (!input.inboundHasImage) {
        plan.notes.push(`${c.workflow.slug} ignorada: no hay imagen reciente del cliente`);
        plan.text = PIDE_FOTO_TEXT;
        continue;
      }
      const lectura: LecturaComprobante = {
        monto: str(c.args.monto),
        fecha: str(c.args.fecha),
        banco: str(c.args.banco),
        referencia: str(c.args.referencia),
        moneda: str(c.args.moneda),
      };
      const ctx = await contextoParaComprobante(input.organizationId, input.conversationId, input.contactId, lectura.referencia);
      const res = verificarComprobante(lectura, ctx);
      if (!res.ok && ctx.referenciaYaUsada && lectura.referencia) {
        const donde = await conversacionDeReferencia(input.organizationId, lectura.referencia);
        if (donde === input.conversationId) {
          plan.text = YA_REGISTRADO_TEXT;
          plan.notes.push("comprobante reenviado: la referencia ya está confirmada en esta conversación");
          continue;
        }
      }
      if (!res.ok) {
        // Nada mueve la etapa en una vuelta cuyo comprobante no cuadra.
        plan.runs = plan.runs.filter((r) => r.slug !== SLUG_CAMBIAR_ETAPA);
        plan.text = noCuadraText(res.motivo);
        const wf = input.workflowsBySlug.get(SLUG_NO_CUADRA);
        if (wf) plan.runs.push({ slug: wf.slug, workflowId: wf.id, payload: { motivo: res.motivo, monto: lectura.monto ?? "", referencia: lectura.referencia ?? "" } });
        else plan.notes.push(`comprobante no cuadra (${res.motivo}) y el workflow ${SLUG_NO_CUADRA} no está habilitado`);
        continue;
      }
      const slug = res.tipo === "anticipo" ? SLUG_ANTICIPO : SLUG_PAGO_COMPLETO;
      const wf = input.workflowsBySlug.get(slug);
      if (!wf) {
        // Sin el workflow del tipo verificado no se registra nada: el vendedor lo revisa.
        const motivo = `el workflow ${slug} no está habilitado`;
        plan.text = noCuadraText("no pude validarlo automáticamente");
        plan.notes.push(`pago verificado (${res.tipo}) pero ${motivo}`);
        const nc = input.workflowsBySlug.get(SLUG_NO_CUADRA);
        if (nc) plan.runs.push({ slug: nc.slug, workflowId: nc.id, payload: { motivo, monto: lectura.monto ?? "", referencia: res.referencia } });
        continue;
      }
      plan.pago = { referencia: res.referencia, montoMxn: res.montoMxn, tipo: res.tipo, banco: lectura.banco, fecha: lectura.fecha, cotizacionPor: ctx.cotizacionPor };
      if (ctx.cotizacionPor === "agente") {
        plan.warnings.push(`Pago confirmado contra una cotización fijada por el AGENTE ($${ctx.totalCotizado?.toLocaleString("es-MX")}), no por un vendedor: cotejar el monto y el depósito antes de enviar.`);
      }
      plan.runs.push({
        slug,
        workflowId: wf.id,
        payload: { monto: money(res.montoMxn), fecha: lectura.fecha ?? "sin fecha legible", banco: lectura.banco ?? "banco no legible", referencia: res.referencia, aviso: res.aviso },
      });
      continue;
    }
    plan.runs.push({ slug: c.workflow.slug, workflowId: c.workflow.id, payload: c.args });
  }
  // Palabra clave + herramienta para el MISMO workflow ("pásame la tabla"): la
  // corrida por palabra clave ya lo manda; la del agente no se repite.
  if (input.pendingSince && plan.runs.length) {
    const ids = plan.runs.map((r) => r.workflowId);
    const dup = await db
      .select({ workflowId: workflowRuns.workflowId })
      .from(workflowRuns)
      .where(
        andSql(
          eq(workflowRuns.organizationId, input.organizationId),
          eq(workflowRuns.conversationId, input.conversationId),
          eq(workflowRuns.trigger, "keyword"),
          inArray(workflowRuns.workflowId, ids),
          inArray(workflowRuns.status, ["queued", "running", "done"]),
          gte(workflowRuns.createdAt, input.pendingSince),
        ),
      );
    const dupIds = new Set(dup.map((d) => d.workflowId));
    if (dupIds.size) {
      plan.notes.push(`${plan.runs.filter((r) => dupIds.has(r.workflowId)).map((r) => r.slug).join(", ")}: ya salió por palabra clave para este mensaje`);
      plan.runs = plan.runs.filter((r) => !dupIds.has(r.workflowId));
    }
  }
  return plan;
}

// ¿El texto del agente menciona ese monto? ("$5,500", "5500", "5,500.00").
export function textoMencionaMonto(text: string, monto: number): boolean {
  const candidates = new Set<string>();
  for (const raw of text.match(/\d[\d,.]*/g) ?? []) {
    const clean = raw.replace(/[^\d.,]/g, "");
    const n = Number(clean.replace(/,/g, ""));
    if (Number.isFinite(n)) candidates.add(n.toFixed(2));
    const n2 = Number(clean.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n2)) candidates.add(n2.toFixed(2));
  }
  return candidates.has(monto.toFixed(2));
}

// ¿Alguna de estas corridas manda algo al cliente (texto o archivo)? Si el
// modelo no escribió texto y ninguna acción manda nada, el CRM no puede dar el
// entrante por atendido en silencio.
export async function runsThatSend(organizationId: string, workflowIds: readonly string[]): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  const rows = await db
    .select({ workflowId: workflowSteps.workflowId })
    .from(workflowSteps)
    .where(andSql(eq(workflowSteps.organizationId, organizationId), inArray(workflowSteps.workflowId, [...workflowIds]), inArray(workflowSteps.kind, ["send_text", "send_media"])));
  return new Set(rows.map((r) => r.workflowId));
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

// ANTES de las burbujas: el pago verificado se registra primero. Si la referencia
// entró dos veces a la vez (carrera) o la BD falla, al cliente NO se le dice
// "confirmado": el texto pasa a ser el amable y corre pago_no_cuadra.
export async function commitPagoBeforeText(
  plan: ActionPlan,
  ctx: { organizationId: string; conversationId: string; contactId: string; now: Date },
  workflowsBySlug: ReadonlyMap<string, { id: string; slug: string }>,
  startWorkflow: StartWorkflow,
): Promise<void> {
  if (!plan.pago) return;
  const fallo = (motivo: string) => {
    plan.notes.push(`pago no registrado: ${motivo}`);
    plan.pago = null;
    plan.runs = plan.runs.filter((r) => !PAGO_SLUGS.has(r.slug));
    plan.text = noCuadraText(motivo);
    const wf = workflowsBySlug.get(SLUG_NO_CUADRA);
    if (wf) plan.runs.push({ slug: wf.slug, workflowId: wf.id, payload: { motivo } });
  };
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
    if (error instanceof ReferenciaDuplicadaError) fallo(`la referencia ${plan.pago.referencia} ya se usó en un pago confirmado antes`);
    else fallo(`no se pudo registrar el pago (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  // La corrida del pago (aviso al vendedor + etapa) se encola YA, junto con el
  // registro: si el envío del texto se detiene o falla, no se pierde.
  const pagoRuns = plan.runs.filter((r) => PAGO_SLUGS.has(r.slug));
  plan.runs = plan.runs.filter((r) => !PAGO_SLUGS.has(r.slug));
  for (const r of pagoRuns) {
    const res = await startWorkflow({ organizationId: ctx.organizationId, workflowId: r.workflowId, conversationId: ctx.conversationId, trigger: "agent", payload: r.payload, now: ctx.now });
    if (res.status !== "queued") plan.notes.push(`${r.slug}: ${res.reason ?? "omitido"}`);
  }
}

// DESPUÉS de las burbujas: cotización y corridas en el orden en que el modelo las
// pidió. Cada corrida relee el estado del agente antes de cada paso (executor);
// aquí solo se encolan.
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
