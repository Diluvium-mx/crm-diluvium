// LECTOR del Agente IA en segundo plano (28-sep-2026, decisión del dueño): lee el chat de
// UNA conversación y deja al día la etapa y el Detalle del contacto, aunque el Agente IA
// esté apagado o pausado en ese chat. Reglas e instrucciones: lector-core.ts (puro).
// Lo corre el barrido del worker (lector-worker.ts) cuando el chat se calma, y la pasada
// única scripts/lector-detalle.ts. Nunca le escribe al cliente, no manda avisos al
// vendedor ni dispara los workflows "al entrar a esta etapa". Cada llamada deja su fila
// en ai_usage (etapa "detalle", sin message_id). Nunca lanza hacia afuera.
// Seguimientos (2-oct-2026): si el último mensaje es de la empresa, la misma lectura trae la
// ficha de seguimiento y aquí se guarda (lib/followups/store.ts, modo ensayo); si es del
// cliente, el seguimiento abierto del chat se cierra.
// Multi-tenant (CLAUDE.md §7): todo filtra por organization_id.
import { and, eq, inArray, sql } from "drizzle-orm";
import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts, conversations, messages as messagesTable, templates } from "@/lib/db/schema";
import type { CallModelInput, CallModelResult, ModelUsage } from "@/lib/ai/types";
import { getModel } from "@/lib/ai/catalog";
import { modelAvailability } from "@/lib/ai/provider";
import { listFunnelStages } from "@/lib/contacts/funnel-stages";
import { moveStageForward } from "@/lib/contacts/stage";
import { stageLabel } from "@/lib/contacts/stages";
import { DETALLE_KEY, detallePorOf, updateContactQualification } from "@/lib/contacts/qualification";
import { computeCostUsd } from "@/lib/ai/pricing";
import { setQuoteByAgent } from "./actions";
import { loadHistory, loadSnapshot, messageAt, type MessageRow } from "./context";
import { applyDetalleByAgent, detalleContextFor } from "./detalle";
import {
  buildLectorMessages,
  buildLectorSystem,
  buildLectorTools,
  evidenceFrom,
  LECTOR_MAX_MEDIA,
  LECTOR_MAX_OUTPUT_TOKENS,
  LECTOR_MODEL_ID,
  LECTOR_TIMEOUT_MS,
  lectorLockKey,
  lastIsCompany,
  parseLectorCalls,
  type LectorMessage,
} from "./lector-core";
import type { KvPort } from "./queue";
import { MAX_PDF_BYTES } from "./run";
import { fitHistory, messageText } from "./transcript";
import { effectivePrice, recordAiUsage } from "./usage";
import { allowedAgentStage, vendorAnsweredProof, ventaCerradaHeld } from "./venta-cerrada";
import { applyFollowUpReading } from "@/lib/followups/store";
import { zoneForPhone } from "@/lib/followups/timezone";
import { FOLLOW_UP_TEMPLATES } from "@/lib/followups/cases";
import { borradorProblems } from "@/lib/followups/borrador-check";
import { chatTail } from "@/lib/followups/vendor-attempts";
import { MAX_BORRADOR } from "@/lib/followups/ficha";
import { loadFollowUpTable } from "@/lib/followups/tabla-store";

export type LectorDeps = {
  now: () => Date;
  callModel: (modelId: string, input: CallModelInput) => Promise<CallModelResult>;
  // URL firmada de una imagen o PDF del bucket (o null si no se puede).
  resolveImage: (storageKey: string) => Promise<string | null>;
  // Candado por conversación (Redis): el barrido y la pasada única nunca leen el mismo chat a la vez.
  kv: KvPort;
  isModelAvailable?: (modelId: string) => boolean;
};

export type LectorOutcome =
  | { kind: "nada_nuevo" }
  | { kind: "ocupado" }
  | { kind: "error"; reason: string; usage: ModelUsage | null; costUsd: number | null }
  | { kind: "leido"; cambios: string[]; ignored: string[]; usage: ModelUsage; costUsd: number | null };

export { lectorLockKey };
const LOCK_MS = 3 * 60_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Las imágenes y PDF del cliente más recientes, con URL firmada (solo los que va a ver).
async function clientMediaUrls(rows: readonly MessageRow[], resolve: LectorDeps["resolveImage"]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (let i = rows.length - 1; i >= 0 && urls.size < LECTOR_MAX_MEDIA; i--) {
    const m = rows[i];
    if (m.direction !== "in") continue;
    for (const a of m.attachments) {
      if (urls.size >= LECTOR_MAX_MEDIA) break;
      const pdf = a.type === "document" && a.mimeType === "application/pdf" && a.sizeBytes != null && a.sizeBytes <= MAX_PDF_BYTES;
      if ((a.type !== "image" && !pdf) || !a.storageKey || urls.has(a.storageKey)) continue;
      const url = await resolve(a.storageKey).catch(() => null);
      if (url) urls.set(a.storageKey, url);
    }
  }
  return urls;
}

const pesos = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Lee UNA conversación y deja al día la ficha de su contacto. `force` (pasada única): lee
 * aunque no haya nada nuevo desde la última lectura. Marca la conversación como leída
 * hasta el último mensaje que vio (conversations.detalle_leido_hasta).
 */
export async function runLector(organizationId: string, conversationId: string, deps: LectorDeps, opts: { force?: boolean } = {}): Promise<LectorOutcome> {
  const token = crypto.randomUUID();
  if (!(await deps.kv.setNxPx(lectorLockKey(conversationId), token, LOCK_MS))) return { kind: "ocupado" };
  try {
    return await readConversation(organizationId, conversationId, deps, opts.force ?? false);
  } finally {
    await deps.kv.delIfEquals(lectorLockKey(conversationId), token).catch(() => undefined);
  }
}

// Aviso "lector.status" por el canal del tiempo real (lib/inbox/events.ts). Solo informa:
// nunca lanza ni frena la lectura.
async function announceLector(organizationId: string, contactId: string, conversationId: string, phase: "leyendo" | "listo" | "error", cambios: number): Promise<void> {
  try {
    await db.execute(sql`select pg_notify('inbox_events', json_build_object(
      'org', ${organizationId}::text, 'type', 'lector.status', 'contactId', ${contactId}::text,
      'conversationId', ${conversationId}::text, 'phase', ${phase}::text, 'cambios', ${cambios}::int
    )::text)`);
  } catch (error) {
    console.error(`[lector] no se pudo avisar "${phase}" de ${conversationId}`, error);
  }
}

async function markRead(organizationId: string, conversationId: string, upTo: Date): Promise<void> {
  await db
    .update(conversations)
    .set({ detalleLeidoHasta: sql`greatest(coalesce(${conversations.detalleLeidoHasta}, '-infinity'::timestamp), ${upTo.toISOString()}::timestamp)` })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)));
}

// Plantillas de seguimiento aprobadas del canal, con su texto, para que el lector elija la del
// 2.º y 3.er intento.
async function followUpTemplateList(organizationId: string, channelId: string): Promise<{ name: string; body: string }[]> {
  const rows = await db
    .select({ name: templates.name, body: templates.body })
    .from(templates)
    .where(
      and(
        eq(templates.organizationId, organizationId),
        eq(templates.channelId, channelId),
        eq(templates.status, "APPROVED"),
        eq(templates.unsupported, false),
        inArray(templates.name, [...FOLLOW_UP_TEMPLATES]),
      ),
    );
  const seen = new Set<string>();
  return rows.filter((r) => r.body && !seen.has(r.name) && seen.add(r.name)).map((r) => ({ name: r.name, body: r.body! }));
}

const REWRITE_TOOL = "reescribir_borrador";
const REWRITE_SYSTEM = `Eres el LECTOR del CRM de Diluvium. Ya llenaste la ficha de seguimiento de este chat, pero el borrador del mensaje no cumple las reglas. Reescribe SOLO el borrador con la herramienta ${REWRITE_TOOL}, sin texto:
- corto (1 o 2 renglones), mismo trato del chat (tú o usted), SIN saludo ni nombre al principio;
- UNA sola pregunta, que la empresa NO haya hecho ya en el chat (con ninguna palabra);
- sin repetir el precio ni la información que ya se le dio;
- si el cliente dejó una duda sin contestar, contéstala;
- según cómo terminó la conversación y lo que busca el caso; sin "hoy", "esta noche" ni "mañana"; nada genérico ni presión.
Si no hay ninguna pregunta nueva que valga la pena, manda el borrador en null.`;

/**
 * El borrador rompió las reglas (borrador-check.ts): UNA llamada más, solo para el borrador
 * (decisión del dueño, 3-oct-2026). Devuelve el borrador nuevo si ya cumple, o null.
 */
async function rewriteBorrador(
  deps: LectorDeps,
  modelId: string,
  chat: ModelMessage[],
  input: { caso: string; pendiente: string | null; siguientePaso: string | null; borrador: string; problems: string[] },
  companyTexts: string[],
  record: (usage: CallModelResult["usage"] | null, latencyMs: number, error: string | null) => Promise<void>,
): Promise<string | null> {
  const t0 = Date.now();
  try {
    const res = await deps.callModel(modelId, {
      system: REWRITE_SYSTEM,
      messages: [
        ...chat,
        {
          role: "user",
          content: `Caso: ${input.caso}. Pendiente: ${input.pendiente ?? "—"}. Siguiente paso: ${input.siguientePaso ?? "—"}.\nBorrador que no sirve: «${input.borrador}»\nPor qué: ${input.problems.join("; ")}.`,
        },
      ],
      tools: {
        [REWRITE_TOOL]: tool({
          description: "El borrador del seguimiento, corregido (null si no hay una pregunta nueva que valga la pena).",
          inputSchema: z.object({ borrador: z.string().nullable() }),
        }),
      },
      maxOutputTokens: 1_024,
      timeoutMs: LECTOR_TIMEOUT_MS,
    });
    const raw = res.toolCalls?.find((c) => c.toolName === REWRITE_TOOL)?.input as { borrador?: unknown } | undefined;
    const text = typeof raw?.borrador === "string" ? raw.borrador.trim().slice(0, MAX_BORRADOR) : "";
    const again = text ? borradorProblems({ borrador: text, companyTexts }) : ["sin borrador"];
    await record(res.usage, Date.now() - t0, again.length ? `seguimiento: borrador rehecho sigue mal (${again.join("; ")})` : "seguimiento: borrador rehecho");
    return again.length ? null : text;
  } catch (error) {
    await record(null, Date.now() - t0, `seguimiento: no se pudo rehacer el borrador (${errorText(error)})`);
    return null;
  }
}

async function readConversation(organizationId: string, conversationId: string, deps: LectorDeps, force: boolean): Promise<LectorOutcome> {
  const snap = await loadSnapshot(organizationId, conversationId);
  if (!snap) return { kind: "nada_nuevo" };
  const conv = snap.conversation;
  // Hasta dónde lee esta pasada: lo que llegue durante la llamada queda para la siguiente.
  const upTo = conv.lastMessageAt;
  if (!force && conv.detalleLeidoHasta && conv.detalleLeidoHasta >= upTo) return { kind: "nada_nuevo" };
  // Lo único nuevo son nuestros seguimientos (metadata.seguimiento): no hay nada que leer y la
  // ficha NO se rehace por su propio mensaje (docs/seguimientos.md, Parte 2).
  if (!force && conv.detalleLeidoHasta) {
    const [other] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.organizationId, organizationId),
          eq(messagesTable.conversationId, conversationId),
          sql`${messagesTable.createdAt} > ${conv.detalleLeidoHasta.toISOString()}::timestamp`,
          sql`not coalesce(${messagesTable.metadata} ? 'seguimiento', false)`,
        ),
      )
      .limit(1);
    if (!other) {
      await markRead(organizationId, conversationId, upTo);
      return { kind: "nada_nuevo" };
    }
  }
  const startedAt = deps.now();
  const model = getModel(LECTOR_MODEL_ID);
  const isAvailable = deps.isModelAvailable ?? ((id: string) => modelAvailability(id).available);
  if (!model || !isAvailable(LECTOR_MODEL_ID)) return { kind: "error", reason: `${LECTOR_MODEL_ID} no está disponible (falta la llave)`, usage: null, costUsd: null };

  const [contact] = await db
    .select({
      stage: contacts.stage,
      stageChangedBy: contacts.stageChangedBy,
      stageChangedAt: contacts.stageChangedAt,
      monto: contacts.montoCotizacion,
      pago: contacts.pagoTotal,
      customFields: contacts.customFields,
      phone: contacts.phoneE164,
    })
    .from(contacts)
    .where(and(eq(contacts.id, conv.contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) return { kind: "nada_nuevo" };

  const history = fitHistory(await loadHistory(organizationId, conversationId));
  if (history.length === 0) {
    await markRead(organizationId, conversationId, upTo);
    return { kind: "nada_nuevo" };
  }
  const rows: LectorMessage[] = history.map((m) => ({ ...m, at: messageAt(m) }));
  const stages = await listFunnelStages(organizationId);
  const vendorStage = contact.stageChangedBy === "vendedor" ? { at: contact.stageChangedAt, stageName: stageLabel(stages, contact.stage) } : null;

  // Ficha guardada: etapa, monto y pago (con quién los puso) + el Detalle.
  const cf = (contact.customFields as Record<string, unknown> | null) ?? {};
  const por = detallePorOf(cf);
  const ficha = [
    "FICHA GUARDADA (la pone el CRM; no es parte del chat):",
    `Etapa: ${stageLabel(stages, contact.stage)}${contact.stageChangedBy === "vendedor" ? " (la puso un vendedor a mano)" : ""}.`,
    `Monto de cotización: ${contact.monto != null ? `${pesos(Number(contact.monto))}${cf.cotizacion_por === "vendedor" ? " (lo corrigió un vendedor)" : ""}` : "ninguno"}.`,
    `Pago total: ${contact.pago != null ? `${pesos(Number(contact.pago))}${por[DETALLE_KEY.pagoTotal] === "vendedor" ? " (lo corrigió un vendedor)" : ""}` : "ninguno"}.`,
    await detalleContextFor(organizationId, conv.contactId),
  ].join("\n");

  const mediaUrls = await clientMediaUrls(history, deps.resolveImage);
  const { messages, sawClientMedia } = buildLectorMessages(rows, mediaUrls, { ficha, vendorStage });
  // Ficha de seguimiento: solo si el último mensaje del chat es de la empresa.
  const followUp = lastIsCompany(rows);
  const { tools, stageKeys } = buildLectorTools(stages, { followUp });
  const followUpTemplates = followUp && snap.channel.type === "whatsapp" ? await followUpTemplateList(organizationId, conv.channelId) : [];
  // «Qué busca» y la hora de cada caso: la tabla de la organización (Agente IA › Seguimientos).
  const followUpTable = followUp ? await loadFollowUpTable(organizationId) : undefined;
  const base = { organizationId, conversationId, messageId: null, stage: "detalle" as const, modelId: model.id, provider: model.provider };

  // Indicador del Detalle: "leyendo" justo antes de la llamada y, pase lo que pase, "listo"
  // (con cuántos datos cambió) o "error" al terminar. Si el proceso muere a la mitad, la UI
  // lo apaga sola a los 90 s (lector-status.tsx).
  await announceLector(organizationId, conv.contactId, conversationId, "leyendo", 0);
  let done: LectorOutcome | null = null;
  try {
    const t0 = Date.now();
    let res: CallModelResult;
    try {
      res = await deps.callModel(model.id, { system: buildLectorSystem(stages, { followUp, templates: followUpTemplates, table: followUpTable }), messages, tools, maxOutputTokens: LECTOR_MAX_OUTPUT_TOKENS, timeoutMs: LECTOR_TIMEOUT_MS });
    } catch (error) {
      await recordAiUsage({ ...base, usage: null, latencyMs: Date.now() - t0, outcome: "error", error: errorText(error) });
      return (done = { kind: "error", reason: errorText(error), usage: null, costUsd: null });
    }
    const latencyMs = Date.now() - t0;
    const costUsd = computeCostUsd(res.usage, await effectivePrice(organizationId, res.modelId, res.provider));

    const parsed = parseLectorCalls(
      res.toolCalls ?? [],
      stageKeys,
      evidenceFrom(rows, sawClientMedia),
      followUp ? { zone: zoneForPhone(contact.phone), now: deps.now() } : undefined,
    );
    const cambios: string[] = [];
    let stageNow = contact.stage;
    try {
      if (parsed.detalle) {
        const r = await applyDetalleByAgent(organizationId, conv.contactId, { campos: parsed.detalle });
        cambios.push(...r.llenados);
      }
      if (parsed.monto !== null && (contact.monto == null || Number(contact.monto) !== parsed.monto || cf.cotizacion_por !== "agente")) {
        if (await setQuoteByAgent(organizationId, conv.contactId, parsed.monto)) cambios.push("monto_cotizacion");
      }
      if (parsed.pago !== null && (contact.pago == null || Number(contact.pago) !== parsed.pago)) {
        await updateContactQualification(db, organizationId, conv.contactId, { pagoTotal: parsed.pago }, { kind: "agente" });
        cambios.push("pago_total");
      }
      // Venta cerrada solo si un vendedor contestó al comprobante del cliente
      // (venta-cerrada.ts); si no, a lo más "Cerca de compra".
      const etapa = allowedAgentStage(stages, parsed.etapa, vendorAnsweredProof(rows));
      if (parsed.etapa && etapa !== parsed.etapa) parsed.ignored.push(ventaCerradaHeld(parsed.etapa));
      if (etapa) {
        // La etapa que puso un vendedor manda: sin nada en el chat DESPUÉS de su cambio,
        // el lector no tiene con qué avanzarla (lo de antes ya lo vio el vendedor).
        const nadaDespues = vendorStage !== null && !rows.some((m) => m.at > vendorStage.at);
        if (nadaDespues) parsed.ignored.push(`etapa ${etapa}: un vendedor la puso a mano y no hay nada nuevo después`);
        else {
          const moved = await moveStageForward({
            organizationId,
            contactId: conv.contactId,
            to: etapa,
            by: "agente",
            stages,
            now: deps.now(),
            // Si un vendedor la mueve mientras el lector lee, manda el vendedor.
            since: startedAt,
            // En segundo plano nunca se le manda nada al cliente.
            fireStageTriggers: false,
          });
          if (moved) {
            cambios.push(`etapa ${moved.from} → ${etapa}`);
            stageNow = etapa;
          }
        }
      }
    } catch (error) {
      // Lo que alcanzó a guardarse se queda; la lectura se registra como error y se repite.
      await recordAiUsage({ ...base, usage: res.usage, latencyMs, outcome: "error", error: `al guardar: ${errorText(error)}` });
      return (done = { kind: "error", reason: `al guardar: ${errorText(error)}`, usage: res.usage, costUsd });
    }
    // Borrador del seguimiento: una sola pregunta, nunca una ya hecha ni el precio ya dado. Si
    // falla, se rehace una vez; si vuelve a fallar, se queda sin borrador (no sale con texto).
    const ficha = parsed.seguimiento;
    if (ficha?.borrador && ficha.caso !== "no_seguir") {
      const companyTexts = rows.filter((m) => m.direction === "out").map((m) => messageText(m));
      const problems = borradorProblems({ borrador: ficha.borrador, companyTexts });
      if (problems.length) {
        ficha.borrador = await rewriteBorrador(
          deps,
          model.id,
          messages,
          { caso: ficha.caso ?? "sin_punto_claro", pendiente: ficha.pendiente, siguientePaso: ficha.siguientePaso, borrador: ficha.borrador, problems },
          companyTexts,
          (usage, ms, note) => recordAiUsage({ ...base, usage, latencyMs: ms, outcome: usage ? "detalle_sin_cambios" : "error", error: note }),
        );
      }
    }
    // Seguimientos que ya mandó un vendedor: cuentan como intento (decisión del dueño, 3-oct-2026).
    const tail = chatTail(history.map((m) => ({ direction: m.direction, source: m.source, sentByUserId: m.sentByUserId, at: messageAt(m) })));
    // Seguimiento (modo ensayo): nunca lanza ni frena la lectura.
    const seguimiento = await applyFollowUpReading({
      organizationId,
      conversationId,
      contactId: conv.contactId,
      readUpTo: upTo,
      stopAt: tail?.stopAt ?? rows[rows.length - 1].at,
      vendorAttempts: tail?.vendorAttempts ?? [],
      lastIsCompany: followUp,
      ficha: parsed.seguimiento,
      stages,
      stageKey: stageNow,
      monto: parsed.monto ?? (contact.monto != null ? Number(contact.monto) : null),
      pago: parsed.pago ?? (contact.pago != null ? Number(contact.pago) : null),
      now: deps.now(),
    });
    await recordAiUsage({
      ...base,
      modelId: res.modelId,
      provider: res.provider,
      usage: res.usage,
      latencyMs,
      outcome: cambios.length ? "detalle_aplicado" : "detalle_sin_cambios",
      error:
        [cambios.length ? `cambios: ${cambios.join(", ")}` : "", parsed.ignored.length ? `descartado: ${parsed.ignored.join("; ")}` : "", seguimiento ?? ""]
          .filter(Boolean)
          .join(" · ") || null,
    });
    await markRead(organizationId, conversationId, upTo);
    return (done = { kind: "leido", cambios, ignored: parsed.ignored, usage: res.usage, costUsd });
  } finally {
    await announceLector(organizationId, conv.contactId, conversationId, done?.kind === "leido" ? "listo" : "error", done?.kind === "leido" ? done.cambios.length : 0);
  }
}
