// Herramientas del cerebro (Fase D reestructurada, 24-sep-2026). PURO (sin BD).
// - `wf_<slug>`: una por workflow de media habilitado con disparador "agente"
//   (descripción = "Cuándo usarlo", editable por el admin).
// - `fijar_cotizacion { monto }`: guarda el total cotizado en el contacto.
// - `mover_etapa { etapa }`: avanza la etapa (solo hacia adelante; el CRM ignora
//   retrocesos sin error). Acepta SOLO las claves vigentes de las columnas del Embudo
//   de la organización (funnel_stages): una etapa borrada deja de existir para el modelo.
// - `aviso_vendedor { motivo, detalle? }`: aviso interno 🤖 al vendedor; nunca llega
//   al cliente ni pausa al agente. Desde la Fase E (25-sep-2026) sin monto ni folio.
// - `actualizar_detalle { … }` (Agente IA parte 1, 26-sep-2026): llena el Detalle del
//   contacto con lo que dijo el cliente (lib/ai/runtime/detalle.ts). Solo campos vacíos
//   o que el propio agente llenó; lo del vendedor nunca se toca.
// Sin `execute`: el modelo devuelve texto + llamadas en UNA vuelta y el runtime
// decide qué corre. Las reglas de negocio viven en el Goal, no aquí.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { toolNameFor } from "@/lib/workflows/defaults";
import { sortStages, type FunnelStage } from "@/lib/contacts/stages";
import type { ToolCallOutput } from "@/lib/ai/types";

export const TOOL_FIJAR_COTIZACION = "fijar_cotizacion";
export const TOOL_MOVER_ETAPA = "mover_etapa";
export const TOOL_AVISO_VENDEDOR = "aviso_vendedor";
export const TOOL_ACTUALIZAR_DETALLE = "actualizar_detalle";

export const AVISO_MOTIVOS = ["cotejar_deposito", "cliente_pide_humano", "comprobante_dudoso"] as const;
export type AvisoMotivo = (typeof AVISO_MOTIVOS)[number];

export type AgentToolWorkflow = { id: string; slug: string; name: string };

export type AgentTools = {
  tools: ToolSet;
  byName: ReadonlyMap<string, AgentToolWorkflow>;
  /** Claves de etapa que acepta mover_etapa, en el orden del Embudo. */
  stageKeys: readonly string[];
};

export const fijarCotizacionSchema = z.object({
  monto: z.number().positive().max(9_999_999).describe("Total cotizado al cliente en pesos mexicanos, p. ej. 5500"),
});

// Solo las claves vigentes (mínimo 1: z.enum exige una lista no vacía).
export function moverEtapaSchemaFor(stageKeys: readonly string[]) {
  const keys = stageKeys.length ? [...stageKeys] : ["inbox"];
  return z.object({
    etapa: z.enum(keys as [string, ...string[]]).describe("Clave de la etapa del Embudo a la que avanza el contacto (solo hacia adelante)"),
  });
}

export const avisoVendedorSchema = z.object({
  motivo: z.enum(AVISO_MOTIVOS).describe("cotejar_deposito = el cliente pagó y el pago cuadra (el vendedor ve \"Depósito recibido\"); cliente_pide_humano = pidió hablar con una persona; comprobante_dudoso = el comprobante no cuadra o se ve dudoso"),
  detalle: z.string().max(500).optional().describe("Qué debe saber el vendedor, en una frase (no hace falta con cotejar_deposito)"),
});

// Lo que ve el MODELO (todo opcional). El runtime vuelve a validar CAMPO POR CAMPO
// (parseDetalle): un campo raro se descarta sin tirar los demás.
// Cada campo acepta null = "el cliente no lo dijo" (28-sep-2026): Luna manda SIEMPRE todos
// los campos y, sin null, los rellenaba con 0, "" o "no_sabe" (en producción, 46 de 50
// niveles de agua del agente eran "0 cm"). parseDetalle ignora los null.
const SIN_DATO = " (null si el cliente no lo dijo)";
export const actualizarDetalleSchema = z.object({
  tiene_inundaciones: z.enum(["si", "no", "no_sabe"]).nullable().optional().describe(`Si el cliente dijo que se le mete el agua: si, no o no_sabe (solo si dijo que no sabe)${SIN_DATO}`),
  nivel_agua_cm: z.number().nullable().optional().describe(`Hasta dónde llega el agua, en centímetros (0.5 m = 50)${SIN_DATO}`),
  nivel_agua_texto: z.string().nullable().optional().describe(`Cómo lo describió el cliente, corto (p. ej. "le llega a la rodilla")${SIN_DATO}`),
  num_entradas: z.number().nullable().optional().describe(`Cuántas entradas quiere proteger${SIN_DATO}`),
  anchos_cm: z.array(z.number()).nullable().optional().describe(`Ancho de cada entrada en centímetros, en orden (uno por entrada)${SIN_DATO}`),
  porcentaje_convencimiento: z.number().nullable().optional().describe("Qué tan convencido está de comprar: 0 a 100, de 10 en 10"),
  comentario: z.string().nullable().optional().describe(`Un dato útil NUEVO que dio el cliente, en una frase (p. ej. "tiene cochera con desnivel")${SIN_DATO}`),
});

// "DESPUÉS de tu respuesta…": medido con Sonnet 5 real (26-sep-2026), sin esa frase 2 de
// 19 respuestas salieron SOLO con acciones (el cliente habría recibido el texto de
// respaldo en vez de su respuesta); con ella, 0 (detalle en docs/agente-ia.md).
export const ACTUALIZAR_DETALLE_DESCRIPTION =
  "Guarda en el Detalle del contacto (el cliente no lo ve) lo que el cliente dijo en el chat. Siempre va DESPUÉS de tu respuesta escrita al cliente, nunca en su lugar. Llena solo con lo que él dijo, sin adivinar ni suponer, y manda solo lo nuevo o lo que cambió. Actualiza el % de convencimiento conforme avance la conversación. El comentario no repite los ya guardados.";

export type DetalleIa = {
  tieneInundaciones?: "si" | "no" | "no_sabe";
  nivelAguaCm?: number;
  nivelAguaTexto?: string;
  numEntradas?: number;
  anchosCm?: number[];
  porcentajeConvencimiento?: number;
  comentario?: string;
};

// Validación CAMPO POR CAMPO con los mismos límites que el Detalle en la UI
// (lib/actions/contact-qualification.ts): enteros en cm, 0–1000; entradas 1–50;
// % de 10 en 10. Redondea lo que el modelo mandó con decimales. null = nada válido.
export function parseDetalle(input: unknown): DetalleIa | null {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[%\s]/g, ""))) ? Number(v.replace(/[%\s]/g, "")) : null);
  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, max) : null;
  };
  const out: DetalleIa = {};
  if (raw.tiene_inundaciones === "si" || raw.tiene_inundaciones === "no" || raw.tiene_inundaciones === "no_sabe") out.tieneInundaciones = raw.tiene_inundaciones;
  const nivel = num(raw.nivel_agua_cm);
  // 0 cm no es un nivel de agua (sin agua es tiene_inundaciones = no): es relleno del modelo.
  if (nivel !== null && nivel > 0 && nivel <= 1000) out.nivelAguaCm = Math.round(nivel);
  const nivelTexto = text(raw.nivel_agua_texto, 200);
  if (nivelTexto) out.nivelAguaTexto = nivelTexto;
  const entradas = num(raw.num_entradas);
  if (entradas !== null && Number.isInteger(entradas) && entradas >= 1 && entradas <= 50) out.numEntradas = entradas;
  if (Array.isArray(raw.anchos_cm)) {
    const anchos = raw.anchos_cm.map(num).map((a) => (a === null ? null : Math.round(a)));
    // Un ancho inválido invalida la lista (se perdería a qué entrada va cada uno).
    if (anchos.length > 0 && anchos.length <= 50 && anchos.every((a): a is number => a !== null && a >= 1 && a <= 1000)) out.anchosCm = anchos;
  }
  const pct = num(raw.porcentaje_convencimiento);
  if (pct !== null && pct >= 0 && pct <= 100) out.porcentajeConvencimiento = Math.round(pct / 10) * 10;
  const comentario = text(raw.comentario, 500);
  if (comentario) out.comentario = comentario;
  return Object.keys(out).length ? out : null;
}

// Regla del dueño (28-sep-2026): el monto es el total de lo que el CLIENTE eligió, no lo
// primero que se le cotizó (si se cotizaron 2 y eligió 1, es el total de 1). El lector en
// segundo plano (lector.ts) lo corrige igual si el chat cambia después.
export const FIJAR_COTIZACION_DESCRIPTION =
  "Guarda el total de lo que el CLIENTE eligió comprar, en pesos (el total que le dijiste por lo que pidió: compuerta o compuertas más lo que incluya). No es para accesorios sueltos ni precios de referencia. Llámala cada vez que le des un total o el total cambie; si el cliente cambia lo que quiere (p. ej. de 2 compuertas a 1), llámala con el total nuevo cuando se lo digas.";
export function moverEtapaDescription(stages: readonly FunnelStage[]): string {
  const order = sortStages(stages)
    .map((s) => `${s.key} (${s.name})`)
    .join(" → ");
  return `Avanza al contacto a una etapa del Embudo, por su clave: ${order}. Úsala cuando se cumpla la regla de esa etapa (sección ETAPAS DEL EMBUDO). Llévalo directo a la etapa que corresponde aunque se salte las de en medio (p. ej. si ya quiere pagar). Solo avanza; un retroceso o la misma etapa se ignoran.`;
}
export const AVISO_VENDEDOR_DESCRIPTION =
  "Deja un aviso interno al vendedor; el cliente no lo ve y tú sigues atendiendo. Motivos: cotejar_deposito (pago que confirmaste), cliente_pide_humano, comprobante_dudoso (en una frase, por qué). Cuándo usar cada uno lo dice el Goal.";

// Puro: arma el ToolSet a partir de las filas de workflows (orden estable: la
// consulta viene por position; fijas al final → la caché del prompt no se rompe).
export function buildAgentTools(rows: readonly { id: string; slug: string; name: string; description: string }[], stages: readonly FunnelStage[]): AgentTools {
  const tools: ToolSet = {};
  const byName = new Map<string, AgentToolWorkflow>();
  const stageKeys = sortStages(stages).map((s) => s.key);
  for (const w of rows) {
    const name = toolNameFor(w.slug);
    if (byName.has(name)) continue;
    tools[name] = tool({ description: w.description.trim() || w.name, inputSchema: z.object({}) });
    byName.set(name, { id: w.id, slug: w.slug, name: w.name });
  }
  tools[TOOL_FIJAR_COTIZACION] = tool({ description: FIJAR_COTIZACION_DESCRIPTION, inputSchema: fijarCotizacionSchema });
  tools[TOOL_MOVER_ETAPA] = tool({ description: moverEtapaDescription(stages), inputSchema: moverEtapaSchemaFor(stageKeys) });
  tools[TOOL_AVISO_VENDEDOR] = tool({ description: AVISO_VENDEDOR_DESCRIPTION, inputSchema: avisoVendedorSchema });
  // Al final (orden estable): la caché del prompt de las herramientas de arriba no cambia.
  tools[TOOL_ACTUALIZAR_DETALLE] = tool({ description: ACTUALIZAR_DETALLE_DESCRIPTION, inputSchema: actualizarDetalleSchema });
  return { tools, byName, stageKeys };
}

export type ValidToolCall =
  | { kind: "workflow"; workflow: AgentToolWorkflow }
  | { kind: "cotizacion"; monto: number }
  | { kind: "etapa"; etapa: string }
  | { kind: "aviso"; aviso: z.infer<typeof avisoVendedorSchema> }
  | { kind: "detalle"; detalle: DetalleIa };

// Valida lo que pidió el modelo contra las herramientas ofrecidas: una
// desconocida (workflow deshabilitado entre la llamada y ahora, o nombre
// inventado) se ignora y se registra. Los argumentos se re-validan con Zod.
export function validateToolCalls(calls: readonly ToolCallOutput[], tools: AgentTools): { valid: ValidToolCall[]; ignored: string[] } {
  const valid: ValidToolCall[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    if (c.toolName === TOOL_FIJAR_COTIZACION) {
      const p = fijarCotizacionSchema.safeParse(c.input);
      if (p.success) valid.push({ kind: "cotizacion", monto: p.data.monto });
      else ignored.push(`${c.toolName}: argumentos inválidos`);
      continue;
    }
    if (c.toolName === TOOL_MOVER_ETAPA) {
      const p = moverEtapaSchemaFor(tools.stageKeys).safeParse(c.input);
      if (p.success) valid.push({ kind: "etapa", etapa: p.data.etapa });
      else ignored.push(`${c.toolName}: argumentos inválidos`);
      continue;
    }
    if (c.toolName === TOOL_AVISO_VENDEDOR) {
      const p = avisoVendedorSchema.safeParse(c.input);
      if (p.success) valid.push({ kind: "aviso", aviso: p.data });
      else ignored.push(`${c.toolName}: argumentos inválidos`);
      continue;
    }
    if (c.toolName === TOOL_ACTUALIZAR_DETALLE) {
      // Sin aviso al vendedor si no trae nada válido: el Detalle es de apoyo y un dato
      // raro del modelo no debe molestar a nadie (queda en el log del worker).
      const d = parseDetalle(c.input);
      if (d) valid.push({ kind: "detalle", detalle: d });
      else ignored.push(`${c.toolName}: sin datos válidos`);
      continue;
    }
    const wf = tools.byName.get(c.toolName);
    if (!wf) {
      ignored.push(`${c.toolName}: herramienta desconocida o deshabilitada`);
      continue;
    }
    if (seen.has(c.toolName)) continue; // la misma media dos veces en una respuesta cuenta una vez
    seen.add(c.toolName);
    valid.push({ kind: "workflow", workflow: wf });
  }
  return { valid, ignored };
}

/**
 * Traspaso Luna → Sonnet (revisión completa, 27-sep-2026): la respuesta la escribe el Modelo 2,
 * pero las ACCIONES que ya decidió el Modelo 1 no se pierden. Sin esto, si Luna pidió
 * `wf_datos_bancarios` (y por eso hubo traspaso) y Sonnet contestó "te paso los datos" sin volver
 * a pedir la herramienta, los datos nunca salían y el contacto quedaba en Cerca de compra.
 * Regla: mandan las llamadas del Modelo 2; de las del Modelo 1 se conservan los workflows que el
 * Modelo 2 no repitió, los avisos con un motivo que no repitió y el Detalle (antes del del Modelo 2,
 * que gana campo por campo). La cotización del Modelo 1 NO se arrastra: el cliente lee el texto del
 * Modelo 2, y un monto que ese texto no dice no se fija (prepareActions lo rechazaría con aviso al
 * vendedor). La etapa la pone quien llama (la del traspaso).
 */
export function mergeHandoffToolCalls(first: readonly ValidToolCall[], second: readonly ValidToolCall[]): ValidToolCall[] {
  const out: ValidToolCall[] = [];
  const detalleFirst = first.filter((c) => c.kind === "detalle");
  const workflows = new Set(second.flatMap((c) => (c.kind === "workflow" ? [c.workflow.id] : [])));
  const motivos = new Set(second.flatMap((c) => (c.kind === "aviso" ? [c.aviso.motivo] : [])));
  out.push(...detalleFirst);
  for (const c of first) {
    if (c.kind === "workflow" && !workflows.has(c.workflow.id)) {
      workflows.add(c.workflow.id);
      out.push(c);
    } else if (c.kind === "aviso" && !motivos.has(c.aviso.motivo)) {
      motivos.add(c.aviso.motivo);
      out.push(c);
    }
    // "cotizacion" y "etapa" del Modelo 1 no se arrastran (ver arriba); "detalle" ya va arriba.
  }
  out.push(...second);
  return out;
}

