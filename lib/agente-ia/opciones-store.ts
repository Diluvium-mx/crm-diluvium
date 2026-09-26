// Lecturas y escrituras de las Opciones del bot (sección "Opciones" de la pestaña
// Agente IA, 26-sep-2026). Sin sesión: la Server Action (lib/actions/agente-ia-opciones.ts)
// resuelve la organización y el permiso. Toda consulta filtra por organization_id.
// Cada guardado deja en ai_config_changes quién cambió qué y cuándo (append-only) y
// borra la caché del web; el worker relee en ≤ 60 s (lib/ai/runtime/options.ts).
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfig, aiConfigChanges, user } from "@/lib/db/schema";
import { DEFAULT_BRAIN_MODEL, DEFAULT_FILTER_MODEL } from "@/lib/ai/catalog";
import { clearBotOptionsCache, optionsFromRow } from "@/lib/ai/runtime/options";
import { formatOptionValue, isBotOptionField, type BotOptions, type BotOptionsChange, type BotOptionsPatch } from "./opciones";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const optionColumns = {
  responseDelaySeconds: aiConfig.responseDelaySeconds,
  pauseOnHumanReply: aiConfig.pauseOnHumanReply,
  humanReplyReactivateHours: aiConfig.humanReplyReactivateHours,
  handoverReactivateHours: aiConfig.handoverReactivateHours,
  botSchedule: aiConfig.botSchedule,
  readImages: aiConfig.readImages,
  transcribeAudio: aiConfig.transcribeAudio,
  responseLength: aiConfig.responseLength,
  maxBubbles: aiConfig.maxBubbles,
  maxRepliesPerContact: aiConfig.maxRepliesPerContact,
};

export async function loadBotOptionsRow(organizationId: string): Promise<BotOptions> {
  const [row] = await db.select(optionColumns).from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).limit(1);
  return optionsFromRow(row);
}

// Último cambio de la organización (para "Último cambio: Daniel, hoy 11:20").
export async function loadLastOptionsChange(organizationId: string): Promise<BotOptionsChange | null> {
  const [row] = await db
    .select({ field: aiConfigChanges.field, oldValue: aiConfigChanges.oldValue, newValue: aiConfigChanges.newValue, createdAt: aiConfigChanges.createdAt, author: user.name })
    .from(aiConfigChanges)
    .leftJoin(user, eq(user.id, aiConfigChanges.userId))
    .where(eq(aiConfigChanges.organizationId, organizationId))
    .orderBy(desc(aiConfigChanges.createdAt), desc(aiConfigChanges.id))
    .limit(1);
  if (!row || !isBotOptionField(row.field)) return null;
  return { field: row.field, oldValue: row.oldValue, newValue: row.newValue, createdAt: row.createdAt, author: row.author };
}

// Opciones → columnas de ai_config (la de "pedir asesor" reusa handover_reactivate_hours).
function toColumns(patch: BotOptionsPatch) {
  const set: Partial<typeof aiConfig.$inferInsert> = {};
  if (patch.responseDelaySeconds !== undefined) set.responseDelaySeconds = patch.responseDelaySeconds;
  if (patch.pauseOnHumanReply !== undefined) set.pauseOnHumanReply = patch.pauseOnHumanReply;
  if (patch.humanReplyReactivateHours !== undefined) set.humanReplyReactivateHours = patch.humanReplyReactivateHours;
  if (patch.handoverPauseHours !== undefined) set.handoverReactivateHours = patch.handoverPauseHours;
  if (patch.schedule !== undefined) set.botSchedule = patch.schedule;
  if (patch.readImages !== undefined) set.readImages = patch.readImages;
  if (patch.transcribeAudio !== undefined) set.transcribeAudio = patch.transcribeAudio;
  if (patch.responseLength !== undefined) set.responseLength = patch.responseLength;
  if (patch.maxBubbles !== undefined) set.maxBubbles = patch.maxBubbles;
  if (patch.maxRepliesPerContact !== undefined) set.maxRepliesPerContact = patch.maxRepliesPerContact;
  return set;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Guarda las opciones que vienen en `patch` (las demás no se tocan) y deja un registro
 * por cada opción que de verdad cambió. Devuelve las opciones vigentes y los cambios.
 */
export async function saveBotOptions(
  organizationId: string,
  userId: string | null,
  patch: BotOptionsPatch,
): Promise<{ options: BotOptions; changes: BotOptionsChange[] }> {
  const result = await db.transaction(async (tx: Tx) => {
    // La fila de ai_config existe siempre que se edita (se crea con los defaults).
    await tx
      .insert(aiConfig)
      .values({ organizationId, modeloFiltro: DEFAULT_FILTER_MODEL, modeloCerebro: DEFAULT_BRAIN_MODEL })
      .onConflictDoNothing({ target: aiConfig.organizationId });
    const [row] = await tx.select(optionColumns).from(aiConfig).where(eq(aiConfig.organizationId, organizationId)).for("update");
    const before = optionsFromRow(row);
    const after: BotOptions = { ...before, ...patch } as BotOptions;
    const now = new Date();
    const changes: BotOptionsChange[] = [];
    for (const field of Object.keys(patch) as (keyof BotOptions)[]) {
      if (sameValue(before[field], after[field])) continue;
      changes.push({
        field,
        oldValue: formatOptionValue(field, before[field]),
        newValue: formatOptionValue(field, after[field]),
        author: null,
        createdAt: now,
      });
    }
    if (changes.length === 0) return { options: before, changes };
    await tx
      .update(aiConfig)
      .set({ ...toColumns(patch), updatedAt: now })
      .where(and(eq(aiConfig.organizationId, organizationId)));
    await tx.insert(aiConfigChanges).values(
      changes.map((c) => ({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        createdAt: now,
      })),
    );
    return { options: after, changes };
  });
  // El web sirve lo nuevo de inmediato; el worker en ≤ 60 s.
  clearBotOptionsCache(organizationId);
  return result;
}
