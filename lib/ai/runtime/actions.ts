// Acciones internas del cerebro (Fase D reestructurada, 24-sep-2026): salen en la
// MISMA llamada que genera la respuesta y son invisibles para el cliente.
// - media: corridas de workflow `wf_<slug>` (trigger "agent");
// - fijar_cotizacion: total cotizado en el contacto (un vendedor manda);
// - mover_etapa: solo hacia adelante (lib/contacts/stage.ts);
// - aviso_vendedor: aviso 🤖 en la Bandeja ("Depósito recibido", "Comprobante dudoso"
//   o el cliente pide una persona). Desde la Fase E (25-sep-2026, decisión del dueño)
//   el agente ya NO anota monto ni folio del comprobante y no hay chequeo de folio
//   repetido: el aviso de pago solo dice "Depósito recibido".
// El CRM NO decide por monto: las reglas viven en el Goal. Nada aquí pausa al agente.
// Idempotente por lote de mensajes del cliente (avisos: índice único message_id+kind;
// etapa: solo hacia adelante).
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, workflowRuns, workflows, workflowSteps } from "@/lib/db/schema";
import { moveStageForward } from "@/lib/contacts/stage";
import type { Stage } from "@/lib/contacts/stages";
import type { StartRunInput, StartRunResult } from "@/lib/workflows/executor";
import { addNotice } from "./notices";
import { buildAgentTools, type AgentTools, type AvisoMotivo, type ValidToolCall } from "./tools";

// Nota que NO se muestra al vendedor (Fase E, pendiente F): la media ya salió por la
// palabra clave del cliente y el agente la pidió otra vez; no le pide nada al vendedor.
// Solo queda en el log del worker.
export const YA_SALIO_POR_PALABRA_CLAVE = "ya salió por palabra clave para este mensaje";
export function noteForVendor(note: string): boolean {
  return !note.endsWith(YA_SALIO_POR_PALABRA_CLAVE);
}

export type StartWorkflow = (input: StartRunInput) => Promise<StartRunResult>;

// Herramientas de la organización en orden estable (position): workflows de
// media habilitados con disparador "agente".
export async function loadAgentTools(organizationId: string): Promise<AgentTools> {
  const rows = await db
    .select({ id: workflows.id, slug: workflows.slug, name: workflows.name, description: workflows.agentDescription })
    .from(workflows)
    .where(
      and(
        eq(workflows.organizationId, organizationId),
        eq(workflows.enabled, true),
        eq(workflows.triggerAgent, true),
        // Con un archivo sin elegir (o sin pasos) no se ofrece: el modelo prometería
        // algo que la corrida saltaría y el cliente se quedaría esperando.
        sql`exists (select 1 from workflow_steps s where s.workflow_id = ${workflows.id})`,
        sql`not exists (select 1 from workflow_steps s where s.workflow_id = ${workflows.id} and s.kind = 'send_media' and s.payload->>'assetId' is null)`,
      ),
    )
    .orderBy(asc(workflows.position), asc(workflows.slug));
  return buildAgentTools(rows);
}

export type Aviso = {
  motivo: AvisoMotivo;
  detalle: string;
};

export type ActionPlan = {
  runs: { slug: string; workflowId: string }[];
  quote: number | null;
  stage: Stage | null;
  avisos: Aviso[];
  notes: string[];
};

// ¿El texto del agente menciona ese monto? ("$5,500", "5500", "5,500.00"). Un
// cliente que "dicta" un total al modelo no lo fija: solo cuenta lo que el
// agente le está diciendo al cliente.
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

export async function prepareActions(input: {
  organizationId: string;
  conversationId: string;
  calls: readonly ValidToolCall[];
  modelText: string;
  // Llegada del primer entrante que se está atendiendo: una corrida por palabra
  // clave del mismo workflow desde entonces ya mandó ese contenido (no se repite).
  pendingSince: Date | null;
}): Promise<ActionPlan> {
  const plan: ActionPlan = { runs: [], quote: null, stage: null, avisos: [], notes: [] };
  for (const c of input.calls) {
    switch (c.kind) {
      case "cotizacion":
        if (!textoMencionaMonto(input.modelText, c.monto)) plan.notes.push(`fijar_cotizacion ignorada: $${c.monto} no aparece en el texto del agente`);
        else plan.quote = c.monto;
        break;
      case "etapa":
        // Varias en una respuesta: gana la más adelantada (las demás serían retroceso o igual).
        plan.stage = plan.stage && stageIndex(plan.stage) >= stageIndex(c.etapa) ? plan.stage : c.etapa;
        break;
      case "aviso":
        plan.avisos.push({ motivo: c.aviso.motivo, detalle: (c.aviso.detalle ?? "").trim() });
        break;
      case "workflow":
        plan.runs.push({ slug: c.workflow.slug, workflowId: c.workflow.id });
        break;
    }
  }
  // Palabra clave + herramienta para el MISMO workflow ("pásame la tabla"): la
  // corrida por palabra clave ya lo manda; la del agente no se repite.
  if (input.pendingSince && plan.runs.length) {
    const dup = await db
      .select({ workflowId: workflowRuns.workflowId })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, input.organizationId),
          eq(workflowRuns.conversationId, input.conversationId),
          eq(workflowRuns.trigger, "keyword"),
          inArray(workflowRuns.workflowId, plan.runs.map((r) => r.workflowId)),
          inArray(workflowRuns.status, ["queued", "running", "done"]),
          gte(workflowRuns.createdAt, input.pendingSince),
        ),
      );
    const dupIds = new Set(dup.map((d) => d.workflowId));
    if (dupIds.size) {
      plan.notes.push(`${plan.runs.filter((r) => dupIds.has(r.workflowId)).map((r) => r.slug).join(", ")}: ${YA_SALIO_POR_PALABRA_CLAVE}`);
      plan.runs = plan.runs.filter((r) => !dupIds.has(r.workflowId));
    }
  }
  return plan;
}

const STAGE_LIST: readonly Stage[] = ["inbox", "prospecto", "interesado", "cerca_compra", "compra"];
const stageIndex = (s: Stage) => STAGE_LIST.indexOf(s);

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

// ¿Alguna de estas corridas manda algo al cliente (texto o archivo)?
export async function runsThatSend(organizationId: string, workflowIds: readonly string[]): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  const rows = await db
    .select({ workflowId: workflowSteps.workflowId })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.organizationId, organizationId), inArray(workflowSteps.workflowId, [...workflowIds]), inArray(workflowSteps.kind, ["send_text", "send_media"])));
  return new Set(rows.map((r) => r.workflowId));
}

export const MOTIVO_LABEL: Record<AvisoMotivo, string> = {
  cotejar_deposito: "Depósito recibido",
  cliente_pide_humano: "El cliente pide hablar con una persona",
  comprobante_dudoso: "Comprobante dudoso",
};

// "Depósito recibido" es FIJO (sin montos, folio ni texto del modelo: decisión del
// dueño, 25-sep-2026); los otros motivos llevan el detalle que escribió el agente.
export const DEPOSITO_RECIBIDO_BODY = "Depósito recibido. Revisa el comprobante en el hilo y el depósito en el banco antes de enviar.";

// Texto del aviso 🤖 tal como lo ve el vendedor.
export function avisoBody(a: Aviso): string {
  if (a.motivo === "cotejar_deposito") return DEPOSITO_RECIBIDO_BODY;
  return a.detalle ? `${MOTIVO_LABEL[a.motivo]}: ${a.detalle}` : `${MOTIVO_LABEL[a.motivo]}.`;
}

export type ExecutedActions = { started: string[]; skipped: string[]; notes: string[]; avisos: number; stageMoved: boolean };

/**
 * Corre el plan DESPUÉS de las burbujas. `batchMessageId` (último entrante del
 * lote) es la clave de idempotencia de los avisos; `receiptMessageId` es el
 * mensaje del cliente con la imagen o PDF del comprobante (o null).
 */
// "antes" = ANTES del texto: avisos (con registro del comprobante), cotización y
// etapa — todo idempotente, así un reintento del job tras el texto no los pierde.
// "despues" = DESPUÉS del texto: corridas de media (responder primero la duda).
export type ActionPhase = "antes" | "despues";

export async function executeActions(
  plan: ActionPlan,
  ctx: { organizationId: string; conversationId: string; contactId: string; batchMessageId: string; receiptMessageId: string | null; now: Date; since: Date | null },
  startWorkflow: StartWorkflow,
  phase: ActionPhase,
): Promise<ExecutedActions> {
  const out: ExecutedActions = { started: [], skipped: [], notes: phase === "antes" ? [...plan.notes] : [], avisos: 0, stageMoved: false };
  if (phase === "despues") {
    for (const r of plan.runs) {
      const res = await startWorkflow({ organizationId: ctx.organizationId, workflowId: r.workflowId, conversationId: ctx.conversationId, trigger: "agent", triggerMessageId: ctx.batchMessageId, now: ctx.now });
      if (res.status === "queued") out.started.push(r.slug);
      else out.skipped.push(`${r.slug}: ${res.reason ?? "omitido"}`);
    }
    return out;
  }
  // Avisos al vendedor (idempotentes por mensaje del lote + motivo). Los tres
  // motivos son estrictos: si la BD falla, se lanza y el job reintenta antes de
  // decirle nada al cliente.
  const cotejarEnviado = plan.avisos.some((a) => a.motivo === "cotejar_deposito");
  for (const a of plan.avisos) {
    const added = await addNotice({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      messageId: ctx.batchMessageId,
      kind: a.motivo,
      body: avisoBody(a),
      strict: true,
    });
    if (added) out.avisos++;
  }
  if (plan.quote !== null) {
    const ok = await setQuoteByAgent(ctx.organizationId, ctx.contactId, plan.quote);
    if (!ok) out.notes.push("cotización no guardada: la fijó un vendedor");
  }
  if (plan.stage) {
    const moved = await moveStageForward({
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      to: plan.stage,
      by: "agente",
      now: ctx.now,
      since: ctx.since ?? undefined,
      // Los workflows "al entrar a esta etapa" no repiten la media pedida en esta respuesta.
      excludeWorkflowIds: plan.runs.map((r) => r.workflowId),
    });
    out.stageMoved = moved !== null;
    // A Compra (o a Cerca de compra con comprobante) sin "Depósito recibido": el CRM lo deja igual.
    const necesitaCotejar = plan.stage === "compra" || (plan.stage === "cerca_compra" && ctx.receiptMessageId !== null);
    if (moved && necesitaCotejar && !cotejarEnviado) {
      const added = await addNotice({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        messageId: ctx.batchMessageId,
        kind: "cotejar_deposito",
        body: DEPOSITO_RECIBIDO_BODY,
        strict: true,
      });
      if (added) out.avisos++;
    }
  }
  return out;
}

// Contexto del CRM que el agente recibe con cada llamada (va en el último turno
// del cliente, no en el system: así la caché del prompt no se rompe).
export async function crmContextFor(organizationId: string, contactId: string): Promise<string> {
  const [c] = await db
    .select({ stage: contacts.stage, by: contacts.stageChangedBy, monto: contacts.montoCotizacion, customFields: contacts.customFields })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c) return "";
  const lines: string[] = [];
  const etapa = STAGE_LABEL[c.stage as Stage] ?? c.stage;
  lines.push(`Etapa actual del contacto: ${etapa}${c.by === "vendedor" ? " (la puso un vendedor: no la regreses)" : ""}.`);
  const por = (c.customFields as Record<string, unknown> | null)?.cotizacion_por;
  lines.push(
    c.monto != null
      ? `Cotización guardada: $${Number(c.monto).toLocaleString("es-MX")} MXN${por === "vendedor" ? " (fijada por un vendedor; manda sobre la tuya)" : ""}.`
      : "Cotización guardada: ninguna todavía.",
  );
  return `[CONTEXTO DEL CRM — no lo menciones literalmente]\n${lines.join("\n")}`;
}

const STAGE_LABEL: Record<Stage, string> = {
  inbox: "Inbox",
  prospecto: "Prospecto",
  interesado: "Interesado",
  cerca_compra: "Cerca de compra",
  compra: "Compra",
};
