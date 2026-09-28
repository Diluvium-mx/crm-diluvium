// Historial de cambios (Bloque A, 28-sep-2026; subpestaña "Historial" de la pestaña Agente
// IA): tipos, acciones, textos, filtros y hora de Mazatlán. PURO y seguro para el cliente.
// Lo que se guarda en change_history (lib/historial/log.ts) usa estos `kind`/`action`; las
// Opciones del Agente IA y el Goal/FAQs se leen de sus propias tablas (lib/historial/queries.ts).
// Bloque E (28-sep): + regla de etapa, nombre del agente, tallas, mensajes rápidos, plantillas,
// vendedores (solo owner/admin) y las pausas automáticas por tope, por asesor y la vuelta sola.
// NO entra el trabajo diario (mover contactos de etapa, mensajes, comentarios).
import { z } from "zod";
import { instantToLocal, localToInstant } from "@/lib/scheduled/rules";
import type { WorkflowDetail, WorkflowDetailStep } from "./diff";

// Filtro "Tipo" de la subpestaña, en este orden.
export const HISTORY_TYPES = [
  { id: "opciones", label: "Opciones del Agente IA" },
  { id: "goal_faqs", label: "Goal y FAQs" },
  { id: "nombre", label: "Nombre del agente" },
  { id: "modelos", label: "Modelos" },
  { id: "etapas", label: "Etapas" },
  { id: "canales", label: "Canales" },
  { id: "workflows", label: "Workflows" },
  { id: "tallas", label: "Tallas y medidas" },
  { id: "mensajes_rapidos", label: "Mensajes rápidos" },
  { id: "plantillas", label: "Plantillas" },
  { id: "vendedores", label: "Vendedores" },
  { id: "pausas", label: "Pausas por chat" },
] as const;

export type HistoryType = (typeof HISTORY_TYPES)[number]["id"];

export const HISTORY_TYPE_LABEL = Object.fromEntries(HISTORY_TYPES.map((t) => [t.id, t.label])) as Record<HistoryType, string>;

// Lo que vive en change_history (las otras dos fuentes ya tenían tabla).
export type ChangeKind = Exclude<HistoryType, "opciones" | "goal_faqs">;

export type ChangeAction = {
  nombre: "editar";
  modelos: "modelo_1" | "modelo_2";
  etapas: "crear" | "renombrar" | "borrar" | "reordenar" | "papel" | "modelo" | "regla";
  // limpiar_pruebas = borró los chats de canales de prueba archivados (npm run pruebas:limpiar).
  canales: "encender" | "apagar" | "limpiar_pruebas";
  workflows: "crear" | "editar" | "encender" | "apagar" | "borrar";
  tallas: "editar";
  mensajes_rapidos: "crear" | "editar" | "borrar";
  plantillas: "alta" | "editar" | "borrar" | "sincronizar";
  vendedores: "alta" | "rol" | "desactivar" | "reactivar" | "contrasena";
  // Automáticas (sin autor; se ocultan o muestran con el filtro): pausa_auto = "un vendedor
  // contestó", pausa_tope = llegó al máximo de respuestas, pausa_asesor = el cliente pidió
  // un asesor, vuelta_sola = se cumplió la hora de regreso.
  pausas: "pausar" | "activar" | "pausa_auto" | "pausa_tope" | "pausa_asesor" | "vuelta_sola";
};

/** Acciones automáticas: ocultas en la subpestaña salvo que se pidan con el filtro. */
export const AUTOMATIC_ACTIONS = ["pausa_auto", "pausa_tope", "pausa_asesor", "vuelta_sola"] as const;

export function isAutomaticAction(action: string): boolean {
  return (AUTOMATIC_ACTIONS as readonly string[]).includes(action);
}

/** Tipos que solo ven owner y admin (el resto de la subpestaña la ven todos los roles). */
export const MANAGER_ONLY_TYPES: readonly HistoryType[] = ["vendedores"];

/** Una fila de la subpestaña, ya con textos. `at` en ISO (UTC). */
export type HistoryRow = {
  id: string;
  type: HistoryType;
  who: string;
  what: string;
  before: string | null;
  after: string | null;
  at: string;
  automatic: boolean;
  /** ¿Tiene "Ver cambios"? (lo carga getChangeDiff al abrirlo). */
  hasDetail: boolean;
};

/** Filas por consulta (lo más nuevo); con fechas se ve más atrás. */
export const HISTORY_LIMIT = 200;

export const AUTOMATIC_WHO = "Automático";
export const SYSTEM_WHO = "Sistema";

const q = (s: string | null) => `«${s ?? "—"}»`;

/** "Qué" de una fila de change_history. */
export function describeAction(kind: string, action: string, subject: string | null): string {
  const s = q(subject);
  switch (`${kind}.${action}`) {
    case "modelos.modelo_1":
      return "Cambió el Modelo 1";
    case "modelos.modelo_2":
      return "Cambió el Modelo 2";
    case "etapas.crear":
      return `Creó la etapa ${s}`;
    case "etapas.renombrar":
      return "Renombró una etapa";
    case "etapas.borrar":
      return `Borró la etapa ${s}`;
    case "etapas.reordenar":
      return "Cambió el orden de las etapas";
    case "etapas.papel":
      return `Pasó el papel ${s} a otra etapa`;
    case "etapas.modelo":
      return `Cambió el modelo de la etapa ${s}`;
    case "etapas.regla":
      return `Cambió la regla del Agente IA de la etapa ${s}`;
    case "nombre.editar":
      return "Cambió el nombre del agente";
    case "tallas.editar":
      return "Cambió las tallas y medidas";
    case "mensajes_rapidos.crear":
      return `Creó el mensaje rápido ${s}`;
    case "mensajes_rapidos.editar":
      return `Editó el mensaje rápido ${s}`;
    case "mensajes_rapidos.borrar":
      return `Borró el mensaje rápido ${s}`;
    case "plantillas.alta":
      return `Dio de alta la plantilla ${s} (va a revisión de Meta)`;
    case "plantillas.editar":
      return `Editó el texto de la plantilla ${s} (vuelve a revisión de Meta)`;
    case "plantillas.borrar":
      return `Borró la plantilla ${s} en Meta`;
    case "plantillas.sincronizar":
      return "Sincronizó las plantillas con Meta";
    case "vendedores.alta":
      return `Dio de alta a ${s}`;
    case "vendedores.rol":
      return `Cambió el rol de ${s}`;
    case "vendedores.desactivar":
      return `Desactivó a ${s}`;
    case "vendedores.reactivar":
      return `Reactivó a ${s}`;
    case "vendedores.contrasena":
      return `Restableció la contraseña de ${s}`;
    case "canales.encender":
      return `Encendió el agente en ${subject ?? "un canal"}`;
    case "canales.apagar":
      return `Apagó el agente en ${subject ?? "un canal"}`;
    case "canales.limpiar_pruebas":
      return `Limpieza de chats de prueba: borró los chats de ${s}`;
    case "workflows.crear":
      return `Creó el workflow ${s}`;
    case "workflows.editar":
      return `Editó el workflow ${s}`;
    case "workflows.encender":
      return `Encendió el workflow ${s}`;
    case "workflows.apagar":
      return `Apagó el workflow ${s}`;
    case "workflows.borrar":
      return `Borró el workflow ${s}`;
    case "pausas.pausar":
      return `Pausó el agente en el chat de ${subject ?? "un contacto"}`;
    case "pausas.activar":
      return `Activó el agente en el chat de ${subject ?? "un contacto"}`;
    case "pausas.pausa_auto":
      return `Un vendedor contestó: el agente se pausó en el chat de ${subject ?? "un contacto"}`;
    case "pausas.pausa_tope":
      return `Llegó al máximo de respuestas: el agente se pausó en el chat de ${subject ?? "un contacto"}`;
    case "pausas.pausa_asesor":
      return `El cliente pidió un asesor: el agente se pausó en el chat de ${subject ?? "un contacto"}`;
    case "pausas.vuelta_sola":
      return `Se cumplió la hora de regreso: el agente volvió solo en el chat de ${subject ?? "un contacto"}`;
    default:
      return `${kind} · ${action}`;
  }
}

// Mismos nombres que la pestaña Plantillas (Mensajes rápidos).
const TEMPLATE_STATUS: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  IN_APPEAL: "En apelación",
  REJECTED: "Rechazada",
  REMOVED: "Eliminada en Meta",
};

export function templateStatusLabel(status: string): string {
  return TEMPLATE_STATUS[status.toUpperCase()] ?? status;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Instante → "28-sep-2026 14:05" en hora de Mazatlán. */
export function formatMazatlan(at: Date): string {
  const local = instantToLocal(at); // "2026-09-28T14:05"
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  return `${d}-${MONTHS[m - 1]}-${y} ${local.slice(11, 16)}`;
}

/** Estado del agente en un chat, como texto del historial. */
export function agentStateLabel(state: string, pausedUntil: Date | null): string {
  if (state === "activo") return "Activo";
  return pausedUntil ? `Pausado hasta ${formatMazatlan(pausedUntil)}` : "Pausado hasta «Activar»";
}

// ── Filtros ──────────────────────────────────────────────────────────────────
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

export const historyFilterSchema = z.object({
  type: z.enum(HISTORY_TYPES.map((t) => t.id) as [HistoryType, ...HistoryType[]]).nullish(),
  from: dateSchema,
  to: dateSchema,
  // Pausas automáticas (vendedor contestó, tope, asesor, vuelta sola): ocultas salvo que se pidan.
  includeAuto: z.boolean().default(false),
});

export type HistoryFilter = z.input<typeof historyFilterSchema>;

// Día de calendario siguiente a "2026-09-28" (sin zona).
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Días "Desde"/"Hasta" (hora de Mazatlán, ambos incluidos) → [start, end) en UTC.
 * null = sin límite. Una fecha inválida también cuenta como sin límite.
 */
export function historyRange(from?: string | null, to?: string | null): { start: Date | null; end: Date | null } {
  const start = from ? localToInstant(`${from}T00:00`) : null;
  const end = to && localToInstant(`${to}T00:00`) ? localToInstant(`${nextDay(to)}T00:00`) : null;
  return { start, end };
}

// ── Workflows: qué cambió al editar ──────────────────────────────────────────
export type WorkflowSnapshot = {
  name: string;
  enabled: boolean;
  agentDescription: string;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  // Nombre de la etapa (no la clave).
  triggerStage: string | null;
  steps: unknown[];
};

/**
 * Foto de un workflow para "Ver cambios" (Bloque E): pasos con el NOMBRE del archivo (el de
 * ese momento: si después se borra de la biblioteca, el historial lo sigue diciendo).
 */
export function workflowDetail(w: WorkflowSnapshot, fileName: (assetId: string) => string | null): WorkflowDetail {
  return {
    name: w.name,
    enabled: w.enabled,
    agentDescription: w.agentDescription,
    triggerAgent: w.triggerAgent,
    triggerKeywords: [...w.triggerKeywords],
    triggerCommand: w.triggerCommand,
    triggerStage: w.triggerStage,
    steps: w.steps.flatMap((raw): WorkflowDetailStep[] => {
      const st = raw as { kind?: unknown; text?: unknown; seconds?: unknown; title?: unknown; assetId?: unknown; caption?: unknown };
      if (st.kind === "send_text") return [{ kind: "send_text", text: String(st.text ?? "") }];
      if (st.kind === "wait") return [{ kind: "wait", seconds: Number(st.seconds ?? 0) }];
      if (st.kind === "send_media") {
        const assetId = typeof st.assetId === "string" ? st.assetId : null;
        return [{ kind: "send_media", title: String(st.title ?? ""), file: assetId ? (fileName(assetId) ?? "archivo borrado") : null, caption: typeof st.caption === "string" && st.caption ? st.caption : null }];
      }
      return [];
    }),
  };
}

/** Ids de archivo que usan los pasos (para buscar sus nombres). */
export function workflowAssetIds(...lists: unknown[][]): string[] {
  const ids = lists.flat().flatMap((raw) => {
    const st = raw as { kind?: unknown; assetId?: unknown };
    return st.kind === "send_media" && typeof st.assetId === "string" ? [st.assetId] : [];
  });
  return [...new Set(ids)];
}

// JSON con las llaves ordenadas: jsonb de Postgres reordena las llaves de los pasos guardados.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

const onOff = (v: boolean) => (v ? "Encendido" : "Apagado");
const pasos = (n: number) => (n === 1 ? "1 paso" : `${n} pasos`);

/** Resumen de un workflow nuevo: "Apagado · 3 pasos". */
export function workflowSummary(w: Pick<WorkflowSnapshot, "enabled" | "steps">): string {
  return `${onOff(w.enabled)} · ${pasos(w.steps.length)}`;
}

/**
 * Antes → después de una edición, solo con lo que cambió ("Nombre: «A»" → "Nombre: «B»",
 * "3 pasos" → "4 pasos"…). null si no cambió nada.
 */
export function describeWorkflowEdit(before: WorkflowSnapshot, after: WorkflowSnapshot): { before: string; after: string } | null {
  const parts: [string, string][] = [];
  const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
  if (before.name !== after.name) parts.push([`Nombre: ${q(before.name)}`, `Nombre: ${q(after.name)}`]);
  if (before.enabled !== after.enabled) parts.push([onOff(before.enabled), onOff(after.enabled)]);
  if (!same(before.steps, after.steps)) {
    parts.push(
      before.steps.length === after.steps.length
        ? [pasos(before.steps.length), `${pasos(after.steps.length)} (editados)`]
        : [pasos(before.steps.length), pasos(after.steps.length)],
    );
  }
  if (!same(before.triggerKeywords, after.triggerKeywords)) {
    const kw = (k: string[]) => `Palabras clave: ${k.length ? k.join(", ") : "ninguna"}`;
    parts.push([kw(before.triggerKeywords), kw(after.triggerKeywords)]);
  }
  if (before.triggerCommand !== after.triggerCommand) {
    parts.push([`Comando: ${before.triggerCommand ?? "ninguno"}`, `Comando: ${after.triggerCommand ?? "ninguno"}`]);
  }
  if (before.triggerStage !== after.triggerStage) {
    parts.push([`Al entrar a: ${before.triggerStage ?? "ninguna"}`, `Al entrar a: ${after.triggerStage ?? "ninguna"}`]);
  }
  if (before.triggerAgent !== after.triggerAgent) {
    parts.push([`Lo usa el agente: ${before.triggerAgent ? "Sí" : "No"}`, `Lo usa el agente: ${after.triggerAgent ? "Sí" : "No"}`]);
  }
  if (before.agentDescription !== after.agentDescription) parts.push(["Descripción para el agente", "Descripción para el agente (editada)"]);
  if (parts.length === 0) return null;
  return { before: parts.map((p) => p[0]).join(" · "), after: parts.map((p) => p[1]).join(" · ") };
}
