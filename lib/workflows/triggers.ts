// Disparadores humanos y de cliente (Fase D, A6). Todos AISLADOS: nunca
// lanzan; un fallo aquí no debe romper la ingesta ni un cambio de etapa. El
// ejecutor decide (modo del canal, una vez por conversación) y deja rastro.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, conversations, messages, workflows } from "@/lib/db/schema";
import { startWorkflowRun, type StartRunResult } from "./executor";
import { matchesKeyword, parseCommand } from "./steps";
import { markKeywordChecked, pendingKeywordMessages } from "./keyword-pending";
import { startOnlyEligible } from "./start-only";
import { atMaxPerChat } from "./max-per-chat";
import { fixedRuleWinner, PRECIO_Y_MEDIDAS } from "./fixed-rules";
import { foreignLadaLine } from "@/lib/phone";

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
    if (!msg || msg.direction !== "in" || msg.type !== "text" || !msg.body) {
      if (msg) await markKeywordChecked(m);
      return null;
    }
    const rows = await db
      .select({
        id: workflows.id,
        slug: workflows.slug,
        keywords: workflows.triggerKeywords,
        position: workflows.position,
        startOnly: workflows.triggerStartOnly,
        maxSendsPerChat: workflows.maxSendsPerChat,
      })
      .from(workflows)
      .where(and(eq(workflows.organizationId, m.organizationId), eq(workflows.enabled, true)))
      .orderBy(workflows.position);
    const body = msg.body;
    const hits = rows.flatMap((wf) => {
      const hit = wf.keywords.length ? matchesKeyword(body, wf.keywords) : null;
      return hit ? [{ ...wf, len: hit.length }] : [];
    });
    const [conv] = await db
      .select({ contactId: conversations.contactId, keywordSent: contacts.keywordWorkflowsSent, iso: contacts.phoneCountryIso })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(conversations.id, m.conversationId), eq(conversations.organizationId, m.organizationId)))
      .limit(1);
    // Regla fija «precio y medidas» (lib/workflows/fixed-rules.ts): «Información» puede ganar sin
    // tener la palabra clave, así que también se revisa si puede salir.
    const ruleWinner = rows.find((w) => w.slug === PRECIO_Y_MEDIDAS.gana) ?? null;
    // «Solo al inicio» (las dos opciones: por palabra clave siempre aplica): uno que ya no aplica
    // (ya le contestaron o ya le salió a este contacto) no compite; así el mensaje puede disparar
    // otro workflow que también coincida. Igual uno que ya llegó a su «Máximo de envíos por chat».
    const startOnly = [...hits, ...(ruleWinner ? [ruleWinner] : [])].filter((h) => h.startOnly).map((h) => h.id);
    // Lada de otro país (6-oct-2026, dueño): las respuestas de inicio («Información», «Precio 2»…)
    // no salen; contesta el Agente IA con CLIENTES EN EL EXTRANJERO del Goal (primero pregunta si
    // tiene dirección en México, antes de cotizar). Los demás workflows por palabra clave, igual.
    const foreign = foreignLadaLine(conv?.iso, null) !== null;
    if (foreign && startOnly.length) console.info(`[workflows] ${m.conversationId}: lada de otro país; las respuestas de inicio no salen (contesta el Agente IA)`);
    const eligible = startOnly.length && conv && !foreign ? await startOnlyEligible(m.organizationId, m.conversationId, conv.contactId, startOnly) : new Set<string>();
    const canFire = async (w: { id: string; startOnly: boolean; maxSendsPerChat: number | null }) =>
      !(w.startOnly && !eligible.has(w.id)) && !(await atMaxPerChat(m.organizationId, m.conversationId, w, { includeLive: true }));
    const competing: typeof hits = [];
    for (const h of hits) if (await canFire(h)) competing.push(h);
    // La frase MÁS específica gana entre TODOS los workflows ("video a la
    // medida" del especial le gana a "video" del estándar); `position` desempata.
    let best: { id: string; len: number } | null = null;
    for (const h of competing) {
      if (!best || h.len > best.len) best = { id: h.id, len: h.len };
    }
    // Regla fija del dueño: si este mensaje dispararía «Precio 2» y la Tabla a la vez, sale «Información».
    const sent = new Set(conv?.keywordSent ?? []);
    const firing = new Set(competing.filter((h) => !sent.has(h.id)).map((h) => h.slug));
    const ruleOk = Boolean(ruleWinner && firing.size > 1 && !sent.has(ruleWinner.id) && (await canFire(ruleWinner)));
    if (ruleWinner && fixedRuleWinner(firing, () => ruleOk)) {
      console.info(`[workflows] ${m.conversationId}: el mensaje dispararía «Precio 2» y la Tabla; sale «Información» (regla fija)`);
      best = { id: ruleWinner.id, len: 0 };
    }
    if (!best) {
      await markKeywordChecked(m);
      return null;
    }
    // Con el id del mensaje: si el barrido lo vuelve a evaluar, la corrida no se duplica (0046).
    const result = await startWorkflowRun({
      organizationId: m.organizationId,
      workflowId: best.id,
      conversationId: m.conversationId,
      trigger: "keyword",
      payload: { mensaje: msg.body.slice(0, 200) },
      triggerMessageId: m.messageId,
    });
    await markKeywordChecked(m);
    return result;
  } catch (error) {
    // Sin marcar "revisada": el barrido lo retoma (1–30 min).
    console.error(`[workflows] disparador por palabra clave falló (${m.conversationId}); el mensaje ya está guardado`, error);
    return null;
  }
}

/**
 * Barrido (B1): palabras clave que quedaron "pendiente" porque el worker se reinició entre el
 * commit del mensaje y el gancho. Devuelve cuántos mensajes se volvieron a evaluar.
 */
export async function sweepPendingKeywords(now = new Date()): Promise<number> {
  const pending = await pendingKeywordMessages(now);
  for (const m of pending) await onInboundKeyword(m);
  return pending.length;
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
  /** Workflows que ya salen en la misma respuesta del agente: no se repiten por etapa. */
  excludeWorkflowIds?: readonly string[];
  /** Quién movió la etapa: "vendedor" (o ausente) → corridas "stage"; "agente"/"sistema" → "agent". */
  by?: "vendedor" | "agente" | "sistema";
}): Promise<StartRunResult[]> {
  try {
    const exclude = new Set(input.excludeWorkflowIds ?? []);
    const rows = (
      await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(
            eq(workflows.organizationId, input.organizationId),
            eq(workflows.enabled, true),
            eq(workflows.triggerStage, input.stage as (typeof workflows.$inferSelect)["triggerStage"] & string),
          ),
        )
        .orderBy(workflows.position)
    ).filter((w) => !exclude.has(w.id));
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
          trigger: input.by === "agente" || input.by === "sistema" ? "agent" : "stage",
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
 * Comando del vendedor en el composer ("/tamaños"). Devuelve null si el texto no
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
