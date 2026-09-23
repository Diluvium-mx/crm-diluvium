// Validación (Zod) de los pasos de un workflow. Puro: sin DB. Es la única
// definición de qué acepta cada tipo de paso; el editor, el seed y el ejecutor
// pasan por aquí (CLAUDE.md §7: Zod en todo borde de entrada).
import { z } from "zod";
import { contactStageEnum } from "@/lib/db/schema/contacts";
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";

export const MAX_STEP_TEXT = 4_096; // tope de WhatsApp para un texto
export const MAX_CAPTION = 1_024;
export const MAX_TAG = 40;
export const MAX_WAIT_SECONDS = 30;
export const MAX_STEPS = 12;

const nonEmpty = (max: number) => z.string().trim().min(1, "El texto está vacío.").max(max, `Máximo ${max} caracteres.`);

export const stepPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("send_text"), text: nonEmpty(MAX_STEP_TEXT) }),
  z.object({
    kind: z.literal("send_media"),
    assetId: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1, "Describe qué archivo va aquí.").max(120),
    caption: z.string().trim().max(MAX_CAPTION).optional(),
  }),
  z.object({ kind: z.literal("set_stage"), stage: z.enum(contactStageEnum.enumValues) }),
  z.object({ kind: z.literal("handover"), tag: z.string().trim().min(1).max(MAX_TAG).optional() }),
  z.object({ kind: z.literal("add_tag"), tag: nonEmpty(MAX_TAG) }),
  z.object({ kind: z.literal("internal_note"), text: nonEmpty(MAX_STEP_TEXT) }),
  z.object({ kind: z.literal("wait"), seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS) }),
]);

export const stepsSchema = z.array(stepPayloadSchema).max(MAX_STEPS, `Máximo ${MAX_STEPS} pasos.`);

export type StepPayload = z.infer<typeof stepPayloadSchema>;

// Garantía de que el tipo del schema y el de la tabla no se desincronicen.
const _check: WorkflowStepPayload = null as unknown as StepPayload;
void _check;

// Un workflow "listo" tiene al menos un paso y ningún archivo faltante. Un
// paso send_media sin assetId lo deja en "falta archivo" y no se puede
// habilitar ni ofrecer al agente/comandos.
export function missingMedia(steps: readonly StepPayload[]): string[] {
  return steps.flatMap((s) => (s.kind === "send_media" && !s.assetId ? [s.title] : []));
}

// ¿El paso manda algo al cliente por WhatsApp? (Los demás son internos.)
export function sendsToCustomer(step: StepPayload): boolean {
  return step.kind === "send_text" || step.kind === "send_media";
}

// Comando del vendedor: "/algo" en minúsculas, sin espacios; null = sin comando.
export const commandSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^\/[a-z0-9][a-z0-9-]{0,29}$/, "Un comando es /palabra (letras, números y guiones).")
  .nullable();

// Palabras clave del cliente: 1–5 palabras cada una, sin repetir, máx. 20.
export const keywordsSchema = z
  .array(z.string().trim().toLowerCase().min(2).max(40))
  .max(20)
  .transform((arr) => Array.from(new Set(arr)));

// Normaliza texto para comparar palabras clave: minúsculas y sin acentos.
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// ¿El mensaje del cliente contiene alguna palabra clave? Coincidencia por
// palabra completa (sin acentos): "tabla" no dispara con "establa" pero sí con
// "la tabla?" o "TABLA de tamaños".
export function matchesKeyword(message: string, keywords: readonly string[]): string | null {
  const haystack = ` ${normalizeKeyword(message).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const raw of keywords) {
    const kw = normalizeKeyword(raw).replace(/[^\p{L}\p{N}]+/gu, " ");
    if (kw && haystack.includes(` ${kw} `)) return raw;
  }
  return null;
}

// Un comando del vendedor es el mensaje ENTERO ("/tabla"), sin texto extra.
export function parseCommand(message: string): string | null {
  const t = message.trim().toLowerCase();
  return /^\/[a-z0-9][a-z0-9-]{0,29}$/.test(t) ? t : null;
}
