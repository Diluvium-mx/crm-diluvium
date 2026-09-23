// GUARDIA DE SALIDA del Agente IA (Fase B). PURO: sin DB ni red. Antes de
// enviar en modo AUTO, la respuesta del cerebro se revisa contra la base de
// conocimiento ACTIVA de la organización:
//   - un monto o precio que no aparezca tal cual en el Goal ni en las FAQs activas,
//     salvo un TOTAL con su desglose correcto en la misma respuesta
//     ("3 × $5,500 = $16,500", "$5,500 + $7,000 = $12,500"), o
//   - un enlace fuera de la lista permitida (diluvium.com.mx y los enlaces de
//     Amazon / Mercado Libre que ya están en las FAQs activas)
// → NO se envía: queda como borrador para revisión humana, con el motivo.
// Es un freno contra respuestas inventadas o inducidas por el cliente (prompt
// injection): ante la duda, a revisión humana (nunca bloquea en silencio).
import type { Faq } from "./knowledge";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// ── Enlaces ──────────────────────────────────────────────────────────────────
// Con esquema (cualquier mayúscula; incluye markdown "[x](https://…)").
const URL_WITH_SCHEME = /\b(?:https?|ftp):\/\/[^\s<>"'`]+/giu;
// Dominio sin esquema, con CUALQUIER TLD (WhatsApp los vuelve enlace): etiquetas
// Unicode (un homógrafo como "diluvіum" con i cirílica también se detecta). No
// empieza a media palabra ni tras "@" (eso es un correo, no un enlace).
const BARE_DOMAIN =
  /(?<![\p{L}\p{N}@._%+\-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-]{0,61}[\p{L}\p{N}])?\.){1,8}(?!(?:jpe?g|png|gif|webp|heic|pdf|xml|docx?|xlsx?|mp4|mov|txt)(?![\p{L}\p{N}]))\p{L}{2,24}(?![\p{L}\p{N}@\-])(?:[/?#][^\s<>"'`]*)?/giu;
const IPV4 = /(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{N}.])(?:[/:][^\s<>"'`]*)?/gu;
// Correos: no son enlaces; se quitan antes de buscar montos (sus dígitos no cuentan).
// La parte local lleva al menos una letra: "$6.500@x.co" no es un correo (y su monto cuenta).
const EMAIL =
  /(?<![\p{L}\p{N}._%+\-])(?=[\p{N}._%+\-]{0,63}\p{L})[\p{L}\p{N}._%+\-]{1,64}@(?:[\p{L}\p{N}\-]{1,63}\.){1,8}\p{L}{2,24}/giu;
const DOMAIN_LIKE_LOCAL = /\.(?:com|mx|net|org|info|io|co|app|ai|ru)(?:\.|$)|https?|www\./iu;
const TRAILING_PUNCT = /[.,;:!?¡¿)\]}"'»”’]+$/u;

export function extractLinks(text: string): string[] {
  const links: string[] = [];
  const take = (m: string) => {
    links.push(m.replace(TRAILING_PUNCT, ""));
    return " ";
  };
  // Un correo no es enlace, salvo el engaño "diluvium.com.mx@otro.com" (parte
  // local con forma de dominio): ese se trata como enlace y no pasa.
  const rest = text
    .replace(URL_WITH_SCHEME, take)
    .replace(EMAIL, (m) => (DOMAIN_LIKE_LOCAL.test(m.slice(0, m.indexOf("@"))) ? take(m) : " "))
    .replace(IPV4, take);
  for (const m of rest.matchAll(BARE_DOMAIN)) take(m[0]);
  return links;
}

// Texto sin enlaces ni correos (para buscar montos sin contar sus dígitos). Un
// solo espacio por enlace: "te la dejo en diluvium.com.mx 4200" sigue siendo
// precio en contexto. Montos y desgloses se buscan ambos en ESTE texto, así que
// sus posiciones coinciden entre sí.
function withoutLinks(text: string): string {
  return text.replace(URL_WITH_SCHEME, " ").replace(EMAIL, " ").replace(IPV4, " ").replace(BARE_DOMAIN, " ");
}

// host (sin www, minúsculas, punycode) + ruta (sin "/" final); sin query ni #:
// el mismo producto con otros parámetros sigue siendo el mismo enlace. null =
// no se puede interpretar o trae usuario/contraseña ("diluvium.com.mx@otro.com").
export function linkKey(link: string): { host: string; key: string } | null {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(link) ? link : `https://${link}`);
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return { host, key: `${host}${path}` };
  } catch {
    return null;
  }
}

const OWN_DOMAIN = /(^|\.)diluvium\.com\.mx$/;
const MARKETPLACE = /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co|mercadolibre\.[a-z.]+|mercadolivre\.[a-z.]+|meli\.la)$/;

// ── Montos ───────────────────────────────────────────────────────────────────
// Todos los cuantificadores van ACOTADOS: la respuesta la puede inducir el
// cliente y una regex con retroceso exponencial congelaría el worker.
// Número con miles (5,500 / 5.500 / 1,250,000.50) o simple (5500 / 5.5).
// Solo espacios horizontales entre número y moneda: un salto de línea separa ideas
// ("…$799 MXN\n3 pulgadas…" no es "MXN 3").
const H = String.raw`[ \t\u00a0\u202f]`;
const GROUPED = String.raw`\d{1,3}(?:[.,]\d{3}){1,4}(?:[.,]\d{1,2})?`;
const NUM = String.raw`${GROUPED}|\d{1,9}(?:[.,]\d{1,2})?`;
// Miles con espacio ("$4 200", "4 200 pesos"): solo junto a un signo o moneda.
const MONEY_NUM = String.raw`\d{1,3}(?:[ \u00a0\u202f]\d{3}){1,4}(?:[.,]\d{1,2})?|${NUM}`;
// Con 3+ dígitos: "son 850" es precio; "son 2 partes" / "3 a 5 días" no.
const BIG = String.raw`${GROUPED}|\d{3,9}(?:[.,]\d{1,2})?`;
const START = String.raw`(?<![\p{L}\p{N}.,])`;
const END = String.raw`(?!\p{N}|[.,]\p{N})`;
// Lo que va DESPUÉS de un número que no es dinero (medidas, cantidades, tiempo, %).
const UNIT = String.raw`(?!${H}{0,3}(?:cm|mm|m|mts?|metros?|cent[ií]metros?|mil[ií]metros?|kg|kilos?|litros?|lts?|%|x|piezas?|pzas?|unidades?|compuertas?|tapones?|entradas?|d[ií]as?|semanas?|mes(?:es)?|años?|horas?|hrs?|minutos?|min|h[aá]biles|veces|personas?|pulgadas?|pulg)(?![\p{L}]))`;
const MIL = String.raw`(${H}{0,3}mil\b)?`;

type AmountHit = { text: string; value: number; at: number };
type Pattern = { re: RegExp; shown: (m: RegExpMatchArray) => string };

const rx = (src: string) => new RegExp(src, "giu");
const whole = (m: RegExpMatchArray) => m[0].trim();
const numOnly = (m: RegExpMatchArray) => `${m[1]}${m[2] ?? ""}`.trim();

const PATTERNS: Pattern[] = [
  // "$5,500", "$  4,200", "$5 mil"
  { re: rx(String.raw`\$${H}{0,3}(${MONEY_NUM})${END}${MIL}`), shown: whole },
  // "4200$", "4,200 $"
  { re: rx(String.raw`${START}(${NUM})${END}${MIL}${H}{0,3}\$`), shown: whole },
  // "MXN 4200", "m.n. 3,000"
  { re: rx(String.raw`(?<!\p{L})(?:mxn|m\.\s?n\.|usd)${H}{0,3}(${MONEY_NUM})${END}${MIL}${UNIT}`), shown: whole },
  // "5,500 pesos", "5500 MXN", "5 mil pesos", "20 dólares"
  { re: rx(String.raw`${START}(${MONEY_NUM})${END}${MIL}${H}{0,3}(?:mxn|m\.\s?n\.?|pesos?|d[oó]lares|usd|dlls?)(?![\p{L}\p{N}])`), shown: whole },
  // "4 mil", "11 mil" (sin moneda): en esta conversación "mil" es dinero
  { re: rx(String.raw`${START}(${NUM})${END}(${H}{0,3}mil)\b(?!${H}{0,3}(?:litros?|metros?|piezas?|unidades?))`), shown: whole },
  // Número con separador de miles sin unidad: "Mediana: 4,200", "entre $3,500 y 4,200"
  { re: rx(String.raw`${START}(${GROUPED})${END}()${UNIT}(?!${H}{0,3}mil\b)`), shown: numOnly },
  // Contexto de precio antes: "cuesta 850", "te la dejo en 4200", "serían 9,000"
  {
    re: rx(
      String.raw`(?<!\p{L})(?:cuestan?|precio|valen?|total|salen?${H}{1,3}(?:en|a)|quedan?${H}{1,3}(?:en|a)|dejo${H}{1,3}en|dejamos${H}{1,3}en|ser[ií]an?|son|pagar[ií]?a?s?|pago|anticipo|enganche|descuento|cobro|cobramos|oferta|promoci[oó]n|por${H}{1,3}solo)(?:${H}{1,3}(?:es|son|del?|en|a|por|solo|como|unos?)){0,3}${H}{0,3}:?${H}{0,3}${START}(${BIG})${END}${MIL}${UNIT}`,
    ),
    shown: numOnly,
  },
  // Contexto de precio después: "4200 en total", "850 cada una", "3,000 de anticipo"
  {
    re: rx(
      String.raw`${START}(${BIG})${END}${MIL}${H}{1,3}(?:en${H}{1,3}total|de${H}{1,3}total|cada${H}{1,3}un[oa]|c\/u|por${H}{1,3}pieza|la${H}{1,3}pieza|m[aá]s${H}{1,3}iva|\+${H}{0,2}iva|de${H}{1,3}anticipo|de${H}{1,3}enganche|de${H}{1,3}descuento)(?![\p{L}])`,
    ),
    shown: numOnly,
  },
];

// Convierte "5,500" / "5.500" / "5,500.50" / "5.5" a número (MX: punto decimal;
// un separador seguido de exactamente 3 dígitos es de miles).
export function parseAmount(input: string, thousands = false): number {
  const raw = input.replace(/[ \u00a0\u202f]/g, "");
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

export function extractAmounts(text: string): AmountHit[] {
  const clean = withoutLinks(text);
  const hits: AmountHit[] = [];
  // Una misma cifra (misma posición del número) cuenta una sola vez aunque la
  // detecten dos patrones ("$ 5,500 MXN", "cuesta 5,500 pesos").
  const seen = new Set<number>();
  for (const { re, shown } of PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const at = m.index + m[0].indexOf(m[1]);
      if (seen.has(at)) continue;
      seen.add(at);
      hits.push({ text: shown(m), value: parseAmount(m[1], Boolean(m[2]?.trim())), at });
    }
  }
  return hits;
}

const cents = (v: number) => Math.round(v * 100);

// ── Totales con desglose ─────────────────────────────────────────────────────
// Un monto que NO está tal cual en la base solo pasa como TOTAL con su desglose
// en la misma respuesta: "3 × $5,500 = $16,500", "$5,500 + $7,000 = $12,500".
// Cada precio unitario debe ser un monto de la base activa, cada cantidad de 1 a
// MAX_QTY y la cuenta exacta. Un desglose que no cuadra → revisión humana. Sin
// desglose ("te la dejo en $6,500") → revisión humana.
export const MAX_QTY = 10;
const TIMES = String.raw`[×xX*]`;
const PRICE_NUM = String.raw`(?:${MONEY_NUM})(?!\p{N}|[.,]\p{N})`;
const CURRENCY = String.raw`(?:${H}{0,3}(?:mxn|pesos))?`;
// Etiqueta opcional de un término: "mediana $5,500", "$5,500 (mediana)".
const LABEL = String.raw`(?:\p{L}{1,20}(?:${H}{1,3}\p{L}{1,20}){0,2}|\([^()\n]{1,30}\))`;
// Núcleo de un término: "3 × $5,500", "3 compuertas × $5,500", "$5,500 × 3" o "$5,500".
const CORE = (g: boolean) => {
  const c = (x: string) => (g ? `(${x})` : x);
  return String.raw`(?:${c(String.raw`\d{1,3}`)}(?!\p{N})(?:${H}{1,3}\p{L}{1,20}){0,2}${H}{0,3}${TIMES}${H}{0,3}\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY}|\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY}${H}{0,3}${TIMES}${H}{0,3}${c(String.raw`\d{1,3}`)}(?!\p{N})|\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY})`;
};
const TERM = String.raw`(?:${LABEL}${H}{1,3})?${CORE(false)}(?:${H}{1,3}${LABEL})?`;
// Ni antes ni después del desglose puede haber otra operación: en "3 × $749 × 2 =
// $1,498" o "… = $16,500 − $1,500" solo se leería un pedazo de la cuenta.
const NO_OP_BEFORE = String.raw`(?<![×*+−/xX]${H}{0,3})(?<!\p{N}${H}{0,3}-${H}{0,3})`;
const NO_OP_AFTER = String.raw`(?!${H}{0,3}(?:[×*+−/]|[xX]${H}{0,3}\p{N}|-${H}{0,3}[\p{N}$]))`;
// Términos unidos por "+" (hasta 10), "=" y el total.
const BREAKDOWN = new RegExp(
  String.raw`(?<![\p{L}\p{N}$.,])${NO_OP_BEFORE}(${TERM}(?:${H}{0,3}\+${H}{0,3}${TERM}){0,9})${H}{0,3}=${H}{0,3}\$?${H}{0,3}(${PRICE_NUM})${CURRENCY}${NO_OP_AFTER}`,
  "giu",
);
const TERM_PARTS = new RegExp(String.raw`^(?:${LABEL}${H}{1,3})?${CORE(true)}(?:${H}{1,3}${LABEL})?$`, "iu");

export type Breakdown = { text: string; start: number; end: number; total: number; valid: boolean };

// Desgloses de la respuesta, validados contra los precios de la base (centavos).
export function findBreakdowns(text: string, known: ReadonlySet<number>): Breakdown[] {
  const out: Breakdown[] = [];
  for (const m of withoutLinks(text).matchAll(BREAKDOWN)) {
    const total = cents(parseAmount(m[2]));
    let sum = 0;
    let valid = true;
    for (const raw of m[1].split("+")) {
      const t = raw.trim().match(TERM_PARTS);
      if (!t) {
        valid = false;
        break;
      }
      const qty = Number(t[1] ?? t[4] ?? "1");
      const price = cents(parseAmount(t[2] ?? t[3] ?? t[5]));
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY || !known.has(price)) valid = false;
      sum += qty * price;
    }
    out.push({ text: m[0].trim(), start: m.index, end: m.index + m[0].length, total, valid: valid && sum === total });
  }
  return out;
}

// Más largo que esto no se revisa: se retiene (acota el costo de las regex; el
// cerebro tiene tope de 1,024 tokens de salida, ~5,000 caracteres).
export const MAX_GUARD_CHARS = 8_000;

// ── Revisión ─────────────────────────────────────────────────────────────────
export function reviewReply(text: string, knowledge: { goal: string; faqs: readonly Faq[] }): GuardResult {
  if (text.length > MAX_GUARD_CHARS) return { ok: false, reason: "Respuesta demasiado larga para revisarla sola" };
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
  const breakdowns = findBreakdowns(text, known);
  const badBreakdowns = breakdowns.filter((b) => !b.valid);
  if (badBreakdowns.length) {
    problems.push(
      `desglose que no cuadra (precios de la base, cantidades de 1 a ${MAX_QTY}, cuenta exacta): ${badBreakdowns.map((b) => b.text).join(" · ")}`,
    );
  }
  // Un total con desglose correcto vale SOLO ahí (en su posición): el mismo número
  // en otra frase ("… = $6,500. La grande te la dejo en $6,500") no queda justificado.
  const inside = (list: Breakdown[], at: number) => list.some((b) => at >= b.start && at < b.end);
  const goodBreakdowns = breakdowns.filter((b) => b.valid);
  const badAmounts = [
    ...new Set(
      extractAmounts(text)
        .filter((a) => !known.has(cents(a.value)) && !inside(goodBreakdowns, a.at) && !inside(badBreakdowns, a.at))
        .map((a) => a.text),
    ),
  ];
  if (badAmounts.length) {
    problems.push(`monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: ${badAmounts.join(", ")}`);
  }

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
