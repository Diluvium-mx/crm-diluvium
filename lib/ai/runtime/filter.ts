// FILTRO del Agente IA (GPT-5.6 Luna). Desde el 23-sep-2026 NO decide si se
// contesta: el agente contesta todo. Solo limpia la información del anuncio de
// Click-to-WhatsApp (la metadata de Facebook que el Goal pide ignorar) y deja un
// resumen corto del anuncio; el cerebro recibe la conversación limpia. El prompt,
// la detección y el parseo son puros (testeables); la llamada la hace ad-cleaner.ts.

// Etiquetas de la metadata de Facebook que pueden venir pegadas al texto del
// cliente (así llegaban a GHL: "body: …", "ctwaClid: …", "sourceType: ad", …).
const METADATA_LABEL = /^\s*(?:body|ctwa_?clid|source_?type|source_?id|source_?url|greeting_?message_?body|headline|media_?type|image_?url|video_?url|thumbnail_?url|conversion_?source|entry_?point|welcome_?message)\s*:/iu;

export type AdMessage = { direction: "in" | "out"; body: string | null; adReferral: Record<string, unknown> | null };

// ¿Este mensaje trae información de un anuncio que hay que limpiar?
export function needsAdCleaning(m: AdMessage): boolean {
  if (m.direction !== "in") return false;
  if (m.adReferral && Object.keys(m.adReferral).length > 0) return true;
  return (m.body ?? "").split("\n").some((line) => METADATA_LABEL.test(line));
}

// Respaldo sin modelo (si Luna falla): quita las líneas de metadata.
export function stripAdMetadata(body: string | null): string {
  return (body ?? "")
    .split("\n")
    .filter((line) => !METADATA_LABEL.test(line))
    .join("\n")
    .trim();
}

export const FILTER_SYSTEM = `Eres el FILTRO de la bandeja de WhatsApp de Diluvium (compuertas y tapones contra inundaciones). NO respondes al cliente. El cliente llegó desde un anuncio de Click-to-WhatsApp: recibes los datos del anuncio y el mensaje tal como llegó, que puede traer metadata de Facebook con etiquetas (body:, ctwaClid:, sourceType:, greetingMessageBody:, entre otras). El campo body: de la metadata es el texto del anuncio, no del cliente.

Responde SOLO con un objeto JSON en una línea, sin texto extra:
{"mensaje":"<solo lo que escribió el cliente, sin la metadata del anuncio; si solo saludó o solo trae el texto automático del anuncio, ese saludo o texto>","anuncio":"<resumen corto del anuncio: de qué anuncio o campaña llegó y qué decía; máx. 25 palabras; vacío si no hay datos>"}

No inventes nada que no esté en los datos.`;

// Solo los campos legibles del anuncio (sin ids de rastreo ni URLs de medios).
export function adFields(referral: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!referral) return out;
  const keys: [string, string[]][] = [
    ["titulo", ["headline", "title"]],
    ["texto", ["body"]],
    ["tipo", ["source_type", "sourceType"]],
    ["enlace", ["source_url", "sourceUrl"]],
    ["campana", ["campaign_name", "campaignName", "ad_name", "adName"]],
  ];
  for (const [name, candidates] of keys) {
    for (const k of candidates) {
      const v = referral[k];
      if (typeof v === "string" && v.trim()) {
        out[name] = v.trim().slice(0, 1_000);
        break;
      }
    }
  }
  return out;
}

// Ids de rastreo pegados al texto: no sirven para resumir y no salen del CRM.
const TRACKING_LINE = /^\s*(?:ctwa_?clid|source_?id)\s*:/iu;

// El texto del cliente va entre comillas JSON: no puede fabricar instrucciones sueltas.
export function buildAdCleanerPrompt(m: AdMessage): string {
  const body = (m.body ?? "")
    .split("\n")
    .filter((line) => !TRACKING_LINE.test(line))
    .join("\n")
    .slice(0, 4_000);
  return `Datos del anuncio: ${JSON.stringify(adFields(m.adReferral))}\nMensaje como llegó: ${JSON.stringify(body)}`;
}

export type CleanedAd = { mensaje: string; anuncio: string | null; parsed: boolean };

// Tolerante: acepta el JSON aunque venga envuelto en ```. Si no se entiende, cae
// al respaldo sin modelo (nunca deja al cliente sin respuesta).
export function parseAdCleaner(raw: string, m: AdMessage): CleanedAd {
  const fallback = (): CleanedAd => {
    const f = adFields(m.adReferral);
    const anuncio = [f.titulo, f.texto].filter(Boolean).join(" — ").slice(0, 200) || null;
    return { mensaje: stripAdMetadata(m.body) || (m.body ?? "").trim(), anuncio, parsed: false };
  };
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return fallback();
  try {
    const obj = JSON.parse(json[0]) as { mensaje?: unknown; anuncio?: unknown };
    const mensaje = typeof obj.mensaje === "string" ? obj.mensaje.trim().slice(0, 4_000) : "";
    const anuncio = typeof obj.anuncio === "string" && obj.anuncio.trim() ? obj.anuncio.trim().slice(0, 300) : null;
    if (!mensaje) return { ...fallback(), anuncio: anuncio ?? fallback().anuncio };
    return { mensaje, anuncio, parsed: true };
  } catch {
    return fallback();
  }
}
