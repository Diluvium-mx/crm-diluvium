// INSTAGRAM SE QUEDA EN LA ENTRADA HASTA LA FOTO (27-oct-2026, regla del dueño; PURO, sin BD ni red).
//
// En Instagram escribe mucha gente que pregunta y no compra (varios de otros países). Al 27-oct
// había 144 contactos de Instagram en Prospecto por dar una medida o decir «quiero 1», ninguno
// había mandado una foto y ninguno había comprado. Regla: en un chat de Instagram el contacto se
// queda en la etapa de entrada (Inbox) hasta que el cliente mande una foto de SU entrada y dé la
// medida; con las dos siguen las reglas de siempre (normalmente, Interesado).
//
// El código revisa lo que puede ver: que el cliente mandó al menos una foto. Que sea de su entrada
// y que haya dado la medida lo juzga el modelo con `instagramStageLine`. Datos bancarios y
// comprobante (de "Cerca de compra" en adelante) mueven como siempre: una venta que llegue sin foto
// no se pierde. WhatsApp no cambia y un vendedor puede mover a mano. Lo usan el Agente IA que
// contesta (actions.ts y el traspaso de run.ts) y el de segundo plano (lector.ts).
import { stageByKey, stageForRole, type FunnelStage } from "@/lib/contacts/stages";

type ChatRow = {
  direction: string;
  attachments: readonly { type: string }[] | null;
};

/** ¿El cliente mandó al menos una foto en el chat? */
export function hasClientPhoto(rows: readonly ChatRow[]): boolean {
  return rows.some((m) => m.direction === "in" && (m.attachments ?? []).some((a) => a.type === "image"));
}

/**
 * La etapa a la que el Agente IA puede llevar al contacto: la que pidió, salvo en un chat de
 * Instagram sin foto del cliente, donde solo valen "Cerca de compra" y las que siguen (por el
 * PAPEL, no por la clave). null = el contacto se queda donde está.
 */
export function instagramAllowedStage(
  stages: readonly FunnelStage[],
  requested: string | null,
  chat: { instagram: boolean; clientPhoto: boolean },
): string | null {
  if (requested === null || !chat.instagram || chat.clientPhoto) return requested;
  const to = stageByKey(stages, requested);
  const cerca = stageForRole(stages, "cerca_compra");
  return to && cerca && to.position >= cerca.position ? requested : null;
}

/** Texto para el registro cuando se frenó la etapa. */
export function instagramHeld(requested: string): string {
  return `etapa ${requested}: chat de Instagram sin foto del cliente (se queda en la entrada hasta su foto y su medida)`;
}

/** Línea para el modelo en los chats de Instagram (va con el contexto del chat, no en el system). */
export function instagramStageLine(stages: readonly FunnelStage[]): string {
  const entrada = stageForRole(stages, "entrada")?.name ?? "la primera etapa";
  return `Chat de Instagram: el contacto se queda en «${entrada}» hasta que el cliente mande una foto de SU entrada y dé la medida de esa entrada. Sin las dos no lo muevas de etapa, aunque pregunte el precio, dé medidas, diga cuántas quiere o de dónde es; con las dos, aplica las reglas de las etapas (la más adelantada que cumpla). Los datos bancarios y el comprobante lo mueven como siempre.`;
}
