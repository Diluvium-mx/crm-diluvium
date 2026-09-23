// Convierte el hilo de WhatsApp en lo que lee el cerebro. PURO (sin DB): mensajes
// del AI SDK con las imágenes del cliente (multimodal) como URLs firmadas del bucket.
//
// El cerebro lee TODA la conversación (23-sep-2026). Solo hay protecciones técnicas
// para no exceder lo que el modelo puede leer: si un chat es enorme, se queda con lo
// más reciente (fitHistory), un mensaje pegado gigante se recorta y las imágenes
// que van como imagen son las más recientes (las demás, como nota de texto).
import type { ModelMessage } from "ai";
import type { MessageAttachment } from "@/lib/db/schema";

// Protección técnica por mensaje (un texto pegado enorme).
export const MAX_MESSAGE_CHARS = 4_000;
// Protección técnica de todo el historial (~85 mil tokens): con el Goal, las FAQs y
// las imágenes cabe en cualquier modelo del catálogo.
export const MAX_HISTORY_CHARS = 300_000;
export const MAX_IMAGES = 20;

export function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… [recortado]` : text;
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

type Part = { type: "text"; text: string } | { type: "image"; image: URL };

// Mensajes para el cerebro:
// - entrante → user; saliente (humano o agente) → assistant;
// - `cleanText`: el texto limpio de los entrantes que traían metadata del anuncio
//   de Click-to-WhatsApp (lo deja el filtro); sustituye al cuerpo original;
// - las imágenes del CLIENTE van como parte "image" (URL firmada) si ya están en
//   el bucket y caben en el cupo `maxImages` (las más recientes); si no, nota de texto;
// - mensajes seguidos del mismo rol se fusionan (Anthropic exige alternar);
// - se descartan los assistant iniciales (el hilo debe abrir con el cliente).
export function buildModelMessages(
  rows: readonly ThreadMessage[],
  imageUrls: ReadonlyMap<string, string>,
  opts: { maxImages?: number; cleanText?: ReadonlyMap<string, string> } = {},
): ModelMessage[] {
  const maxImages = opts.maxImages ?? MAX_IMAGES;
  // Qué adjuntos de imagen entran (los más recientes con URL).
  const allowed = new Set<string>();
  for (let i = rows.length - 1; i >= 0 && allowed.size < maxImages; i--) {
    const m = rows[i];
    if (m.direction !== "in") continue;
    for (let j = m.attachments.length - 1; j >= 0 && allowed.size < maxImages; j--) {
      const a = m.attachments[j];
      if (a.type === "image" && a.storageKey && imageUrls.has(a.storageKey)) allowed.add(a.storageKey);
    }
  }

  const turns: { role: "user" | "assistant"; parts: Part[] }[] = [];
  for (const m of rows) {
    const role = m.direction === "in" ? "user" : "assistant";
    const parts: Part[] = [];
    if (role === "user") {
      const text: string[] = [];
      const body = opts.cleanText?.get(m.id) ?? m.body;
      if (body?.trim()) text.push(clip(body.trim()));
      for (const a of m.attachments) {
        if (a.type === "image" && a.storageKey && allowed.has(a.storageKey)) {
          parts.push({ type: "image", image: new URL(imageUrls.get(a.storageKey)!) });
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

  return turns.map((t): ModelMessage => {
    if (t.role === "assistant") {
      return { role: "assistant", content: t.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") };
    }
    return { role: "user", content: t.parts };
  });
}
