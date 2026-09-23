// GUARDIA DE SALIDA del Agente IA (Fase B). PURO: sin DB ni red. Antes de
// enviar en modo AUTO, la respuesta del cerebro se revisa contra la base de
// conocimiento ACTIVA de la organización:
//   - un monto o precio que no aparezca en el Goal ni en las FAQs activas, o
//   - un enlace fuera de la lista permitida (diluvium.com.mx y los enlaces de
//     Amazon / Mercado Libre que ya están en las FAQs activas)
// → NO se envía: queda como borrador para revisión humana, con el motivo.
// Es un freno contra respuestas inventadas o inducidas por el cliente (prompt
// injection): ante la duda, a revisión humana (nunca bloquea en silencio).
import type { Faq } from "./knowledge";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// ── Montos ───────────────────────────────────────────────────────────────────
// Número con miles (5,500 / 5.500 / 5,500.50) o simple (5500 / 5.5).
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
// "$5,500", "$ 5500.00", "$5 mil"
const MONEY_SIGN = new RegExp(String.raw`\$\s?(${NUM})(\s*mil\b)?`, "giu");
// "5,500 pesos", "5500 MXN", "5 mil pesos", "3,000 m.n.", "20 dólares"
const MONEY_WORD = new RegExp(
  String.raw`(?<!\$\s?)(?<![\d.,])(${NUM})(\s*mil)?\s*(?:mxn|m\.\s?n\.?|pesos?|d[oó]lares|usd|dlls?)(?![\p{L}\d])`,
  "giu",
);
// Precio sin signo ni moneda: "cuesta 5,500", "el total es de 11 mil", "anticipo 1500".
// Una medida o cantidad ("mide 80 cm", "2 piezas") no es precio.
const MONEY_CONTEXT = new RegExp(
  String.raw`(?<!\p{L})(?:cuestan?|precio|valen?|total|salen?\s+en|quedan?\s+en|pagar[ií]?a?s?|pago|anticipo|descuento)(?:\s+(?:es|son|de|en|a|por|del?))*\s*:?\s*(?<![\d.,$])(${NUM})(?!\d|[.,]\d)(\s*mil\b)?(?!\s*(?:cm|mm|m\b|metros?|cent[ií]metros?|%|piezas?|unidades?|compuertas?))`,
  "giu",
);

// Convierte "5,500" / "5.500" / "5,500.50" / "5.5" a número (MX: punto decimal;
// un separador seguido de exactamente 3 dígitos es de miles).
export function parseAmount(raw: string, thousands = false): number {
  let n: number;
  const grouped = raw.match(/^(\d{1,3}(?:([.,])\d{3})+)(?:[.,](\d{1,2}))?$/);
  if (grouped) {
    const int = grouped[1].split(grouped[2]).join("");
    n = Number(grouped[3] ? `${int}.${grouped[3]}` : int);
  } else {
    n = Number(raw.replace(",", "."));
  }
  return thousands ? n * 1000 : n;
}

type AmountHit = { text: string; value: number };

export function extractAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  // Una misma cifra (misma posición del número) cuenta una sola vez aunque la
  // detecten dos patrones ("$ 5,500 MXN", "cuesta 5,500 pesos").
  const seen = new Set<number>();
  for (const re of [MONEY_SIGN, MONEY_WORD, MONEY_CONTEXT]) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].indexOf(m[1]);
      if (seen.has(at)) continue;
      seen.add(at);
      const shown = re === MONEY_CONTEXT ? `${m[1]}${m[2] ?? ""}` : m[0].trim();
      hits.push({ text: shown, value: parseAmount(m[1], Boolean(m[2])) });
    }
  }
  return hits;
}

const cents = (v: number) => Math.round(v * 100);

// ── Enlaces ──────────────────────────────────────────────────────────────────
const URL_WITH_SCHEME = /\bhttps?:\/\/[^\s<>"'`]+/giu;
// Dominio sin esquema ("diluvium.com.mx/x", "bit.ly/abc", "ventas@otro.com").
const BARE_DOMAIN =
  /(?<![\p{L}\d-])(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|mx|net|org|info|biz|to|ly|me|co|io|app|link|shop|store|site|online|xyz|gl|page|la|us|es)(?:\.[a-z]{2})?(?![\p{L}\d-])(?:\/[^\s<>"'`]*)?/giu;
const TRAILING_PUNCT = /[.,;:!?¡¿)\]}"'»”’]+$/u;

export function extractLinks(text: string): string[] {
  const links: string[] = [];
  const rest = text.replace(URL_WITH_SCHEME, (m) => {
    links.push(m.replace(TRAILING_PUNCT, ""));
    return " ";
  });
  for (const m of rest.matchAll(BARE_DOMAIN)) links.push(m[0].replace(TRAILING_PUNCT, ""));
  return links;
}

// host (sin www, minúsculas) + ruta (sin "/" final); sin query ni #: el mismo
// producto con otros parámetros sigue siendo el mismo enlace.
export function linkKey(link: string): { host: string; key: string } | null {
  try {
    const u = new URL(/^https?:\/\//i.test(link) ? link : `https://${link.replace(/^.*@/, "")}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return { host, key: `${host}${path}` };
  } catch {
    return null;
  }
}

const OWN_DOMAIN = /(^|\.)diluvium\.com\.mx$/;
const MARKETPLACE = /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co|mercadolibre\.[a-z.]+|mercadolivre\.[a-z.]+|meli\.la)$/;

// ── Revisión ─────────────────────────────────────────────────────────────────
export function reviewReply(text: string, knowledge: { goal: string; faqs: readonly Faq[] }): GuardResult {
  const active = knowledge.faqs.filter((f) => f.enabled !== false);
  const faqText = active.map((f) => `${f.question}\n${f.answer}`).join("\n");
  const known = new Set(extractAmounts(`${knowledge.goal}\n${faqText}`).map((a) => cents(a.value)));
  const allowedMarketplace = new Set(
    extractLinks(faqText)
      .map(linkKey)
      .filter((k): k is { host: string; key: string } => k !== null && MARKETPLACE.test(k.host))
      .map((k) => k.key),
  );

  const problems: string[] = [];
  const badAmounts = [...new Set(extractAmounts(text).filter((a) => !known.has(cents(a.value))).map((a) => a.text))];
  if (badAmounts.length) problems.push(`monto que no está en el Goal ni en las FAQs: ${badAmounts.join(", ")}`);

  const badLinks = [
    ...new Set(
      extractLinks(text).filter((l) => {
        const k = linkKey(l);
        if (!k) return true;
        if (OWN_DOMAIN.test(k.host)) return false;
        return !(MARKETPLACE.test(k.host) && allowedMarketplace.has(k.key));
      }),
    ),
  ];
  if (badLinks.length) problems.push(`enlace fuera de la lista permitida: ${badLinks.join(", ")}`);

  if (problems.length === 0) return { ok: true };
  const reason = problems.join(" · ");
  return { ok: false, reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}
