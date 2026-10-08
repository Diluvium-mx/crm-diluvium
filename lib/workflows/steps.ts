// Validación (Zod) de los pasos de un workflow. Puro: sin DB. Es la única
// definición de qué acepta cada tipo de paso; el editor, el seed y el ejecutor
// pasan por aquí (CLAUDE.md §7: Zod en todo borde de entrada).
import { z } from "zod";
import type { WorkflowStepPayload } from "@/lib/db/schema/automation";

export const MAX_STEP_TEXT = 4_096; // tope de WhatsApp para un texto
export const MAX_CAPTION = 1_024;
// 30 s es lo que GHL espera antes de la tabla de tamaños; tope holgado.
export const MAX_WAIT_SECONDS = 60;
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

// «¿Cuándo se dispara por palabra clave o por el Agente IA?» (29-sep-2026): tres opciones,
// guardadas en dos columnas (trigger_start_only + trigger_start_only_agent).
// - "siempre": en cualquier momento.
// - "inicio": «Solo al inicio», regla estricta (palabra clave Y Agente IA; «Precio 2»).
// - "inicio_palabra_clave": la palabra clave solo al inicio; el Agente IA cuando haga falta (Tabla).
export const START_SCOPES = ["siempre", "inicio", "inicio_palabra_clave"] as const;
export type StartScope = (typeof START_SCOPES)[number];

// El historial anterior al 29-sep no trae la segunda columna: sin ella, «Solo al inicio» era estricto.
export function startScopeOf(w: { triggerStartOnly?: boolean; triggerStartOnlyAgent?: boolean }): StartScope {
  if (!w.triggerStartOnly) return "siempre";
  return w.triggerStartOnlyAgent === false ? "inicio_palabra_clave" : "inicio";
}

export function startScopeFields(scope: StartScope): { triggerStartOnly: boolean; triggerStartOnlyAgent: boolean } {
  return { triggerStartOnly: scope !== "siempre", triggerStartOnlyAgent: scope !== "inicio_palabra_clave" };
}

// El mismo texto en el editor, el historial y «Copiar».
export const START_SCOPE_LABEL: Record<StartScope, string> = {
  siempre: "En cualquier momento",
  inicio: "Solo al inicio",
  inicio_palabra_clave: "Solo al inicio por palabra clave; el Agente IA cuando haga falta",
};

// ¿«Solo al inicio» aplica a este disparador? El comando y la etapa de un vendedor salen siempre.
export function startOnlyApplies(w: { triggerStartOnly: boolean; triggerStartOnlyAgent: boolean }, trigger: "agent" | "keyword" | "command" | "stage"): boolean {
  if (!w.triggerStartOnly) return false;
  if (trigger === "keyword") return true;
  return trigger === "agent" && w.triggerStartOnlyAgent;
}

// «Máximo de envíos por chat» (29-sep-2026): 1–20; vacío = sin límite.
export const MAX_SENDS_PER_CHAT = 20;
export const maxSendsSchema = z.number().int().min(1, "El máximo por chat es de 1 en adelante.").max(MAX_SENDS_PER_CHAT, `El máximo por chat es ${MAX_SENDS_PER_CHAT}.`).nullable();
export function maxSendsLabel(max: number | null | undefined): string {
  if (!max) return "sin límite";
  return max === 1 ? "1 vez" : `${max} veces`;
}

// ¿El paso manda algo al cliente por WhatsApp? (Los demás son internos.)
export function sendsToCustomer(step: StepPayload): boolean {
  return step.kind === "send_text" || step.kind === "send_media";
}

// ¿El texto le hace una PREGUNTA al cliente? "?" al final, seguido si acaso de espacios,
// emojis o signos, nunca de letras o números: "¿Usted tiene problemas de inundaciones? 🙌"
// sí; "¿Le interesa? Aquí está el video" no.
const QUESTION_END_RE = /\?[^\p{L}\p{N}]*$/u;
export function endsWithQuestion(text: string | null | undefined): boolean {
  return QUESTION_END_RE.test((text ?? "").trim());
}

// ¿El ÚLTIMO paso le pregunta algo al cliente (texto, o pie de la imagen/video)? Desde el
// 29-sep-2026 ya no decide nada solo: el editor avisa si un workflow así no tiene marcada
// «El workflow es la respuesta» (la casilla reemplazó a esta regla automática del 28-sep).
export function endsWithQuestionStep(steps: readonly WorkflowStepPayload[]): boolean {
  const last = steps.at(-1);
  if (!last) return false;
  if (last.kind === "send_text") return endsWithQuestion(last.text);
  if (last.kind === "send_media") return endsWithQuestion(last.caption);
  return false;
}

// Comando del vendedor: "/algo" en minúsculas, sin espacios; null = sin comando.
// Letras sin acento y la ñ (28-sep-2026, pedido del dueño: "/tamaños"), números
// y guiones. Única definición: el editor, el composer y el hilo pasan por aquí.
const COMMAND_RE = /^\/[a-z0-9ñ][a-z0-9ñ-]{0,29}$/;

// NFC: una "ñ" pegada como "n" + tilde combinada cuenta igual que la del teclado.
function normalizeCommand(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

export const commandSchema = z
  .string()
  .transform(normalizeCommand)
  .pipe(z.string().regex(COMMAND_RE, "Un comando es /palabra: letras sin acento (la ñ sí), números y guiones."))
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

// ¿El mensaje del cliente CONTIENE alguna palabra clave? Igual que GHL
// (24-sep-2026): coincidencia "contiene", sin distinguir mayúsculas ni acentos y
// sin tope de palabras ("instalacion" dispara con "¿cómo es la instalación?").
// Devuelve la coincidencia MÁS LARGA ("video a la medida" gana a "video").
// Un mensaje que solo trae signos de pesos («$», «$$», «$$$», «$?») se compara como si
// dijera "precio" (5-oct-2026, dueño): el cliente pregunta el precio y, al quitar los
// signos, quedaba vacío y nunca disparaba «Precio 2».
export function matchesKeyword(message: string, keywords: readonly string[]): string | null {
  const words = normalizeKeyword(message).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const haystack = words || (message.includes("$") ? "precio" : "");
  if (!haystack) return null;
  let best: { raw: string; len: number } | null = null;
  for (const raw of keywords) {
    const kw = normalizeKeyword(raw).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (kw && haystack.includes(kw) && (!best || kw.length > best.len)) best = { raw, len: kw.length };
  }
  return best?.raw ?? null;
}

// Variables que el ejecutor sabe rellenar: las del CRM y los argumentos de las
// herramientas del agente (comprobante) o del disparador. Cualquier otra
// llegaría literal al cliente ("tu total es {{monto}}"), así que el editor la rechaza.
export const ALLOWED_VARIABLES = new Set(["nombre", "vendedor", "mensaje", "etapa_disparadora"]);

export function unknownVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!ALLOWED_VARIABLES.has(m[1].trim())) out.add(m[1].trim());
  }
  return [...out];
}

// Antes de mandar al cliente: una variable que quedó sin valor se quita en vez
// de salir como "{{monto}}" en WhatsApp.
export function stripUnresolvedVariables(text: string): string {
  return text
    .replace(/\{\{\s*[^{}]+?\s*\}\}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Un comando del vendedor es el mensaje ENTERO ("/tabla"), sin texto extra.
export function parseCommand(message: string): string | null {
  const t = normalizeCommand(message);
  return COMMAND_RE.test(t) ? t : null;
}

// Pasos "Esperar" (28-sep-2026, pedido del dueño): un "/" del VENDEDOR (trigger
// "command", también "Probar") sale de inmediato; el agente y las palabras
// clave conservan sus esperas (GHL espera 30 s antes de la tabla). El orden de
// los pasos no cambia: solo se omite la pausa.
export function waitMs(step: { kind: "wait"; seconds: number }, trigger: string): number {
  return trigger === "command" ? 0 : step.seconds * 1_000;
}

// Índice del ÚLTIMO paso que le manda algo al cliente (-1 si ninguno). «El workflow es la
// respuesta»: ese mensaje es el que contesta (una espera al final no cuenta).
export function lastSendIndex(steps: readonly WorkflowStepPayload[]): number {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind === "send_text" || steps[i].kind === "send_media") return i;
  return -1;
}

// Texto del Agente IA como pie del archivo (1-oct-2026, dueño). Cuando el agente pide un workflow
// que solo manda archivos (video, Tabla), su texto viaja como pie del PRIMER archivo, en lugar del
// pie del workflow: antes salían su frase y luego el archivo con su propio pie, que decía lo mismo.
// La llave vive en `workflow_runs.payload` (durable entre reintentos); no es una variable {{…}}.
export const AGENT_CAPTION_KEY = "pieDelAgente";

// Índice del archivo que lleva el texto del agente como pie: el PRIMERO, si el workflow solo manda
// archivos (con o sin esperas); -1 si trae textos (si es «la respuesta», el texto del modelo no
// sale; si no, sale aparte como siempre) o ningún archivo. Las esperas ANTES de ese archivo no
// corren con el pie (ejecutor): eran para que el cliente leyera primero ese texto, que ahora va con
// el archivo (la Tabla espera 18 s; con el pie, la respuesta del agente no se retrasa).
export function agentCaptionIndex(steps: readonly WorkflowStepPayload[]): number {
  if (steps.some((s) => s.kind === "send_text")) return -1;
  return steps.findIndex((s) => s.kind === "send_media");
}

export function takesAgentCaption(steps: readonly WorkflowStepPayload[]): boolean {
  return agentCaptionIndex(steps) >= 0;
}

export function agentCaptionOf(payload: Record<string, unknown> | null | undefined): string | null {
  const v = payload?.[AGENT_CAPTION_KEY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
