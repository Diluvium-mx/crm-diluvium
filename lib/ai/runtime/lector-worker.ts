// Barrido del LECTOR en segundo plano (28-sep-2026). Cada minuto busca los chats con algo
// nuevo que leer y los pasa por el lector (lector.ts), pocos a la vez. No depende de los
// ganchos de la ingesta ni del envío: cualquier mensaje (del cliente, de un vendedor desde
// el CRM o el celular, del Agente IA o de un workflow) mueve last_message_at, y eso basta.
// Si el worker estuvo caído, al volver se pone al día solo.
//
// Cuándo lee: cuando el chat se CALMA (LECTOR_QUIET_MS sin mensajes), para leer una vez
// todo lo que pasó y no una vez por mensaje; en un chat que no para, a más tardar
// LECTOR_MAX_WAIT_MS después del primer mensaje sin leer. Solo actividad de los últimos
// días: lo viejo ya quedó marcado como leído en la migración 0047.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { LectorDeps, LectorOutcome } from "./lector";
import { runLector } from "./lector";
import { LECTOR_EVERY_MS, LECTOR_LOOKBACK_DAYS, LECTOR_MAX_WAIT_MS, LECTOR_QUIET_MS } from "./lector-core";

export { LECTOR_EVERY_MS, LECTOR_LOOKBACK_DAYS, LECTOR_MAX_WAIT_MS, LECTOR_QUIET_MS };
export const LECTOR_BATCH = 20;
export const LECTOR_CONCURRENCY = 3;
// Tras 3 fallas seguidas en el mismo chat se deja de intentar hasta el siguiente mensaje.
export const LECTOR_MAX_FAILURES = 3;

export type DueConversation = { conversationId: string; organizationId: string; lastMessageAt: Date };

export async function findDueConversations(now: Date, limit = LECTOR_BATCH): Promise<DueConversation[]> {
  const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;
  const quiet = new Date(now.getTime() - LECTOR_QUIET_MS);
  const maxWait = new Date(now.getTime() - LECTOR_MAX_WAIT_MS);
  const since = new Date(now.getTime() - LECTOR_LOOKBACK_DAYS * 24 * 60 * 60_000);
  const rows = await db.execute<{ id: string; organization_id: string; last_ms: number }>(sql`
    select c.id, c.organization_id, (extract(epoch from c.last_message_at) * 1000)::float8 as last_ms
    from conversations c
    where c.last_message_at > coalesce(c.detalle_leido_hasta, '-infinity'::timestamp)
      and c.last_message_at > ${ts(since)}
      and (
        c.last_message_at <= ${ts(quiet)}
        -- Mismo reloj que last_message_at / detalle_leido_hasta: la hora del mensaje (sent_at, la que da
        -- WhatsApp), no la de llegada (created_at, unos segundos después). Con created_at el último mensaje del
        -- cliente parecía «sin leer» para siempre y el chat se leía AL INSTANTE, sin los 3 min de calma (7-oct-2026).
        or (
          select min(coalesce(m.sent_at, m.created_at)) from messages m
          where m.organization_id = c.organization_id and m.conversation_id = c.id
            and coalesce(m.sent_at, m.created_at) > coalesce(c.detalle_leido_hasta, '-infinity'::timestamp)
        ) <= ${ts(maxWait)}
      )
    order by c.last_message_at asc
    limit ${limit}
  `);
  return rows.map((r) => ({ conversationId: r.id, organizationId: r.organization_id, lastMessageAt: new Date(Number(r.last_ms)) }));
}

function describe(o: LectorOutcome): string {
  switch (o.kind) {
    case "leido":
      return `${o.cambios.length ? `cambios: ${o.cambios.join(", ")}` : "sin cambios"}${o.ignored.length ? ` · descartado: ${o.ignored.join("; ")}` : ""}`;
    case "error":
      return `error: ${o.reason}`;
    default:
      return o.kind;
  }
}

// Fallas por chat y mensaje (en memoria: un reinicio del worker da otra oportunidad).
const failures = new Map<string, { at: number; count: number }>();

export async function lectorSweepOnce(deps: LectorDeps, now: Date): Promise<number> {
  const due = (await findDueConversations(now)).filter((d) => {
    const f = failures.get(d.conversationId);
    return !f || f.at !== d.lastMessageAt.getTime() || f.count < LECTOR_MAX_FAILURES;
  });
  let done = 0;
  for (let i = 0; i < due.length; i += LECTOR_CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + LECTOR_CONCURRENCY).map(async (d) => {
        const outcome = await runLector(d.organizationId, d.conversationId, deps).catch(
          (error: unknown): LectorOutcome => ({ kind: "error", reason: error instanceof Error ? error.message : String(error), usage: null, costUsd: null }),
        );
        if (outcome.kind === "error") {
          const prev = failures.get(d.conversationId);
          const count = prev && prev.at === d.lastMessageAt.getTime() ? prev.count + 1 : 1;
          failures.set(d.conversationId, { at: d.lastMessageAt.getTime(), count });
          console.error(`[lector] ${d.conversationId}: ${describe(outcome)} (falla ${count}/${LECTOR_MAX_FAILURES})`);
          return;
        }
        failures.delete(d.conversationId);
        if (outcome.kind === "leido") {
          done++;
          console.info(`[lector] ${d.conversationId}: ${describe(outcome)}`);
        }
      }),
    );
  }
  return done;
}

export function startLectorRuntime(deps: LectorDeps) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const tick = async () => {
    // Un barrido largo (muchos chats a la vez) no se encima con el siguiente.
    if (running) return;
    running = true;
    try {
      await lectorSweepOnce(deps, deps.now());
    } catch (error) {
      console.error("[lector] barrido falló", error);
    } finally {
      running = false;
    }
  };
  return {
    // Solo tras las migraciones (usa conversations.detalle_leido_hasta).
    run: () => {
      timer = setInterval(() => void tick(), LECTOR_EVERY_MS);
      console.info(`[lector] barrido cada ${LECTOR_EVERY_MS / 1000} s (etapa y Detalle en segundo plano con Luna)`);
    },
    close: async () => {
      if (timer) clearInterval(timer);
      // Espera (acotada) a que termine una lectura en curso.
      for (let i = 0; running && i < 50; i++) await new Promise((r) => setTimeout(r, 200));
    },
  };
}
