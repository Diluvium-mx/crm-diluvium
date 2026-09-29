// Detecta los links dentro de un texto libre (mensajes del chat, comentarios,
// mensajes rápidos…) para pintarlos como hipervínculo. Lógica pura: la UI solo
// recorre los pedazos (components/ui/linked-text.tsx).
//
// Reconoce, como WhatsApp:
// - http:// y https:// (cualquier dominio);
// - www.… (se abre con https://);
// - dominios sueltos con una terminación conocida (diluvium.com.mx, bit.ly…) y
//   links cortos con ruta (amzn.to/3xYz, a.co/d/…, wa.me/52…).
// Un correo (ventas@diluvium.mx) NO es link. El punto, la coma, el paréntesis
// sin pareja y las comillas al final se quedan fuera del link.

export type TextPart = { text: string; href?: undefined } | { text: string; href: string };

// Caracteres que puede llevar un link: ASCII visible salvo < > " { } | \ ^ ` y
// letras latinas acentuadas. Así un emoji pegado al link no entra en él.
const URL_CHAR = String.raw`[!#-;=?-\[\]_a-z~À-ɏ]`;
// Terminaciones que se aceptan sin ruta. Sin "de", "es", "me" ni "co": salen en
// español al olvidar el espacio tras el punto ("S.A.de C.V.", "Hola.me interesa").
const KNOWN_TLDS = "com|net|org|mx|io|app|info|shop|store|online|site|link|ly|gl|tv";
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`;

const LINK_RE = new RegExp(
  [
    // 1) con esquema o www.
    String.raw`\b(?:https?:\/\/|www\.)${URL_CHAR}+`,
    // 2) dominio suelto con terminación conocida (ruta opcional)
    String.raw`\b(?:${LABEL}\.)+(?:${KNOWN_TLDS})\b(?:[/?#]${URL_CHAR}*)?`,
    // 3) link corto: cualquier terminación de 2 a 6 letras SEGUIDA de una ruta
    String.raw`\b(?:${LABEL}\.)+[a-z]{2,6}\/${URL_CHAR}+`,
  ].join("|"),
  "gi",
);

const TRAILING_PUNCT = /[.,;:!?'"*~]$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[" };

// Quita del final lo que es puntuación de la frase y no del link. Un ")" solo
// se queda si abre un "(" dentro del mismo link (p. ej. Wikipedia).
function trimTrailing(candidate: string): string {
  let s = candidate;
  for (;;) {
    const last = s[s.length - 1];
    if (!last) return s;
    if (TRAILING_PUNCT.test(last)) {
      s = s.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener && s.split(opener).length - 1 < s.split(last).length - 1) {
      s = s.slice(0, -1);
      continue;
    }
    return s;
  }
}

function toHref(link: string): string | null {
  const withScheme = /^https?:\/\//i.test(link) ? link : `https://${link}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // "www." suelto o un host sin punto no es un link (una IP sí).
    const host = url.hostname;
    if (!/[a-z0-9]\.[a-z]{2,}$/i.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    // Dominio de un correo (algo@dominio.com): se deja como texto.
    if (text[start - 1] === "@") continue;
    const link = trimTrailing(match[0]);
    const href = toHref(link);
    if (!href) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: link, href });
    cursor = start + link.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
