// Convierte el hilo de WhatsApp en lo que lee el cerebro. PURO (sin DB): mensajes
// del AI SDK con las imágenes del cliente (multimodal) como URLs firmadas del bucket.
//
// El cerebro lee TODA la conversación (23-sep-2026). Solo hay protecciones técnicas
// para no exceder lo que el modelo puede leer: si un chat es enorme, se queda con lo
// más reciente (fitHistory), un mensaje pegado gigante se recorta y las imágenes
// que van como imagen son las más recientes (las demás, como nota de texto).
import type { ModelMessage } from "ai";
import type { MessageAttachment } from "@/lib/db/schema";

// Nota con lo que ya se le envió al cliente después de su último mensaje (ver
// buildModelMessages): la conversación para el modelo nunca termina en un turno nuestro.
export const SENT_AFTER_HEADER = "[Después de este mensaje ya se le envió al cliente:";

// Protección técnica por mensaje (un texto pegado enorme).
export const MAX_MESSAGE_CHARS = 4_000;
// Protección técnica de todo el historial (~85 mil tokens): con el Goal, las FAQs y
// las imágenes cabe en cualquier modelo del catálogo.
export const MAX_HISTORY_CHARS = 300_000;
export const MAX_IMAGES = 20;

export function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… [recortado]` : text;
}

// Un cliente que escriba "[CONTEXTO DEL CRM …]" no puede hacerse pasar por el
// CRM: el encabezado se neutraliza en el texto entrante (el real lo agrega el
// runtime al final del último turno).
export const CRM_CONTEXT_HEADER = "[CONTEXTO DEL CRM";
export function neutralizeCrmHeader(text: string): string {
  return text.replace(/\[\s*CONTEXTO DEL CRM/gi, "(CONTEXTO DEL CRM");
}

// Lo mínimo de una fila de `messages` que se necesita aquí.
export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  templateName: string | null;
  attachments: MessageAttachment[];
};

function attachmentNote(a: MessageAttachment): string {
  switch (a.type) {
    case "image":
      return "[imagen]";
    case "audio":
      return "[audio]";
    case "video":
      return "[video]";
    case "sticker":
      return "[sticker]";
    case "document":
      return `[documento${a.fileName ? `: ${a.fileName}` : ""}]`;
    default:
      return `[adjunto: ${a.type}]`;
  }
}

// Texto visible de un mensaje (cuerpo + notas de adjuntos / plantilla).
export function messageText(m: ThreadMessage): string {
  const parts: string[] = [];
  if (m.body?.trim()) parts.push(clip(m.body.trim()));
  if (!m.body?.trim() && m.templateName) parts.push(`[plantilla: ${m.templateName}]`);
  for (const a of m.attachments) parts.push(attachmentNote(a));
  if (parts.length === 0) parts.push(`[mensaje ${m.type}]`);
  return parts.join(" ");
}

// Toda la conversación mientras quepa; si no, lo más reciente (sin fallar).
export function fitHistory<T extends ThreadMessage>(rows: readonly T[], maxChars = MAX_HISTORY_CHARS): T[] {
  let total = 0;
  let start = rows.length;
  while (start > 0) {
    const size = messageText(rows[start - 1]).length + 20;
    if (total + size > maxChars && start < rows.length) break;
    total += size;
    start--;
  }
  return rows.slice(start);
}

type Part = { type: "text"; text: string } | { type: "image"; image: URL } | { type: "file"; data: URL; mediaType: "application/pdf"; filename?: string };
export const MAX_PDFS = 3;

function isPdf(a: MessageAttachment): boolean {
  return a.type === "document" && a.mimeType === "application/pdf";
}

// Mensajes para el cerebro:
// - entrante → user; saliente (humano o agente) → assistant;
// - `cleanText`: el texto limpio de los entrantes que traían metadata del anuncio
//   de Click-to-WhatsApp (lo deja el filtro); sustituye al cuerpo original;
// - las imágenes del CLIENTE van como parte "image" (URL firmada) y sus PDF como
//   parte "file" si ya están en el bucket y caben en el cupo (los más recientes);
//   si no, nota de texto;
// - mensajes seguidos del mismo rol se fusionan (Anthropic exige alternar);
// - se descartan los assistant iniciales (el hilo debe abrir con el cliente).
export function buildModelMessages(
  rows: readonly ThreadMessage[],
  imageUrls: ReadonlyMap<string, string>,
  opts: { maxImages?: number; maxPdfs?: number; cleanText?: ReadonlyMap<string, string>; crmContext?: string } = {},
): ModelMessage[] {
  const maxImages = opts.maxImages ?? MAX_IMAGES;
  const maxPdfs = opts.maxPdfs ?? MAX_PDFS;
  // Qué adjuntos entran como archivo (los más recientes con URL): imágenes y PDF
  // (un comprobante SPEI suele llegar en PDF).
  const allowed = new Set<string>();
  const allowedPdf = new Set<string>();
  for (let i = rows.length - 1; i >= 0 && (allowed.size < maxImages || allowedPdf.size < maxPdfs); i--) {
    const m = rows[i];
    if (m.direction !== "in") continue;
    for (let j = m.attachments.length - 1; j >= 0; j--) {
      const a = m.attachments[j];
      if (!a.storageKey || !imageUrls.has(a.storageKey)) continue;
      if (a.type === "image" && allowed.size < maxImages) allowed.add(a.storageKey);
      else if (isPdf(a) && allowedPdf.size < maxPdfs) allowedPdf.add(a.storageKey);
    }
  }

  const turns: { role: "user" | "assistant"; parts: Part[] }[] = [];
  for (const m of rows) {
    const role = m.direction === "in" ? "user" : "assistant";
    const parts: Part[] = [];
    if (role === "user") {
      const text: string[] = [];
      const body = opts.cleanText?.get(m.id) ?? m.body;
      if (body?.trim()) text.push(neutralizeCrmHeader(clip(body.trim())));
      for (const a of m.attachments) {
        if (a.type === "image" && a.storageKey && allowed.has(a.storageKey)) {
          parts.push({ type: "image", image: new URL(imageUrls.get(a.storageKey)!) });
        } else if (a.storageKey && allowedPdf.has(a.storageKey)) {
          parts.push({ type: "file", data: new URL(imageUrls.get(a.storageKey)!), mediaType: "application/pdf", filename: a.fileName });
        } else {
          text.push(attachmentNote(a));
        }
      }
      if (text.length === 0 && parts.length === 0) text.push(`[mensaje ${m.type}]`);
      if (text.length) parts.unshift({ type: "text", text: text.join(" ") });
    } else {
      parts.push({ type: "text", text: messageText(m) });
    }
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else turns.push({ role, parts });
  }
  while (turns.length && turns[0].role === "assistant") turns.shift();
  // La conversación SIEMPRE termina en el turno del cliente (Fase E, 25-sep-2026). Lo
  // que salió DESPUÉS de su último mensaje —la media por palabra clave (p. ej. el video
  // de "cómo se instalan") o de una corrida— no puede ir como turno nuestro al final:
  // Sonnet 5 y los demás modelos actuales de Anthropic lo rechazan ("assistant message
  // prefill", error 400; pasó en B5) y el cliente se quedaba sin respuesta. Va como
  // nota dentro de su último turno: el modelo sabe qué ya recibió y no lo repite.
  const lastUser = turns.findLastIndex((t) => t.role === "user");
  if (lastUser >= 0 && lastUser < turns.length - 1) {
    const after = turns
      .splice(lastUser + 1)
      .flatMap((t) => t.parts)
      .map((p) => (p.type === "text" ? p.text.trim() : ""))
      .filter(Boolean);
    turns[lastUser].parts.push({
      type: "text",
      text: `${SENT_AFTER_HEADER} ${after.map((t) => `«${clip(t, 500)}»`).join(" · ") || "(un archivo)"}]`,
    });
  }
  // Contexto del CRM al FINAL del último turno del cliente (no en el system: la
  // caché del prompt se mantiene; el runtime dice al modelo que no lo mencione).
  if (opts.crmContext?.trim() && lastUser >= 0) {
    turns[turns.length - 1].parts.push({ type: "text", text: opts.crmContext.trim() });
  }

  return turns.map((t): ModelMessage => {
    if (t.role === "assistant") {
      return { role: "assistant", content: t.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") };
    }
    return { role: "user", content: t.parts };
  });
}
