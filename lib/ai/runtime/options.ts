// Opciones del bot que lee el runtime (web y worker): la fila de ai_config de la
// organización convertida a BotOptions (lib/agente-ia/opciones.ts), con caché de 60 s
// como máximo por organización. Los cambios desde la pestaña aplican sin redesplegar:
// el worker relee en cada trabajo y, a lo más un minuto después, ya usa lo nuevo. El
// web borra su caché al guardar (opciones-store.ts).
// Sin "server-only": lo importa el worker (Node puro).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/db/schema";
import { BOT_OPTIONS_DEFAULTS, botScheduleSchema, RESPONSE_LENGTHS, type BotOptions, type BotSchedule, type ResponseLength } from "@/lib/agente-ia/opciones";

export const BOT_OPTIONS_CACHE_MS = 60_000;

type OptionsRow = {
  responseDelaySeconds: number;
  pauseOnHumanReply: boolean;
  humanReplyReactivateHours: number | null;
  handoverReactivateHours: number | null;
  botSchedule: BotSchedule | null;
  readImages: boolean;
  transcribeAudio: boolean;
  seguimientosReal: boolean;
  responseLength: string;
  maxBubbles: number;
  maxRepliesPerContact: number | null;
};

// Fila → opciones. Un valor fuera de rango en la BD (editado a mano) cae al de fábrica:
// el bot nunca se queda con un valor imposible.
export function optionsFromRow(row: OptionsRow | undefined | null): BotOptions {
  if (!row) return { ...BOT_OPTIONS_DEFAULTS };
  const d = BOT_OPTIONS_DEFAULTS;
  const int = (v: number | null, min: number, max: number, fallback: number | null) =>
    v !== null && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  const schedule = botScheduleSchema.safeParse(row.botSchedule);
  return {
    responseDelaySeconds: int(row.responseDelaySeconds, 5, 60, d.responseDelaySeconds) as number,
    pauseOnHumanReply: row.pauseOnHumanReply,
    humanReplyReactivateHours: int(row.humanReplyReactivateHours, 1, 720, null),
    handoverPauseHours: int(row.handoverReactivateHours, 1, 720, null),
    schedule: schedule.success ? schedule.data : null,
    readImages: row.readImages,
    transcribeAudio: row.transcribeAudio,
    seguimientosReal: row.seguimientosReal,
    responseLength: (RESPONSE_LENGTHS as readonly string[]).includes(row.responseLength) ? (row.responseLength as ResponseLength) : d.responseLength,
    maxBubbles: row.maxBubbles === 1 ? 1 : 2,
    maxRepliesPerContact: int(row.maxRepliesPerContact, 1, 1_000, null),
  };
}

const cache = new Map<string, { at: number; options: BotOptions }>();

export async function loadBotOptions(organizationId: string, now: Date = new Date()): Promise<BotOptions> {
  const hit = cache.get(organizationId);
  if (hit && now.getTime() - hit.at < BOT_OPTIONS_CACHE_MS && now.getTime() >= hit.at) return hit.options;
  const [row] = await db
    .select({
      responseDelaySeconds: aiConfig.responseDelaySeconds,
      pauseOnHumanReply: aiConfig.pauseOnHumanReply,
      humanReplyReactivateHours: aiConfig.humanReplyReactivateHours,
      handoverReactivateHours: aiConfig.handoverReactivateHours,
      botSchedule: aiConfig.botSchedule,
      readImages: aiConfig.readImages,
      transcribeAudio: aiConfig.transcribeAudio,
      seguimientosReal: aiConfig.seguimientosReal,
      responseLength: aiConfig.responseLength,
      maxBubbles: aiConfig.maxBubbles,
      maxRepliesPerContact: aiConfig.maxRepliesPerContact,
    })
    .from(aiConfig)
    .where(eq(aiConfig.organizationId, organizationId))
    .limit(1);
  const options = optionsFromRow(row);
  cache.set(organizationId, { at: now.getTime(), options });
  return options;
}

// Sin argumento borra todo (tests, arranque); con organización, solo la suya (al guardar).
export function clearBotOptionsCache(organizationId?: string): void {
  if (organizationId === undefined) cache.clear();
  else cache.delete(organizationId);
}
