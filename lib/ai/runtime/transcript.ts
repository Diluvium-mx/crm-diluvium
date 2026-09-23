// Convierte el hilo de WhatsApp en lo que leen los modelos. PURO (sin DB): el
// filtro recibe una transcripción de texto; el cerebro recibe mensajes del AI
// SDK con las imágenes del cliente (multimodal) como URLs firmadas del bucket.
import type { ModelMessage } from "ai";
import type { MessageAttachment } from "@/lib/db/schema";
import type { TranscriptLine } from "./filter";

// Tope de caracteres por mensaje que leen los modelos: un cliente no puede
// inflar el costo por llamada pegando textos enormes.
export const MAX_MESSAGE_CHARS = 2_000;

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

export function toTranscriptLines(rows: readonly ThreadMessage[], pendingIds: ReadonlySet<string>): TranscriptLine[] {
  return rows.map((m) => ({
    role: m.direction === "in" ? "cliente" : "diluvium",
    text: messageText(m),
    pending: pendingIds.has(m.id),
  }));
}

type Part = { type: "text"; text: string } | { type: "image"; image: URL };

// Mensajes para el cerebro:
// - entrante → user; saliente (humano o agente) → assistant;
// - las imágenes del CLIENTE van como parte "image" (URL firmada) si ya están en
//   el bucket y caben en el cupo `maxImages` (las más recientes); si no, nota de texto;
// - mensajes seguidos del mismo rol se fusionan (Anthropic exige alternar);
// - se descartan los assistant iniciales (el hilo debe abrir con el cliente).
export function buildModelMessages(
  rows: readonly ThreadMessage[],
  imageUrls: ReadonlyMap<string, string>,
  maxImages = 4,
): ModelMessage[] {
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
      if (m.body?.trim()) text.push(clip(m.body.trim()));
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
