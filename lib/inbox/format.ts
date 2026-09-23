// Reglas puras de presentación de la bandeja (sin base de datos), para
// testearlas solas. La UI recibe ya el dato listo; no decide nada de esto.
import type { MessageAttachment } from "@/lib/db/schema";
import { MEDIA_MAX_ATTEMPTS, MEDIA_SWEEP_DAYS } from "@/lib/messaging/media-keys";
import { isAmbiguousSendError } from "@/lib/messaging/rules";
import type { AdReferral, AttachmentView, MessageKind, MessageView } from "./types";

function firstLetter(value: string | null | undefined): string {
  return value?.match(/\p{L}/u)?.[0] ?? "";
}

/** Igual que contact-avatar: primera LETRA de nombre y apellido (ignora emojis). */
export function avatarInitials(firstName: string, lastName: string | null): string | null {
  return (firstLetter(firstName) + firstLetter(lastName)).toUpperCase() || null;
}

export function fullName(firstName: string, lastName: string | null): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  image: "📎 Foto",
  sticker: "📎 Sticker",
  document: "📄 Documento",
  audio: "🎤 Audio",
  video: "🎬 Video",
  location: "📍 Ubicación",
  contact: "👤 Contacto",
  template: "📋 Plantilla",
};

/** Vista previa de una línea (sin "Tú:", lo agrega la UI según la dirección). */
export function messagePreview(kind: MessageKind, body: string | null): string {
  const text = body?.replace(/\s+/g, " ").trim();
  if (kind === "system_note") return `📝 ${text ?? "Aviso interno"}`.slice(0, 120);
  if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  return KIND_LABEL[kind] ?? "Mensaje";
}

function pick(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Del `referral` crudo de Meta/Zernio (snake_case o camelCase) solo sale lo
 * que la tarjeta muestra. Nunca ctwa_clid ni ids internos. Sin titular ni
 * miniatura no hay tarjeta que mostrar → null.
 */
export function sanitizeReferral(raw: Record<string, unknown> | null | undefined): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const referral: AdReferral = {
    headline: pick(raw, "headline", "title"),
    body: pick(raw, "body"),
    thumbnailUrl: httpsUrl(pick(raw, "thumbnail_url", "thumbnailUrl", "image_url", "imageUrl")),
    sourceUrl: httpsUrl(pick(raw, "source_url", "sourceUrl")),
    mediaType: pick(raw, "media_type", "mediaType"),
  };
  return referral.headline || referral.body || referral.thumbnailUrl || referral.sourceUrl ? referral : null;
}

export function attachmentView(
  messageId: string,
  index: number,
  attachment: MessageAttachment,
  messageCreatedAt: Date,
  now = new Date(),
): AttachmentView {
  const expired = now.getTime() - messageCreatedAt.getTime() > MEDIA_SWEEP_DAYS * 86_400_000;
  const state = attachment.storageKey
    ? "ready"
    : (attachment.downloadAttempts ?? 0) >= MEDIA_MAX_ATTEMPTS || expired
      ? "failed"
      : "processing";
  return {
    index,
    kind: attachment.type as MessageKind,
    fileName: attachment.fileName ?? null,
    mimeType: attachment.mimeType ?? null,
    state,
    url: `/api/media/${encodeURIComponent(messageId)}/${index}`,
    downloadUrl: `/api/media/${encodeURIComponent(messageId)}/${index}?download=1`,
    thumbnailUrl: attachment.thumbnailKey ? `/api/media/${encodeURIComponent(messageId)}/${index}?thumb=1` : null,
    sizeBytes: attachment.sizeBytes ?? null,
    pageCount: attachment.pageCount ?? null,
  };
}

/**
 * Misma regla que retryTextMessage: el botón solo aparece si reintentar es
 * seguro. Solo un rechazo DEFINITIVO del proveedor (4xx: el mensaje no salió).
 * Un fallo ambiguo (timeout/5xx/sin confirmar) no se reintenta: podría duplicar.
 */
export function canRetry(message: {
  direction: "in" | "out";
  source: string;
  type: string;
  status: string;
  providerMessageId: string | null;
  errorCode: string | null;
}): boolean {
  if (message.direction !== "out" || message.source !== "crm" || message.type !== "text") return false;
  if (message.status !== "failed" || message.providerMessageId) return false;
  return !isAmbiguousSendError(message.errorCode);
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Ubicación de `messages.metadata.location` (Zernio), saneada para la UI. */
export function locationFromMetadata(metadata: Record<string, unknown> | null): MessageView["location"] {
  const loc = metadata?.location;
  if (!loc || typeof loc !== "object") return null;
  const l = loc as Record<string, unknown>;
  const latitude = num(l.latitude);
  const longitude = num(l.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude, name: str(l.name), address: str(l.address) };
}

/** Nombres de las tarjetas de `messages.metadata.contacts` (formas de API y de Meta). */
export function contactCardsFromMetadata(metadata: Record<string, unknown> | null): string[] {
  const cards = metadata?.contacts;
  if (!Array.isArray(cards)) return [];
  return cards
    .map((card) => {
      if (!card || typeof card !== "object") return null;
      const name = (card as Record<string, unknown>).name;
      if (typeof name === "string") return str(name);
      if (name && typeof name === "object") {
        const n = name as Record<string, unknown>;
        return str(n.formatted_name) ?? str([n.first_name, n.last_name].filter(Boolean).join(" "));
      }
      return null;
    })
    .filter((name): name is string => name !== null);
}

/** wamid del mensaje citado, si es una respuesta. */
export function quotedIdFromMetadata(metadata: Record<string, unknown> | null): string | null {
  return str(metadata?.quotedMessageId);
}
