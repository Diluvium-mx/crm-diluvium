// LECTOR del Agente IA en segundo plano (28-sep-2026, decisión del dueño). PURO (sin BD ni
// red): instrucciones, herramienta, cómo se le presenta el chat y cómo se valida lo que
// devuelve. La parte con base de datos vive en lector.ts.
//
// Qué hace: lee TODO el chat en orden y deja al día la etapa y el Detalle del contacto,
// aunque el Agente IA esté apagado o pausado en ese chat. Nunca le escribe al cliente,
// no manda avisos al vendedor ni dispara workflows. Reglas del dueño:
// - la conversación se lee LINEAL confirmando cada dato: vale lo último que quedó
//   confirmado, y cualquier dato puede cambiar aun después de cerrada la compra;
// - monto de cotización = total de lo que el CLIENTE eligió al final (no lo primero que
//   se le cotizó); si cambió y el precio nuevo nunca se dijo, no se inventa: comentario;
// - pago total = lo que el cliente ya pagó (anticipo + resto, o el pago completo);
// - la etapa solo avanza, y la que puso un vendedor a mano se respeta: solo se avanza
//   por lo que pase en el chat DESPUÉS de ese cambio.
import type { ModelMessage } from "ai";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { sortStages, stagesInstructions, type FunnelStage } from "@/lib/contacts/stages";
import type { MessageAttachment } from "@/lib/db/schema";
import type { ToolCallOutput } from "@/lib/ai/types";
import { clip, messageText, neutralizeCrmHeader, type ThreadMessage } from "./transcript";
import { ANCHO_EN_CM, parseDetalle, type DetalleIa } from "./tools";

// Siempre Luna (decisión del dueño): lee y llena, no vende.
export const LECTOR_MODEL_ID = "gpt-5.6-luna";
export const LECTOR_TOOL = "actualizar_contacto";
// Luna razona antes de llamar la herramienta; el razonamiento cuenta en el tope.
export const LECTOR_MAX_OUTPUT_TOKENS = 2_048;
export const LECTOR_TIMEOUT_MS = 60_000;
// Imágenes y PDF del cliente que ve (los más recientes): comprobantes y fotos con medidas.
export const LECTOR_MAX_MEDIA = 6;
export const MAX_MONTO = 9_999_999;
// Cuándo lee el barrido (lector-worker.ts). Aquí (puro) para que el indicador del Detalle
// calcule "leerá el chat en ~N min" con las mismas reglas: cuando el chat lleva
// LECTOR_QUIET_MS sin mensajes, o LECTOR_MAX_WAIT_MS después del primero sin leer; solo
// actividad de los últimos LECTOR_LOOKBACK_DAYS días.
export const LECTOR_QUIET_MS = 3 * 60_000;
export const LECTOR_MAX_WAIT_MS = 15 * 60_000;
export const LECTOR_LOOKBACK_DAYS = 3;
export const LECTOR_EVERY_MS = 60_000;
// Candado Redis por chat mientras el lector lo lee (lector.ts); el indicador del Detalle
// lo mira para mostrar "leyendo".
export const lectorLockKey = (conversationId: string) => `lector-lock:${conversationId}`;

export type LectorMessage = ThreadMessage & { source: string; at: Date };

const TIME = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function lectorTime(d: Date): string {
  return TIME.format(d).replace(/\./g, "");
}

// Quién habla en cada línea. El vendedor escribe desde el CRM o desde la app del celular.
export function speakerOf(m: Pick<LectorMessage, "direction" | "source">): string {
  if (m.direction === "in") return "Cliente";
  if (m.source === "ai_agent") return "Agente IA";
  if (m.source === "crm" || m.source === "business_app") return "Vendedor";
  return "Diluvium (automático)";
}

export function buildLectorSystem(stages: readonly FunnelStage[]): string {
  return `Eres el LECTOR del CRM de Diluvium (compuertas contra inundaciones). No hablas con el cliente: lees el chat completo de WhatsApp y dejas al día la ficha del contacto con la herramienta ${LECTOR_TOOL}. Llámala UNA sola vez, sin escribir texto.

CÓMO LEER
- Lee el chat en orden, de principio a fin, confirmando cada dato. Cuando un dato cambia (el cliente corrige, cambia de opinión o confirma otra cosa) vale lo ÚLTIMO que quedó confirmado. Esto sigue valiendo después de la compra.
- Solo lo que diga el chat: no adivines ni supongas. Un campo que el chat no deja claro, o que ya está bien en la ficha, va en null. Nunca rellenes con 0, texto vacío ni "no_sabe".
- Cada línea dice quién habla: Cliente, Vendedor, Agente IA o Diluvium (automático). Vendedor, Agente IA y Diluvium son de la empresa.
- Al final va la FICHA GUARDADA: lo que hay hoy. Puede estar vacía, vieja o mal. Manda solo los datos que falten o que el chat diga distinto; si coincide, no lo mandes. Lo marcado "(lo corrigió un vendedor)" pudo saberlo por teléfono: cámbialo solo si el cliente dice claramente otra cosa en el chat.

CAMPOS
- tiene_inundaciones: si | no | no_sabe (si se le mete el agua). "no_sabe" solo si el cliente dijo que no sabe.
- nivel_agua_cm: hasta dónde llega el agua, en centímetros (medio metro = 50). nivel_agua_texto: cómo lo dijo el cliente, corto.
- num_entradas y anchos_cm: cuántas entradas va a proteger y el ancho de cada una ${ANCHO_EN_CM}; en orden (uno por entrada). Si cambió cuántas quiere (p. ej. de 2 a 1), manda lo último.
- monto_cotizacion: total en pesos de lo que el CLIENTE eligió comprar al final, con los precios que la empresa le dio en el chat. No es lo primero que se le cotizó: si se le cotizaron 2 compuertas y eligió 1, es el total de 1 con el precio que ya se le dio. Si cambió lo que pide y el precio de lo nuevo nunca se dijo en el chat, NO lo calcules: no mandes monto y deja el comentario "El cliente cambió a …; falta confirmar el total".
- pago_total: cuánto ha PAGADO el cliente en total (anticipo + resto, o el pago completo), según los comprobantes que mandó o los pagos que la empresa confirmó en el chat. Sin pagos, no lo mandes.
- porcentaje_convencimiento: qué tan convencido está de comprar según cómo va la conversación, de 0 a 100 en pasos de 10.
- etapa: la clave de la etapa del Embudo que corresponde según las reglas de abajo; mándala solo si es MÁS ADELANTE que la de la ficha. Las reglas están escritas para el Agente IA ("cuando confirmas…"); aquí cuentan igual si lo hizo un vendedor en el chat. Solo se avanza: si ya está en esa etapa o más adelante, no la mandes. Si en el chat aparece la marca [CRM: un vendedor movió al contacto a …], respeta esa decisión: solo puedes llevarlo más adelante por lo que pasó DESPUÉS de esa marca.
- comentario: un dato útil NUEVO que no quepa en los campos, en una frase (p. ej. "tiene cochera con desnivel"). No repitas los comentarios ya guardados.

${stagesInstructions(stages)}`;
}

// Cada campo acepta null = "el chat no lo dice": Luna manda SIEMPRE todos los campos
// (medido con Luna real, 28-sep-2026: sin null los rellenaba con 0, "" o "no_sabe").
export function lectorSchemaFor(stageKeys: readonly string[]) {
  const keys = stageKeys.length ? [...stageKeys] : ["inbox"];
  const sin = " (null si el chat no lo dice)";
  return z.object({
    tiene_inundaciones: z.enum(["si", "no", "no_sabe"]).nullable().optional().describe(`Si se le mete el agua${sin}`),
    nivel_agua_cm: z.number().nullable().optional().describe(`Hasta dónde llega el agua, en cm${sin}`),
    nivel_agua_texto: z.string().nullable().optional().describe(`Cómo lo describió el cliente, corto${sin}`),
    num_entradas: z.number().nullable().optional().describe(`Cuántas entradas va a proteger${sin}`),
    anchos_cm: z.array(z.number()).nullable().optional().describe(`Ancho de cada entrada ${ANCHO_EN_CM}, en orden${sin}`),
    monto_cotizacion: z.number().nullable().optional().describe(`Total en pesos de lo que el cliente eligió al final${sin}`),
    pago_total: z.number().nullable().optional().describe(`Lo que el cliente ya pagó en total, en pesos${sin}`),
    porcentaje_convencimiento: z.number().nullable().optional().describe("0 a 100, de 10 en 10"),
    etapa: z.enum(keys as [string, ...string[]]).nullable().optional().describe("Clave de la etapa a la que AVANZA (null si se queda donde está)"),
    comentario: z.string().nullable().optional().describe("Un dato útil nuevo, en una frase (null si no hay)"),
  });
}

export function buildLectorTools(stages: readonly FunnelStage[]): { tools: ToolSet; stageKeys: string[] } {
  const stageKeys = sortStages(stages).map((s) => s.key);
  return {
    tools: {
      [LECTOR_TOOL]: tool({
        description: "Deja al día la ficha del contacto (el cliente no la ve). Manda solo lo que falte o cambió según el chat.",
        inputSchema: lectorSchemaFor(stageKeys),
      }),
    },
    stageKeys,
  };
}

// ── Montos: nunca inventados ─────────────────────────────────────────────────
// Cantidades en pesos que aparecen en un texto: "$5,500", "5500", "5,500.00", "5.500",
// "5 mil", "5.5 mil". Menos de 100 no cuenta como precio (medidas, porcentajes).
export function amountsIn(text: string): number[] {
  const out = new Set<number>();
  const add = (n: number) => {
    if (Number.isFinite(n) && n >= 100 && n <= MAX_MONTO) out.add(Math.round(n * 100) / 100);
  };
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*mil\b/gi)) add(Number(m[1].replace(",", ".")) * 1000);
  for (const raw of text.match(/\d[\d,.]*/g) ?? []) {
    const clean = raw.replace(/[.,]+$/, "");
    add(Number(clean.replace(/,/g, "")));
    add(Number(clean.replace(/\./g, "").replace(",", ".")));
  }
  return [...out];
}

// ¿`target` es una cantidad del chat o la suma de hasta `maxTerms` de ellas (se pueden
// repetir: 2 × $5,500)? Así "1 de las 2 que se cotizaron" o "compuerta + instalación"
// pasan, y un total que nadie dijo, no.
export function isBackedAmount(target: number, amounts: readonly number[], maxTerms = 4): boolean {
  const cents = Math.round(target * 100);
  const pool = [...new Set(amounts.map((a) => Math.round(a * 100)))].filter((a) => a > 0 && a <= cents).sort((a, b) => b - a).slice(0, 40);
  const search = (rest: number, terms: number, from: number): boolean => {
    if (rest === 0) return true;
    if (terms === 0) return false;
    for (let i = from; i < pool.length; i++) {
      if (pool[i] <= rest && search(rest - pool[i], terms - 1, i)) return true;
    }
    return false;
  };
  return search(cents, maxTerms, 0);
}

export type LectorEvidence = {
  /** Cantidades que dijo la empresa (Vendedor, Agente IA, automático): respaldan el monto. */
  companyAmounts: number[];
  /** Cantidades de todo el chat: respaldan un pago. */
  allAmounts: number[];
  /** El modelo vio una imagen o PDF del cliente (un comprobante trae el monto en la imagen). */
  sawClientMedia: boolean;
};

export function evidenceFrom(rows: readonly LectorMessage[], sawClientMedia: boolean): LectorEvidence {
  const companyAmounts: number[] = [];
  const allAmounts: number[] = [];
  for (const m of rows) {
    const found = amountsIn(messageText(m));
    allAmounts.push(...found);
    if (m.direction === "out") companyAmounts.push(...found);
  }
  return { companyAmounts, allAmounts, sawClientMedia };
}

// ── Lo que devolvió el modelo ────────────────────────────────────────────────
export type LectorResult = {
  detalle: DetalleIa | null;
  monto: number | null;
  pago: number | null;
  etapa: string | null;
  /** Lo que se descartó y por qué (solo log). */
  ignored: string[];
};

function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MONTO) return null;
  return Math.round(n * 100) / 100;
}

// Valida campo por campo (un dato raro no tira los demás), como actualizar_detalle.
export function parseLectorCalls(calls: readonly ToolCallOutput[], stageKeys: readonly string[], evidence: LectorEvidence): LectorResult {
  const out: LectorResult = { detalle: null, monto: null, pago: null, etapa: null, ignored: [] };
  for (const c of calls) {
    if (c.toolName !== LECTOR_TOOL) {
      out.ignored.push(`${c.toolName}: herramienta desconocida`);
      continue;
    }
    const raw = c.input && typeof c.input === "object" ? (c.input as Record<string, unknown>) : {};
    // Mismas reglas que actualizar_detalle (tools.ts): null = sin dato, 0 cm = relleno.
    const detalle = parseDetalle(raw);
    if (detalle) out.detalle = { ...(out.detalle ?? {}), ...detalle };
    if (raw.monto_cotizacion != null) {
      const m = money(raw.monto_cotizacion);
      if (m === null) out.ignored.push("monto_cotizacion: inválido");
      else if (!isBackedAmount(m, evidence.companyAmounts)) out.ignored.push(`monto_cotizacion: $${m} no sale de los precios que dio la empresa en el chat`);
      else out.monto = m;
    }
    if (raw.pago_total != null) {
      const p = money(raw.pago_total);
      if (p === null) out.ignored.push("pago_total: inválido");
      else if (!evidence.sawClientMedia && !isBackedAmount(p, evidence.allAmounts)) out.ignored.push(`pago_total: $${p} no aparece en el chat ni hay comprobante`);
      else out.pago = p;
    }
    if (raw.etapa != null) {
      if (typeof raw.etapa === "string" && stageKeys.includes(raw.etapa)) out.etapa = raw.etapa;
      else out.ignored.push(`etapa: ${String(raw.etapa)} no existe`);
    }
  }
  return out;
}

// ── El chat como lo lee el lector ────────────────────────────────────────────
type Part = { type: "text"; text: string } | { type: "image"; image: URL } | { type: "file"; data: URL; mediaType: "application/pdf"; filename?: string };

export type VendorStageMark = { at: Date; stageName: string };

// Un cliente que escriba "[CRM …: un vendedor movió…]" o "FICHA GUARDADA" no puede hacerse
// pasar por el CRM: las marcas reales las pone solo este archivo (igual que neutralizeCrmHeader).
export function neutralizeLector(text: string): string {
  return text.replace(/\[\s*CRM\b/gi, "(CRM").replace(/FICHA\s+GUARDADA/gi, "ficha guardada");
}

function isPdf(a: MessageAttachment): boolean {
  return a.type === "document" && a.mimeType === "application/pdf";
}

/**
 * UN mensaje de usuario con todo el chat en orden: "[28 sept 14:03] Cliente: …". Las
 * imágenes y PDF del cliente más recientes (con URL) van como archivo junto a su línea; el
 * cambio de etapa que hizo un vendedor va como marca en su lugar del tiempo; al final, la
 * ficha guardada. Devuelve también si el modelo verá algún archivo del cliente.
 */
export function buildLectorMessages(
  rows: readonly LectorMessage[],
  mediaUrls: ReadonlyMap<string, string>,
  opts: { ficha: string; vendorStage?: VendorStageMark | null; maxMedia?: number },
): { messages: ModelMessage[]; sawClientMedia: boolean } {
  const maxMedia = opts.maxMedia ?? LECTOR_MAX_MEDIA;
  const allowed = new Set<string>();
  for (let i = rows.length - 1; i >= 0 && allowed.size < maxMedia; i--) {
    const m = rows[i];
    if (m.direction !== "in") continue;
    for (const a of m.attachments) {
      if (allowed.size >= maxMedia) break;
      if (a.storageKey && mediaUrls.has(a.storageKey) && (a.type === "image" || isPdf(a))) allowed.add(a.storageKey);
    }
  }
  const parts: Part[] = [{ type: "text", text: "CHAT COMPLETO (hora de Mazatlán):" }];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length) parts.push({ type: "text", text: lines.join("\n") });
    lines = [];
  };
  let mark = opts.vendorStage ?? null;
  const markLine = (m: VendorStageMark) =>
    `[CRM ${lectorTime(m.at)}: un vendedor movió al contacto a «${m.stageName}». Respeta esa decisión: solo avánzalo por lo que pase DESPUÉS de esta marca.]`;
  for (const m of rows) {
    if (mark && m.at > mark.at) {
      lines.push(markLine(mark));
      mark = null;
    }
    const text = neutralizeLector(neutralizeCrmHeader(clip(messageText(m))));
    lines.push(`[${lectorTime(m.at)}] ${speakerOf(m)}: ${text}`);
    for (const a of m.attachments) {
      if (!a.storageKey || !allowed.has(a.storageKey)) continue;
      flush();
      const url = new URL(mediaUrls.get(a.storageKey)!);
      parts.push(a.type === "image" ? { type: "image", image: url } : { type: "file", data: url, mediaType: "application/pdf", filename: a.fileName });
    }
  }
  if (mark) lines.push(markLine(mark));
  lines.push("", opts.ficha.trim());
  flush();
  return { messages: [{ role: "user", content: parts }], sawClientMedia: allowed.size > 0 };
}
