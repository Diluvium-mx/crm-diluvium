// FILTRO del Agente IA (Fase B): un modelo económico decide qué hacer con los
// mensajes pendientes ANTES de gastar en el cerebro. El prompt y el parseo son
// puros (testeables); la llamada al modelo la hace el orquestador (run.ts).

export type FilterDecision = "spam" | "lead_no_sigue" | "necesita_cerebro" | "pasar_a_humano";

export const FILTER_DECISIONS: readonly FilterDecision[] = [
  "spam",
  "lead_no_sigue",
  "necesita_cerebro",
  "pasar_a_humano",
];

// Las reglas de "pasar a humano" siguen la sección TRANSFERENCIA A HUMANO del
// Goal de Angela; las fotos y los comprobantes de pago NUNCA transfieren.
export const FILTER_SYSTEM = `Eres el FILTRO de la bandeja de WhatsApp de Diluvium (compuertas y tapones contra inundaciones). NO respondes al cliente: solo clasificas sus mensajes pendientes (los últimos, marcados como PENDIENTES) usando la conversación como contexto.

Categorías (elige UNA):
- "spam": publicidad, cadenas, bots, mensajes automáticos, número equivocado evidente o contenido sin relación con Diluvium.
- "lead_no_sigue": el cliente solo cierra o acusa recibo y no espera respuesta ("gracias", "ok", "👍", "sale", "va") cuando no hay ninguna pregunta ni pendiente abierto. NO incluye objeciones de precio ni "lo voy a pensar" / "después te aviso" (esas van a necesita_cerebro).
- "pasar_a_humano": el cliente pide expresamente hablar con una persona; pide un enlace para pagar con tarjeta; reporta un problema de garantía, devolución, daño o pedido incompleto; reporta un problema con Amazon o Mercado Libre; pide una excepción, descuento o condición no autorizada; menciona fraude, estafa o engaño, o insulta de forma persistente.
- "necesita_cerebro": todo lo demás que merece respuesta: preguntas, saludos, medidas, fotos, precios, objeciones, dudas de compra, comprobantes de pago o datos de envío.

Reglas: recibir fotografías NUNCA es motivo para pasar a humano; un comprobante de pago tampoco. Si dudas, elige "necesita_cerebro".

Responde SOLO con un objeto JSON en una línea, sin texto extra: {"decision":"<categoría>","motivo":"<máx 12 palabras>"}`;

export type ParsedFilter = { decision: FilterDecision; motivo: string | null; parsed: boolean };

// Tolerante: acepta JSON (aunque venga envuelto en ```), y si no, busca la
// categoría como palabra. Si no se entiende, cae a "necesita_cerebro" (el
// cerebro sigue el Goal y puede transferir él mismo) y lo marca como no parseado.
export function parseFilterDecision(raw: string): ParsedFilter {
  const text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { decision?: unknown; motivo?: unknown };
      const d = typeof obj.decision === "string" ? obj.decision.trim().toLowerCase() : "";
      if ((FILTER_DECISIONS as readonly string[]).includes(d)) {
        return {
          decision: d as FilterDecision,
          motivo: typeof obj.motivo === "string" ? obj.motivo.slice(0, 200) : null,
          parsed: true,
        };
      }
    } catch {
      // cae al buscador de palabras
    }
  }
  const lower = text.toLowerCase();
  const found = FILTER_DECISIONS.find((d) => lower.includes(d));
  if (found) return { decision: found, motivo: null, parsed: true };
  return { decision: "necesita_cerebro", motivo: null, parsed: false };
}

// Transcripción compacta para el filtro: contexto + los pendientes marcados.
export type TranscriptLine = { role: "cliente" | "diluvium"; text: string; pending: boolean };

export function buildFilterPrompt(lines: readonly TranscriptLine[]): string {
  const body = lines
    .map((l) => `${l.pending ? "[PENDIENTE] " : ""}${l.role === "cliente" ? "Cliente" : "Diluvium"}: ${l.text}`)
    .join("\n");
  return `Conversación (más reciente al final):\n${body}\n\nClasifica los mensajes PENDIENTES del cliente.`;
}
