// `chat.txt` de la exportación de un contacto (ARCO, 7-oct-2026). PURO: el chat legible, como el
// export de WhatsApp: "[2026-10-03 10:12] Cliente: Hola", en hora de Mazatlán, con quién habló
// (Cliente, Vendedor o Agente IA), la transcripción de sus notas de voz y el nombre de cada archivo
// (los que mandó el cliente, con su ruta dentro del zip). Las notas internas del Agente IA para el
// vendedor (system_note) no van: nunca fueron parte de la conversación con el cliente.
import { kindLabel, mazatlanMinute, speakerOf } from "./format";

export type ChatTxtMessage = {
  id: string;
  at: Date;
  direction: string;
  source: string;
  type: string;
  body: string | null;
  transcripcion: string | null;
  deleted: boolean;
  attachments: readonly { type: string; fileName?: string }[];
};

export type ChatTxtConversation = { channelLabel: string; messages: readonly ChatTxtMessage[] };

export type ChatTxtInput = {
  contactName: string;
  /** Teléfono o @usuario de Instagram (null si no hay). */
  handle: string | null;
  exportedAt: Date;
  conversations: readonly ChatTxtConversation[];
  /** `${messageId}:${índice}` → ruta del archivo dentro del zip (solo los del cliente incluidos). */
  filePaths: ReadonlyMap<string, string>;
};

const TAGS: Record<string, string> = {
  template: "[plantilla]",
  location: "[ubicación]",
  contact: "[tarjeta de contacto]",
};

/** Lo que dice UNA línea del chat (sin la hora ni quién habló). */
export function messageText(m: ChatTxtMessage, filePaths: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  if (TAGS[m.type]) parts.push(TAGS[m.type]);
  m.attachments.forEach((a, index) => {
    const ref = filePaths.get(`${m.id}:${index}`) ?? a.fileName;
    parts.push(ref ? `[${kindLabel(a.type)}: ${ref}]` : `[${kindLabel(a.type)}]`);
  });
  const body = m.body?.trim();
  if (body) parts.push(body);
  const transcripcion = m.transcripcion?.trim();
  if (transcripcion) parts.push(`(transcripción: «${transcripcion}»)`);
  if (parts.length === 0) parts.push(m.type === "unknown" ? "[mensaje no compatible]" : "[mensaje vacío]");
  if (m.deleted) parts.push("(lo borró quien lo envió)");
  return parts.join(" ");
}

export function buildChatTxt(input: ChatTxtInput): string {
  const lines: string[] = [
    `Chat de ${input.contactName}${input.handle ? ` (${input.handle})` : ""}`,
    `Exportado el ${mazatlanMinute(input.exportedAt)} (hora de Mazatlán)`,
  ];
  if (input.conversations.length === 0) lines.push("", "Sin chats.");
  for (const conversation of input.conversations) {
    lines.push("", `── ${conversation.channelLabel} ──`);
    const visible = conversation.messages.filter((m) => m.type !== "system_note");
    if (visible.length === 0) lines.push("Sin mensajes.");
    for (const m of visible) {
      lines.push(`[${mazatlanMinute(m.at)}] ${speakerOf(m)}: ${messageText(m, input.filePaths)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
