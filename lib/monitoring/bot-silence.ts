// Datos de "¿el bot está contestando?" desde la BASE del CRM (sin Zernio): la alarma
// "bot callado" de los dos vigilantes (worker cada 5 min y /api/health/inbound para la
// Action), la pastilla "Bot" del Dashboard y la franja de la Bandeja. Reglas: ./bot-status.ts.
// Lo que el bot tendría que haber contestado sale de la MISMA consulta que su barrido
// (findUnansweredForMonitor): mismas exclusiones (pausado, tarjeta de error sin atender,
// lo escrito antes de encender o reactivar, lo ya decidido por el agente).
// Sin "server-only": lo importa el worker (Node puro).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, channels, messages } from "@/lib/db/schema";
import { botScheduleSchema, type BotSchedule } from "@/lib/agente-ia/opciones";
import { findUnansweredForMonitor, type UnansweredForMonitor } from "@/lib/ai/runtime/sweep";
import {
  botSilenceProblem,
  botSilenceThresholds,
  botStatus,
  type BotBannerData,
  type BotChannel,
  type BotSilenceThresholds,
} from "./bot-status";
import type { PillStatus } from "./status-pill";

const DAY_MS = 24 * 3_600_000;

type OrgChannel = BotChannel & { organizationId: string };

/** Canales que se vigilan (los mismos que la pastilla de WhatsApp): Zernio, activos, no archivados. */
async function watchedChannels(organizationId?: string): Promise<OrgChannel[]> {
  const rows = await db
    .select({ organizationId: channels.organizationId, displayName: channels.displayName, mode: channels.aiAgentMode })
    .from(channels)
    .where(
      and(
        eq(channels.provider, "zernio"),
        eq(channels.isActive, true),
        isNull(channels.archivedAt),
        organizationId ? eq(channels.organizationId, organizationId) : undefined,
      ),
    )
    .orderBy(channels.createdAt);
  // Solo "auto" (Encendido) contesta; "borrador" ya no existe y cuenta como apagado.
  return rows.map((r) => ({ organizationId: r.organizationId, displayName: r.displayName, on: r.mode === "auto" }));
}

/** Horario del bot por organización, con la MISMA lectura que el runtime (un valor inválido = 24/7). */
async function schedulesOf(orgIds: string[]): Promise<Map<string, BotSchedule | null>> {
  if (orgIds.length === 0) return new Map();
  const rows = await db
    .select({ organizationId: aiConfig.organizationId, botSchedule: aiConfig.botSchedule })
    .from(aiConfig)
    .where(inArray(aiConfig.organizationId, orgIds));
  return new Map(
    rows.map((r) => {
      const parsed = botScheduleSchema.safeParse(r.botSchedule);
      return [r.organizationId, parsed.success ? parsed.data : null];
    }),
  );
}

/** Última respuesta del bot (saliente del agente que no falló) por organización, en 24 h. */
async function lastBotReplies(now: Date, orgIds: string[]): Promise<Map<string, Date>> {
  if (orgIds.length === 0) return new Map();
  const rows = await db
    .select({
      organizationId: messages.organizationId,
      // created_at es UTC sin zona: epoch en SQL para no depender del parser del driver.
      ms: sql<number | null>`(extract(epoch from max(${messages.createdAt})) * 1000)::float8`,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.organizationId, orgIds),
        eq(messages.direction, "out"),
        eq(messages.source, "ai_agent"),
        sql`${messages.status} <> 'failed' and ${messages.type} <> 'system_note'`,
        sql`${messages.createdAt} > ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamp`,
      ),
    )
    .groupBy(messages.organizationId);
  return new Map(rows.flatMap((r) => (r.ms != null ? [[r.organizationId, new Date(r.ms)] as const] : [])));
}

type OrgSnapshot = {
  organizationId: string;
  channels: OrgChannel[];
  schedule: BotSchedule | null;
  waiting: UnansweredForMonitor[];
  lastBotReplyAt: Date | null;
};

async function snapshots(now: Date, thresholds: BotSilenceThresholds, organizationId?: string): Promise<OrgSnapshot[]> {
  const list = await watchedChannels(organizationId);
  const orgIds = [...new Set(list.map((c) => c.organizationId))];
  if (orgIds.length === 0) return [];
  const [schedules, replies, waiting] = await Promise.all([
    schedulesOf(orgIds),
    lastBotReplies(now, orgIds),
    findUnansweredForMonitor(now, { olderThan: new Date(now.getTime() - thresholds.minutes * 60_000), organizationId }),
  ]);
  return orgIds.map((org) => ({
    organizationId: org,
    channels: list.filter((c) => c.organizationId === org),
    schedule: schedules.get(org) ?? null,
    waiting: waiting.filter((w) => w.organizationId === org),
    lastBotReplyAt: replies.get(org) ?? null,
  }));
}

export type BotSilenceReport = {
  problems: string[];
  /** Solo conteos (el issue es público). */
  metrics: { waiting: number; silentOrganizations: number; lastReplyMinutesAgo: number | null };
};

/** Revisión de los vigilantes (todas las organizaciones). */
export async function checkBotSilence(input: { now?: Date; env?: Record<string, string | undefined> } = {}): Promise<BotSilenceReport> {
  const now = input.now ?? new Date();
  const thresholds = botSilenceThresholds(input.env ?? process.env);
  const problems: string[] = [];
  let waiting = 0;
  let silentOrganizations = 0;
  let lastReply: Date | null = null;
  for (const org of await snapshots(now, thresholds)) {
    // Canal Apagado: el bot no tiene que contestar ahí (lo muestran la pastilla y la franja).
    if (!org.channels.some((c) => c.on)) continue;
    const input = { now, thresholds, schedule: org.schedule, waiting: org.waiting, lastBotReplyAt: org.lastBotReplyAt };
    waiting += org.waiting.length;
    if (org.lastBotReplyAt && (!lastReply || org.lastBotReplyAt > lastReply)) lastReply = org.lastBotReplyAt;
    const problem = botSilenceProblem(input);
    if (problem) {
      silentOrganizations++;
      problems.push(problem);
    }
  }
  return {
    problems,
    metrics: {
      waiting,
      silentOrganizations,
      lastReplyMinutesAgo: lastReply ? Math.floor((now.getTime() - lastReply.getTime()) / 60_000) : null,
    },
  };
}

/** Pastilla "Bot" del Dashboard para UNA organización (la de la sesión). */
export async function loadBotStatus(organizationId: string, now = new Date()): Promise<PillStatus | null> {
  const thresholds = botSilenceThresholds(process.env);
  const [org] = await snapshots(now, thresholds, organizationId);
  if (!org) return null;
  return botStatus({ now, thresholds, channels: org.channels, schedule: org.schedule, waiting: org.waiting, lastBotReplyAt: org.lastBotReplyAt });
}

/** Lo que necesita la franja de la Bandeja (se recalcula en el navegador cada minuto). */
export async function loadBotBanner(organizationId: string): Promise<BotBannerData | null> {
  const list = await watchedChannels(organizationId);
  if (list.length === 0) return null;
  const schedule = (await schedulesOf([organizationId])).get(organizationId) ?? null;
  // Sin horario y todo Encendido: no hay franja (nada que avisar).
  if (!schedule && list.every((c) => c.on)) return null;
  return { channels: list.map(({ displayName, on }) => ({ displayName, on })), schedule };
}
