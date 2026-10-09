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
import { foreignLadaLine } from "@/lib/phone";
import { contacts, workflowRuns, workflows, workflowSteps } from "@/lib/db/schema";
import { moveStageForward } from "@/lib/contacts/stage";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { notifyContactUpdated } from "@/lib/contacts/notify-updated";
import { furthestStage, roleKey, stageLabel, type FunnelStage } from "@/lib/contacts/stages";
import type { StartRunInput, StartRunResult } from "@/lib/workflows/executor";
import { startOnlyEligible } from "@/lib/workflows/start-only";
import { takesAgentCaption } from "@/lib/workflows/steps";
import { sendsByWorkflow } from "@/lib/workflows/max-per-chat";
import { addNotice, hasOpenHandoverRequest } from "./notices";
import { amountsIn, isBackedAmount } from "./lector-core";
import { buildAgentTools, type AgentTools, type AvisoMotivo, type ValidToolCall } from "./tools";
import { allowedAgentStage, ventaCerradaHeld } from "./venta-cerrada";

// Nota que NO se muestra al vendedor (Fase E, pendiente F): la media ya salió para este mensaje
// (por la palabra clave del cliente o, desde el 9-oct-2026, por el propio Agente IA antes del
// complemento) y el agente la pidió otra vez; no le pide nada al vendedor. Solo queda en el log.
export const YA_SALIO_PARA_ESTE_MENSAJE = "ya salió para este mensaje";
export function noteForVendor(note: string): boolean {
  return !note.endsWith(YA_SALIO_PARA_ESTE_MENSAJE);
}

export type StartWorkflow = (input: StartRunInput) => Promise<StartRunResult>;

// Herramientas de la organización en orden estable (position): workflows de
// media habilitados con disparador "agente", más mover_etapa con las etapas vigentes.
// Con la conversación, no se ofrece (el modelo no promete algo que no saldría):
// - un workflow «Solo al inicio» ESTRICTO que ya no aplica (ya le contestaron o ya le salió a
//   este contacto); el de «solo al inicio por palabra clave» (la Tabla) sí se ofrece;
// - uno que ya llegó a su «Máximo de envíos por chat» (29-sep-2026).
export async function loadAgentTools(
  organizationId: string,
  stages: readonly FunnelStage[],
  conversation?: { id: string; contactId: string },
): Promise<AgentTools> {
  const all = await db
    .select({
      id: workflows.id,
      slug: workflows.slug,
      name: workflows.name,
      description: workflows.agentDescription,
      startOnly: workflows.triggerStartOnly,
      startOnlyAgent: workflows.triggerStartOnlyAgent,
      maxSendsPerChat: workflows.maxSendsPerChat,
    })
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
  const startOnly = all.filter((w) => w.startOnly && w.startOnlyAgent).map((w) => w.id);
  const eligible =
    conversation && startOnly.length ? await startOnlyEligible(organizationId, conversation.id, conversation.contactId, startOnly) : new Set<string>();
  const sent = conversation ? await sendsByWorkflow(organizationId, conversation.id, all) : new Map<string, number>();
  const rows = all.filter(
    (w) => (!(w.startOnly && w.startOnlyAgent) || eligible.has(w.id)) && !(w.maxSendsPerChat && (sent.get(w.id) ?? 0) >= w.maxSendsPerChat),
  );
  return buildAgentTools(rows, stages);
}

export type Aviso = {
  motivo: AvisoMotivo;
  detalle: string;
};

export type ActionPlan = {
  runs: { slug: string; workflowId: string }[];
  quote: number | null;
  /** Clave de la etapa destino (la más adelantada si el modelo pidió varias). */
  stage: string | null;
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

// ¿Se puede fijar ese total? Si el agente lo dice en su texto, o si sale de los precios que la
// EMPRESA ya le dio al cliente en el chat (Agente IA, workflows o vendedor): la cantidad o la suma de
// hasta 4, la misma regla que el lector en segundo plano (lector-core.ts). Lo que dicta el cliente
// sigue sin contar. Caso 1-oct-2026: «Precio 2» dijo $5,500 y el agente, en complemento, no tenía
// nada que agregar pero fijó $5,500: el CRM lo ignoraba y dejaba una tarjeta amarilla falsa (33 desde
// el 27-sep, 29 seguían amarillas).
export function quoteBacked(monto: number, modelText: string, companyTexts: readonly string[]): boolean {
  if (textoMencionaMonto(modelText, monto)) return true;
  return isBackedAmount(monto, [modelText, ...companyTexts].flatMap(amountsIn));
}

export async function prepareActions(input: {
  organizationId: string;
  conversationId: string;
  calls: readonly ValidToolCall[];
  modelText: string;
  /** Lo que la empresa (Agente IA, workflows, vendedor) ya le dijo al cliente en el chat que leyó el modelo. */
  companyTexts?: readonly string[];
  // Llegada del primer entrante que se está atendiendo: una corrida por palabra
  // clave del mismo workflow desde entonces ya mandó ese contenido (no se repite).
  pendingSince: Date | null;
  /** Etapas vigentes de la organización (orden para "gana la más adelantada"). */
  stages: readonly FunnelStage[];
}): Promise<ActionPlan> {
  const plan: ActionPlan = { runs: [], quote: null, stage: null, avisos: [], notes: [] };
  for (const c of input.calls) {
    switch (c.kind) {
      case "cotizacion":
        if (!quoteBacked(c.monto, input.modelText, input.companyTexts ?? [])) {
          plan.notes.push(`fijar_cotizacion ignorada: $${c.monto} no aparece en el texto del agente ni sale de los precios que la empresa le dio en el chat`);
        }
        else plan.quote = c.monto;
        break;
      case "etapa":
        // Varias en una respuesta: gana la más adelantada (las demás serían retroceso o igual).
        plan.stage = furthestStage(input.stages, plan.stage ? [plan.stage, c.etapa] : [c.etapa]);
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
  // corrida por palabra clave ya lo manda; la del agente no se repite. Igual con una corrida del
  // propio Agente IA para estos mensajes (9-oct-2026): en el complemento de un workflow «es la
  // respuesta» (con archivos o con textos), el workflow ya salió y no se vuelve a mandar.
  if (input.pendingSince && plan.runs.length) {
    const dup = await db
      .select({ workflowId: workflowRuns.workflowId })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, input.organizationId),
          eq(workflowRuns.conversationId, input.conversationId),
          inArray(workflowRuns.trigger, ["keyword", "agent"]),
          inArray(workflowRuns.workflowId, plan.runs.map((r) => r.workflowId)),
          inArray(workflowRuns.status, ["queued", "running", "done"]),
          gte(workflowRuns.createdAt, input.pendingSince),
        ),
      );
    const dupIds = new Set(dup.map((d) => d.workflowId));
    if (dupIds.size) {
      plan.notes.push(`${plan.runs.filter((r) => dupIds.has(r.workflowId)).map((r) => r.slug).join(", ")}: ${YA_SALIO_PARA_ESTE_MENSAJE}`);
      plan.runs = plan.runs.filter((r) => !dupIds.has(r.workflowId));
    }
  }
  return plan;
}

// Guarda el total cotizado por el AGENTE. Desde el 26-sep-2026 (regla del dueño: ningún
// dato del Detalle es definitivo) también corrige uno que puso un vendedor: el total que
// el agente le acaba de decir al cliente es el vigente. Sin cambio si ya es ese monto.
// El aviso en vivo (contact.updated) sale en la misma transacción que la escritura.
export async function setQuoteByAgent(organizationId: string, contactId: string, monto: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(contacts)
      .set({
        montoCotizacion: monto.toFixed(2),
        customFields: sql`${contacts.customFields} || '{"cotizacion_por":"agente"}'::jsonb`,
      })
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.organizationId, organizationId),
          sql`(${contacts.montoCotizacion} is distinct from ${monto.toFixed(2)}::numeric or ${contacts.customFields}->>'cotizacion_por' is distinct from 'agente')`,
        ),
      )
      .returning({ id: contacts.id });
    if (rows.length > 0) await notifyContactUpdated(tx, { organizationId, contactId, changes: ["cotizacion"], by: { kind: "agente" } });
    return rows.length > 0;
  });
}

// ¿El monto guardado lo puso un vendedor (o ya estaba, sin origen)? Entonces el del
// agente solo lo reemplaza cuando el mensaje con ese total SÍ salió (run.ts): si el
// envío falla o pausan al agente, el cliente nunca oyó el total nuevo y el del vendedor
// se queda (revisión de Codex, 26-sep-2026).
export async function quoteSetByVendor(organizationId: string, contactId: string): Promise<boolean> {
  const [c] = await db
    .select({ monto: contacts.montoCotizacion, customFields: contacts.customFields })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c || c.monto === null) return false;
  return (c.customFields as Record<string, unknown> | null)?.cotizacion_por !== "agente";
}

// «El workflow es la respuesta» como herramienta (29-sep-2026, dueño: «Depende»): de estos
// workflows, los marcados que mandan algo (texto o archivo). Con uno así, el workflow es la
// respuesta y el texto del modelo no sale (no se le dice lo mismo dos veces); el workflow contesta
// SU tema y, cuando sale su último mensaje, el agente revisa el mismo mensaje del cliente y contesta
// solo lo que haya preguntado aparte (complemento, como por palabra clave; run.ts).
// - Solo archivos (9-oct-2026, dueño, caso «Dónde medir»): antes la frase del agente iba como pie
//   del archivo en lugar del pie del workflow (1-oct-2026); ahora sale el pie del workflow tal cual.
// - Con textos (9-oct-2026, dueño, caso «Entrada mayor a 2.5 m»): igual que con archivos. Antes
//   su último mensaje contestaba todo lo que el agente leyó y lo demás del mensaje se perdía.
export async function answerRunsOf(organizationId: string, workflowIds: readonly string[]): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ workflowId: workflowSteps.workflowId })
    .from(workflowSteps)
    .innerJoin(workflows, and(eq(workflows.id, workflowSteps.workflowId), eq(workflows.organizationId, organizationId)))
    .where(
      and(
        eq(workflowSteps.organizationId, organizationId),
        inArray(workflowSteps.workflowId, [...workflowIds]),
        inArray(workflowSteps.kind, ["send_text", "send_media"]),
        eq(workflows.isAnswer, true),
      ),
    );
  return new Set(rows.map((r) => r.workflowId));
}

// Texto del Agente IA como pie del archivo (1-oct-2026, dueño): la PRIMERA corrida que pidió, si
// solo manda archivos (un video, la Tabla; esperas aparte). Solo la primera: así el orden de las
// corridas no cambia.
export async function captionRunOf(organizationId: string, runs: ActionPlan["runs"]): Promise<ActionPlan["runs"][number] | null> {
  const first = runs[0];
  if (!first) return null;
  const steps = await db
    .select({ payload: workflowSteps.payload })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.organizationId, organizationId), eq(workflowSteps.workflowId, first.workflowId)))
    .orderBy(asc(workflowSteps.position));
  return takesAgentCaption(steps.map((s) => s.payload)) ? first : null;
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

/** Etapa a la que de verdad se movió (`stageTo`): la venta cerrada puede quedar en "Cerca de compra". */
export type ExecutedActions = { started: string[]; skipped: string[]; notes: string[]; avisos: number; stageMoved: boolean; stageTo: string | null };

/**
 * `batchMessageId` (último entrante del lote) es la clave de idempotencia de los
 * avisos; `receiptMessageId` es el mensaje del cliente con la imagen o PDF del
 * comprobante (o null); `vendorConfirmedPayment`: en el chat que leyó el modelo, un
 * vendedor ya contestó a un comprobante del cliente (venta-cerrada.ts). Sin él, la
 * etapa de venta cerrada no se pone.
 */
export type ActionContext = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  batchMessageId: string;
  receiptMessageId: string | null;
  now: Date;
  since: Date | null;
  vendorConfirmedPayment?: boolean;
};
// "antes" = ANTES del texto: avisos (con registro del comprobante), cotización y
// etapa — todo idempotente, así un reintento del job tras el texto no los pierde.
// "despues" = DESPUÉS del texto: corridas de media (responder primero la duda).
export type ActionPhase = "antes" | "despues";

export async function executeActions(
  plan: ActionPlan,
  ctx: ActionContext,
  startWorkflow: StartWorkflow,
  phase: ActionPhase,
): Promise<ExecutedActions> {
  const out: ExecutedActions = { started: [], skipped: [], notes: phase === "antes" ? [...plan.notes] : [], avisos: 0, stageMoved: false, stageTo: null };
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
    if (a.motivo === "cliente_pide_humano" && (await hasOpenHandoverRequest(ctx.organizationId, ctx.conversationId))) {
      console.info(`[agente] ${ctx.conversationId}: ya hay un aviso «pide hablar con una persona» abierto; no se repite`);
      continue;
    }
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
    if (!ok) console.info(`[agente] ${ctx.conversationId}: la cotización ya era $${plan.quote}`);
  }
  if (plan.stage) {
    // Las etapas se releen aquí (no del plan): si alguien borró o reordenó columnas
    // entre la llamada al modelo y ahora, manda lo que hay en la base.
    const stages = await listFunnelStages(ctx.organizationId);
    const ventaCerrada = roleKey(stages, "venta_cerrada");
    const cercaCompra = roleKey(stages, "cerca_compra");
    // Venta cerrada solo si un VENDEDOR ya contestó al comprobante del cliente (2-oct-2026,
    // regla del dueño; venta-cerrada.ts). Si no, el contacto va a lo más a "Cerca de
    // compra" y el vendedor recibe el aviso de abajo para revisar el pago y confirmarlo.
    const to = allowedAgentStage(stages, plan.stage, ctx.vendorConfirmedPayment ?? false);
    const held = to !== plan.stage;
    if (held) console.info(`[agente] ${ctx.conversationId}: ${ventaCerradaHeld(plan.stage)}`);
    const moved = to
      ? await moveStageForward({
          organizationId: ctx.organizationId,
          contactId: ctx.contactId,
          to,
          by: "agente",
          now: ctx.now,
          since: ctx.since ?? undefined,
          stages,
          // Los workflows "al entrar a esta etapa" no repiten la media pedida en esta respuesta.
          excludeWorkflowIds: plan.runs.map((r) => r.workflowId),
        })
      : null;
    out.stageMoved = moved !== null;
    out.stageTo = moved ? to : null;
    // A la etapa de VENTA CERRADA (o a la de CERCA DE COMPRA con comprobante) sin "Depósito
    // recibido": el CRM deja un aviso igual. "Depósito recibido" solo si el cliente mandó
    // imagen o PDF; sin adjunto, un aviso neutral. Con "Comprobante dudoso" en la misma
    // respuesta no se agrega nada (el vendedor no debe ver "dudoso" y "recibido" juntos).
    // Venta cerrada frenada con comprobante en este mensaje: "Depósito recibido" aunque el
    // contacto ya estuviera en "Cerca de compra" (el vendedor es quien lo confirma).
    const necesitaCotejar = plan.stage === ventaCerrada || (plan.stage === cercaCompra && ctx.receiptMessageId !== null);
    const dudoso = plan.avisos.some((a) => a.motivo === "comprobante_dudoso");
    if ((moved || (held && ctx.receiptMessageId !== null)) && necesitaCotejar && !cotejarEnviado && !dudoso) {
      const added = await addNotice({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        messageId: ctx.batchMessageId,
        kind: "cotejar_deposito",
        body:
          ctx.receiptMessageId !== null
            ? DEPOSITO_RECIBIDO_BODY
            : `El agente movió al contacto a ${stageLabel(stages, to ?? plan.stage)} sin comprobante en este mensaje. Revisa el hilo y el depósito en el banco antes de enviar.`,
        strict: true,
      });
      if (added) out.avisos++;
    }
  }
  return out;
}

// Contexto del CRM que el agente recibe con cada llamada (va en el último turno
// del cliente, no en el system: así la caché del prompt no se rompe).
// `stages`: columnas vigentes (nombre de la etapa por su clave). `avanzaA` (27-sep-2026):
// traspaso del Modelo 1 al Modelo 2. El Modelo 1 ya decidió que con este mensaje el
// contacto pasa a esa etapa (clave); el Modelo 2 escribe la respuesta.
export async function crmContextFor(organizationId: string, contactId: string, stages: readonly FunnelStage[], avanzaA: string | null = null): Promise<string> {
  const [c] = await db
    .select({
      stage: contacts.stage,
      by: contacts.stageChangedBy,
      monto: contacts.montoCotizacion,
      customFields: contacts.customFields,
      iso: contacts.phoneCountryIso,
      code: contacts.phoneCountryCode,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c) return "";
  const lines: string[] = [];
  const etapa = stageLabel(stages, c.stage);
  lines.push(`Etapa actual del contacto: ${etapa}${c.by === "vendedor" ? " (la puso un vendedor: no la regreses)" : ""}.`);
  if (avanzaA) {
    lines.push(`Con lo que acaba de escribir el cliente, el contacto pasa a ${stageLabel(stages, avanzaA)}: contesta este mensaje como corresponde a esa etapa, con las acciones que hagan falta.`);
  }
  const por = (c.customFields as Record<string, unknown> | null)?.cotizacion_por;
  lines.push(
    c.monto != null
      ? `Cotización guardada: $${Number(c.monto).toLocaleString("es-MX")} MXN${por === "vendedor" ? " (la corrigió un vendedor)" : ""}.`
      : "Cotización guardada: ninguna todavía.",
  );
  // País por la lada (6-oct-2026): el Agente IA no veía el teléfono y cotizó a un cliente de
  // España como si fuera de México. El Goal (CLIENTES EN EL EXTRANJERO) dice qué hacer.
  const lada = foreignLadaLine(c.iso, c.code);
  if (lada) lines.push(lada);
  return `[CONTEXTO DEL CRM — no lo menciones literalmente]\n${lines.join("\n")}`;
}
