// Herramientas del cerebro (Fase D, parte b): UNA por workflow habilitado con
// disparador "agente" (`wf_<slug>`, descripción = "Cuándo usarlo" del workflow,
// editable por el admin) más `fijar_cotizacion` (guarda el total cotizado en el
// contacto para que un comprobante se pueda verificar). Sin `execute`: el modelo
// devuelve texto + llamadas en UNA vuelta y el runtime decide qué corre.
// PURO (sin BD): las filas las carga loadAgentTools en actions.ts.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { toolNameFor } from "@/lib/workflows/defaults";
import type { ToolCallOutput } from "@/lib/ai/types";

export const TOOL_FIJAR_COTIZACION = "fijar_cotizacion";
export const TOOL_PREFIX = "wf_";

export type AgentToolWorkflow = { id: string; slug: string; name: string };

export type AgentTools = {
  tools: ToolSet;
  byName: ReadonlyMap<string, AgentToolWorkflow>;
};

const STAGES = ["inbox", "prospecto", "interesado", "cerca_compra", "compra"] as const;

// Argumentos por workflow (los demás no llevan). Todo `strict`: campos fijos.
const comprobanteArgs = z.object({
  monto: z.string().describe("Monto tal como aparece en el comprobante, p. ej. \"$5,500.00\""),
  fecha: z.string().nullable().describe("Fecha del comprobante tal como aparece, o null si no se lee"),
  banco: z.string().nullable().describe("Banco emisor tal como aparece, o null"),
  referencia: z.string().describe("Referencia, folio o clave de rastreo tal como aparece"),
});

const ARGS: Record<string, z.ZodTypeAny> = {
  cambiar_etapa: z.object({ etapa: z.enum(STAGES).describe("Etapa del Embudo a la que pasa el contacto") }),
  transferir_humano: z.object({ motivo: z.string().describe("Por qué pasa a un asesor, en una frase") }),
  pago_confirmado: comprobanteArgs,
  anticipo_confirmado: comprobanteArgs,
  pago_no_cuadra: z.object({ motivo: z.string().describe("Qué no cuadra o no se lee, en una frase") }),
};

export function argsSchemaFor(slug: string): z.ZodTypeAny {
  return ARGS[slug] ?? z.object({});
}

export const fijarCotizacionSchema = z.object({
  monto: z.number().positive().describe("Total cotizado al cliente en pesos mexicanos, p. ej. 5500"),
});

// Herramienta fija del CRM (no es un workflow).
export const FIJAR_COTIZACION_DESCRIPTION =
  "Guarda el total cotizado al cliente en pesos (sin IVA aparte: el total que le dijiste). " +
  "Llámala cada vez que le des un total o el total cambie (otro tamaño, tapones, envío). " +
  "Sin esto el CRM no puede verificar su comprobante de pago.";

// Puro: arma el ToolSet a partir de las filas (testeable sin BD).
export function buildAgentTools(
  rows: readonly { id: string; slug: string; name: string; description: string }[],
): AgentTools {
  const tools: ToolSet = {};
  const byName = new Map<string, AgentToolWorkflow>();
  for (const w of rows) {
    const name = toolNameFor(w.slug);
    if (byName.has(name)) continue;
    tools[name] = tool({ description: w.description.trim() || w.name, inputSchema: argsSchemaFor(w.slug) });
    byName.set(name, { id: w.id, slug: w.slug, name: w.name });
  }
  tools[TOOL_FIJAR_COTIZACION] = tool({ description: FIJAR_COTIZACION_DESCRIPTION, inputSchema: fijarCotizacionSchema });
  return { tools, byName };
}

export type ValidToolCall =
  | { kind: "workflow"; workflow: AgentToolWorkflow; args: Record<string, unknown> }
  | { kind: "cotizacion"; monto: number };

// Valida lo que pidió el modelo contra las herramientas ofrecidas: una
// desconocida (workflow deshabilitado entre la llamada y ahora, o nombre
// inventado) se ignora y se registra. Los argumentos se re-validan con Zod.
export function validateToolCalls(calls: readonly ToolCallOutput[], tools: AgentTools): { valid: ValidToolCall[]; ignored: string[] } {
  const valid: ValidToolCall[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    if (c.toolName === TOOL_FIJAR_COTIZACION) {
      const parsed = fijarCotizacionSchema.safeParse(c.input);
      if (!parsed.success) {
        ignored.push(`${c.toolName}: argumentos inválidos`);
        continue;
      }
      valid.push({ kind: "cotizacion", monto: parsed.data.monto });
      continue;
    }
    const wf = tools.byName.get(c.toolName);
    if (!wf) {
      ignored.push(`${c.toolName}: herramienta desconocida o deshabilitada`);
      continue;
    }
    const parsed = argsSchemaFor(wf.slug).safeParse(c.input ?? {});
    if (!parsed.success) {
      ignored.push(`${c.toolName}: argumentos inválidos`);
      continue;
    }
    // La misma herramienta dos veces en una respuesta cuenta una vez.
    if (seen.has(c.toolName)) continue;
    seen.add(c.toolName);
    valid.push({ kind: "workflow", workflow: wf, args: parsed.data as Record<string, unknown> });
  }
  return { valid, ignored };
}
