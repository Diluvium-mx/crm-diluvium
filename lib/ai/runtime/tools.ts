// Herramientas del cerebro (Fase D reestructurada, 24-sep-2026). PURO (sin BD).
// - `wf_<slug>`: una por workflow de media habilitado con disparador "agente"
//   (descripción = "Cuándo usarlo", editable por el admin).
// - `fijar_cotizacion { monto }`: guarda el total cotizado en el contacto.
// - `mover_etapa { etapa }`: avanza la etapa (solo hacia adelante; el CRM ignora
//   retrocesos sin error).
// - `aviso_vendedor { motivo, detalle, monto?, referencia?, banco?, fecha?, tipo? }`:
//   aviso interno 🤖 al vendedor; nunca llega al cliente ni pausa al agente.
// Sin `execute`: el modelo devuelve texto + llamadas en UNA vuelta y el runtime
// decide qué corre. Las reglas de negocio viven en el Goal, no aquí.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { toolNameFor } from "@/lib/workflows/defaults";
import { STAGES } from "@/lib/contacts/stages";
import type { ToolCallOutput } from "@/lib/ai/types";

export const TOOL_FIJAR_COTIZACION = "fijar_cotizacion";
export const TOOL_MOVER_ETAPA = "mover_etapa";
export const TOOL_AVISO_VENDEDOR = "aviso_vendedor";

export const AVISO_MOTIVOS = ["cotejar_deposito", "cliente_pide_humano", "comprobante_dudoso"] as const;
export type AvisoMotivo = (typeof AVISO_MOTIVOS)[number];

export type AgentToolWorkflow = { id: string; slug: string; name: string };

export type AgentTools = {
  tools: ToolSet;
  byName: ReadonlyMap<string, AgentToolWorkflow>;
};

export const fijarCotizacionSchema = z.object({
  monto: z.number().positive().max(9_999_999).describe("Total cotizado al cliente en pesos mexicanos, p. ej. 5500"),
});

export const moverEtapaSchema = z.object({
  etapa: z.enum(STAGES).describe("Etapa del Embudo a la que avanza el contacto (solo hacia adelante)"),
});

export const avisoVendedorSchema = z.object({
  motivo: z.enum(AVISO_MOTIVOS).describe("cotejar_deposito = el cliente pagó y hay que cotejar el depósito; cliente_pide_humano = pidió hablar con una persona; comprobante_dudoso = el comprobante no cuadra o se ve dudoso"),
  detalle: z.string().max(500).describe("Qué debe saber el vendedor, en una o dos frases"),
  monto: z.string().nullable().optional().describe("Monto del comprobante tal como se lee, o null si no se lee"),
  referencia: z.string().nullable().optional().describe("Referencia, folio o clave de rastreo tal como se lee"),
  banco: z.string().nullable().optional().describe("Banco tal como se lee"),
  fecha: z.string().nullable().optional().describe("Fecha del comprobante tal como se lee"),
  tipo: z.enum(["total", "anticipo", "resto"]).nullable().optional().describe("total = pago completo; anticipo = primer pago parcial; resto = liquidación"),
});

export const FIJAR_COTIZACION_DESCRIPTION =
  "Guarda el total de la COMPRA cotizada al cliente en pesos (el total que le dijiste: compuerta o compuertas más lo que incluya). No es para accesorios sueltos ni precios de referencia. Llámala cada vez que le des un total o el total cambie.";
export const MOVER_ETAPA_DESCRIPTION =
  "Avanza al contacto a una etapa del Embudo (inbox → prospecto → interesado → cerca_compra → compra). Úsala cuando el Goal lo indique. Solo avanza; un retroceso o la misma etapa se ignoran.";
export const AVISO_VENDEDOR_DESCRIPTION =
  "Deja un aviso interno al vendedor; el cliente no lo ve y tú sigues atendiendo. Motivos: cotejar_deposito (pago que confirmaste: manda monto, referencia, banco, fecha y tipo), cliente_pide_humano, comprobante_dudoso (manda lo que alcanzaste a leer). Cuándo usar cada uno lo dice el Goal.";

// Puro: arma el ToolSet a partir de las filas de workflows (orden estable: la
// consulta viene por position; fijas al final → la caché del prompt no se rompe).
export function buildAgentTools(rows: readonly { id: string; slug: string; name: string; description: string }[]): AgentTools {
  const tools: ToolSet = {};
  const byName = new Map<string, AgentToolWorkflow>();
  for (const w of rows) {
    const name = toolNameFor(w.slug);
    if (byName.has(name)) continue;
    tools[name] = tool({ description: w.description.trim() || w.name, inputSchema: z.object({}) });
    byName.set(name, { id: w.id, slug: w.slug, name: w.name });
  }
  tools[TOOL_FIJAR_COTIZACION] = tool({ description: FIJAR_COTIZACION_DESCRIPTION, inputSchema: fijarCotizacionSchema });
  tools[TOOL_MOVER_ETAPA] = tool({ description: MOVER_ETAPA_DESCRIPTION, inputSchema: moverEtapaSchema });
  tools[TOOL_AVISO_VENDEDOR] = tool({ description: AVISO_VENDEDOR_DESCRIPTION, inputSchema: avisoVendedorSchema });
  return { tools, byName };
}

export type ValidToolCall =
  | { kind: "workflow"; workflow: AgentToolWorkflow }
  | { kind: "cotizacion"; monto: number }
  | { kind: "etapa"; etapa: (typeof STAGES)[number] }
  | { kind: "aviso"; aviso: z.infer<typeof avisoVendedorSchema> };

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
      const p = moverEtapaSchema.safeParse(c.input);
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
