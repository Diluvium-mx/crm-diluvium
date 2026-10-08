// Formatos de la exportación de un contacto (ARCO, 7-oct-2026). PURO: hora de Mazatlán, quién
// habló, cómo se llama cada tipo de mensaje y nombres seguros para el zip.

export const EXPORT_TIME_ZONE = "America/Mazatlan";

// "sv-SE" da justo "2026-10-03 10:12:45" (formato ISO con espacio), en la zona pedida.
const FULL = new Intl.DateTimeFormat("sv-SE", {
  timeZone: EXPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Instante → "2026-10-03 10:12:45" en hora de Mazatlán. */
export function mazatlanDateTime(at: Date): string {
  return FULL.format(at).replace("T", " ");
}

/** Instante → "2026-10-03 10:12" (chat.txt). */
export function mazatlanMinute(at: Date): string {
  return mazatlanDateTime(at).slice(0, 16);
}

/** Instante → "2026-10-03" (nombre del zip). */
export function mazatlanDay(at: Date): string {
  return mazatlanDateTime(at).slice(0, 10);
}

export type Speaker = "Cliente" | "Vendedor" | "Agente IA";

/** Quién habló: el cliente (entrante), el Agente IA o un vendedor (CRM, celular u otra app). */
export function speakerOf(m: { direction: string; source: string }): Speaker {
  if (m.direction === "in") return "Cliente";
  return m.source === "ai_agent" ? "Agente IA" : "Vendedor";
}

const KIND_LABEL: Record<string, string> = {
  text: "texto",
  image: "foto",
  audio: "audio",
  video: "video",
  document: "documento",
  sticker: "sticker",
  location: "ubicación",
  contact: "tarjeta de contacto",
  template: "plantilla",
  interactive: "botones",
  unknown: "mensaje no compatible",
};

/** Tipo de mensaje o de adjunto en palabras ("foto", "audio"…). */
export function kindLabel(type: string): string {
  return KIND_LABEL[type] ?? type;
}

/** Texto apto para nombre de archivo: sin acentos, sin espacios raros, sin rutas. */
export function safeName(text: string, fallback: string, max = 80): string {
  const clean = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, max);
  return clean || fallback;
}

/** "contacto-juan-perez-2026-10-07.zip": nombre en minúsculas, sin acentos ni símbolos. */
export function exportZipName(fullName: string, now: Date): string {
  const slug = fullName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `contacto-${slug || "sin-nombre"}-${mazatlanDay(now)}.zip`;
}
