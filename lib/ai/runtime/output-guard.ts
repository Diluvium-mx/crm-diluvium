// GUARDIA DE SALIDA del Agente IA (Fase B). PURO: sin DB ni red. Antes de
// enviar en modo AUTO, la respuesta del cerebro se revisa contra la base de
// conocimiento ACTIVA de la organización:
//   - un monto o precio que no aparezca tal cual en el Goal ni en las FAQs activas,
//     salvo un TOTAL con su desglose correcto en la misma respuesta
//     ("3 × $5,500 = $16,500", "$5,500 + $7,000 = $12,500"), o
//   - un porcentaje, un "NxM" (2x1) o unos "N meses sin intereses" que no estén tal
//     cual en la base activa, o
//   - un enlace fuera de la lista permitida (diluvium.com.mx y los enlaces de
//     Amazon / Mercado Libre que ya están en las FAQs activas)
// → desde el 23-sep-2026 SÍ se envía: solo deja un aviso al vendedor en el hilo.
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
// La parte local lleva al menos una letra y no empieza pegada a "$": "$6.500@x.co" y
// "$6.500a@x.co" no son correos (y su monto cuenta).
const EMAIL =
  /(?<![\p{L}\p{N}._%+\-$])(?<!\$[ \t\u00a0\u202f]{1,3})(?=[\p{N}._%+\-]{0,63}\p{L})[\p{L}\p{N}._%+\-]{1,64}@(?:[\p{L}\p{N}\-]{1,63}\.){1,8}\p{L}{2,24}/giu;
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
  return text
    .replace(URL_WITH_SCHEME, " ")
    .replace(EMAIL, " ")
    .replace(IPV4, " ")
    .replace(BARE_DOMAIN, " ")
    .replace(/[ \t]{2,}/g, " "); // varios enlaces seguidos tampoco separan precio y contexto
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
// "mil" con resto opcional: "$7 mil 500" = $7,500 (antes se leía $7,000, que está en la base).
// Lo que va ANTES de un número que no es precio sino identificador (CP, teléfono, folio…).
const NOT_AN_ID = String.raw`(?<!(?:c\.?${H}?p\.?|c[oó]digo${H}{1,3}postal|tel[eé]fono|tel\.?|cel(?:ular)?|whats(?:app)?|n[uú]mero|no\.|#|folio|pedido|gu[ií]a|orden|calle|cuenta|clabe|tarjeta|ext\.?)${H}{0,3}:?${H}{0,3})(?<!\p{N}${H})`;
const MIL_CORE = String.raw`${H}{0,3}mil\b(?:${H}{1,3}\d{1,3}(?!\p{N}|[.,]\p{N})${UNIT})?`;
const MIL = String.raw`(${MIL_CORE})?`;

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
  { re: rx(String.raw`${START}(${NUM})${END}(${MIL_CORE})(?!${H}{0,3}(?:litros?|metros?|piezas?|unidades?))`), shown: whole },
  // Número de 4+ cifras suelto (sin $, moneda ni contexto): "te la dejo a 6500", "sí, 6500
  // está bien". No cuentan un año (19xx/20xx) ni lo que sigue a CP, teléfono, #, folio,
  // pedido, guía o calle, ni un grupo de teléfono ("668 242 6364").
  { re: rx(String.raw`${START}${NOT_AN_ID}(?!(?:19|20)\d{2}(?!\p{N}))(\d{4,9})${END}()${UNIT}(?!${H}{0,3}mil\b)`), shown: numOnly },
  // Número con separador de miles sin unidad: "Mediana: 4,200", "entre $3,500 y 4,200"
  { re: rx(String.raw`${START}(${GROUPED})${END}()${UNIT}(?!${H}{0,3}mil\b)`), shown: numOnly },
  // Contexto de precio antes: "cuesta 850", "te la dejo en 4200", "serían 9,000"
  {
    re: rx(
      String.raw`(?<!\p{L})(?:cuestan?|costo|precio|valen?|total|final|salen?|quedan?|dej[oa]r?|dejamos|ser[ií]an?|son|pagar[ií]?a?s?|pagas|pago|anticipo|enganche|descuento|rebaj[oa]r?|bajo|cobro|cobramos|oferta|promoci[oó]n|env[ií]o|antes|ahora|por)(?!\p{L})(?:${H}{1,3}(?:es|son|del?|en|a|al|por|solo|como|unos?|la|lo|los|las|te|se)){0,4}${H}{0,3}:?${H}{0,3}${START}(${BIG})${END}${MIL}${UNIT}`,
    ),
    shown: numOnly,
  },
  // Contexto de precio después: "4200 en total", "850 cada una", "3,000 de anticipo"
  {
    re: rx(
      String.raw`${START}(${BIG})${END}${MIL}${H}{1,3}(?:en${H}{1,3}total|de${H}{1,3}total|cada${H}{1,3}un[oa]|c\/u|por${H}{1,3}pieza|la${H}{1,3}pieza|m[aá]s${H}{1,3}iva|\+${H}{0,2}iva|de${H}{1,3}anticipo|de${H}{1,3}enganche|de${H}{1,3}descuento|de${H}{1,3}rebaja|de${H}{1,3}env[ií]o|menos)(?![\p{L}])`,
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

// Valor de un monto: número, × 1,000 si trae "mil", más el resto ("7 mil 500" = 7,500).
function amountValue(num: string, milPart: string | undefined): number {
  if (!milPart || !/mil/i.test(milPart)) return parseAmount(num);
  const rest = milPart.match(/(\d{1,3})\s*$/);
  return parseAmount(num, true) + (rest ? Number(rest[1]) : 0);
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
      hits.push({ text: shown(m), value: amountValue(m[1], m[2]), at });
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
// Etiqueta opcional de un término, con VOCABULARIO CERRADO (sin dígitos, "x",
// "por", "menos" ni números con letra): "mediana $5,500", "$5,500 (grande)". Una
// etiqueta libre dejaba esconder cantidades u operaciones ("(x2)", "x tres").
const LABEL_WORD = String.raw`(?:minis?|chic[ao]s?|median[ao]s?|grandes?|est[aá]ndar(?:es)?|medidas?|especial(?:es)?|tap[oó]n(?:es)?|compuertas?|kits?|a|la|de)(?!\p{L})`;
// Frases de precio unitario ("3 × $749 por pieza", "$5,500 c/u"): tampoco llevan cifras.
const UNIT_PHRASE = String.raw`(?:por${H}{1,3}(?:pieza|unidad)|cada${H}{1,3}un[oa]|c/u)(?!\p{L})`;
const LABEL = String.raw`(?:${UNIT_PHRASE}|${LABEL_WORD}(?:${H}{1,3}${LABEL_WORD}){0,3}|\(${H}{0,2}${LABEL_WORD}(?:${H}{1,3}${LABEL_WORD}){0,3}${H}{0,2}\))`;
// Núcleo de un término: "3 × $5,500", "3 compuertas × $5,500", "$5,500 × 3" o "$5,500".
const CORE = (g: boolean) => {
  const c = (x: string) => (g ? `(${x})` : x);
  return String.raw`(?:${c(String.raw`\d{1,3}`)}(?!\p{N})(?:${H}{1,3}${LABEL_WORD}){0,3}${H}{0,3}${TIMES}${H}{0,3}\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY}|\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY}${H}{0,3}${TIMES}${H}{0,3}${c(String.raw`\d{1,3}`)}(?!\p{N})|\$${H}{0,3}${c(PRICE_NUM)}${CURRENCY})`;
};
const TERM = String.raw`(?:${LABEL}${H}{1,3})?${CORE(false)}(?:${H}{1,3}${LABEL})?`;
// Términos unidos por "+" (hasta 10), "=" y el total.
const BREAKDOWN = new RegExp(
  String.raw`(?<![\p{L}\p{N}$.,])(${TERM}(?:${H}{0,3}\+${H}{0,3}${TERM}){0,9})${H}{0,3}=${H}{0,3}\$?${H}{0,3}(${PRICE_NUM})${CURRENCY}`,
  "giu",
);
const TERM_PARTS = new RegExp(String.raw`^(?:${LABEL}${H}{1,3})?${CORE(true)}(?:${H}{1,3}${LABEL})?$`, "iu");

// Ni antes ni después del desglose puede haber otra operación o cantidad: en
// "3 × $749 × 2 = $1,498", "3 medianas $5,500 + …", "$11,000 – $3,000 + …" o
// "… = $16,500 menos $3,000" solo se leería un pedazo de la cuenta.
const TOKEN = /\p{L}+|[\p{N}$][\p{N}$.,]*|[^\s\p{L}\p{N}]/gu;
const OP_CHAR = /^[×*÷/=+−]$/u;
const DASH = /^[-‐‑‒–—]$/u;
const OP_WORD = /^(?:x|por|veces|menos|m[aá]s|entre)$/iu;
const LABEL_ONLY = new RegExp(String.raw`^${LABEL_WORD}$`, "iu");
const PUNCT = /^[,;:]$/u;
const endsInNumber = (t: string | undefined) => t !== undefined && /\p{N}$/u.test(t);

function operationBefore(prefix: string): boolean {
  const toks = prefix.match(TOKEN) ?? [];
  let i = toks.length - 1;
  while (i >= 0 && (LABEL_ONLY.test(toks[i]) || PUNCT.test(toks[i]))) i--; // "3 medianas $5,500 …"
  if (i < 0) return false;
  const t = toks[i];
  // Una cantidad suelta antes ("3 medianas $5,500 + …", "las dos: …") la revisa
  // sentenceQuantities contra las cantidades del desglose; aquí solo operaciones.
  if (OP_CHAR.test(t) || OP_WORD.test(t)) return true;
  // Raya: resta si hay un número antes ("$11,000 – $3,000 + …"); si no, es puntuación ("Claro - …").
  return DASH.test(t) && endsInNumber(toks[i - 1]);
}

// Cantidades que la MISMA frase menciona fuera del desglose deben ser las del desglose
// (o su total de piezas): "Para tus 6 compuertas… 3 × $5,500 = $16,500" no cuadra. No
// cuentan medidas, tiempos ni porcentajes, ni "un/una" (artículos).
const QTY_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const LOOSE_QTY = new RegExp(
  String.raw`(?<![\p{N}$.,])(\d{1,2})(?![\p{N}.,:])(?!${H}{0,3}(?:cm|mm|m|mts?|metros?|cent[ií]metros?|pulgadas?|pulg|kg|kilos?|litros?|%|d[ií]as?|semanas?|mes(?:es)?|años?|horas?|hrs?|minutos?|min|h[aá]biles|a\.?${H}?m\.?|p\.?${H}?m\.?)(?!\p{L}))|(?<!\p{L})(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?!\p{L})`,
  "giu",
);

function sentenceBounds(clean: string, start: number, end: number): [number, number] {
  const isEnd = (i: number) => /[!?\n]/u.test(clean[i]) || (clean[i] === "." && (i + 1 >= clean.length || /\s/u.test(clean[i + 1])));
  let s = start;
  while (s > 0 && !isEnd(s - 1)) s--;
  let e = end;
  while (e < clean.length && !isEnd(e)) e++;
  return [s, e];
}

function sentenceQuantities(outside: string): number[] {
  return [...outside.matchAll(LOOSE_QTY)].map((m) => (m[1] ? Number(m[1]) : QTY_WORDS[m[2].toLowerCase()]));
}

function operationAfter(suffix: string): boolean {
  const toks = (suffix.match(TOKEN) ?? []).filter((t, i) => !(i === 0 && PUNCT.test(t)));
  const [t, next] = toks;
  if (t === undefined) return false;
  if (OP_CHAR.test(t) || OP_WORD.test(t) || t === "%") return true;
  return DASH.test(t) && next !== undefined && /^[\p{N}$]/u.test(next);
}

// start/end: tramo del desglose; totalAt: posición del número del total. Todo en el
// texto sin enlaces (el mismo en el que extractAmounts reporta sus posiciones).
export type Breakdown = { text: string; start: number; end: number; totalAt: number; total: number; valid: boolean };

// Desgloses de la respuesta, validados contra los precios de la base (centavos).
export function findBreakdowns(text: string, known: ReadonlySet<number>): Breakdown[] {
  const out: Breakdown[] = [];
  const clean = withoutLinks(text);
  for (const m of clean.matchAll(BREAKDOWN)) {
    const end = m.index + m[0].length;
    const total = cents(parseAmount(m[2]));
    let sum = 0;
    const qtys: number[] = [];
    let valid = !operationBefore(clean.slice(Math.max(0, m.index - 80), m.index)) && !operationAfter(clean.slice(end, end + 40));
    for (const raw of m[1].split("+")) {
      const t = raw.trim().match(TERM_PARTS);
      if (!t) {
        valid = false;
        break;
      }
      const qty = Number(t[1] ?? t[4] ?? "1");
      qtys.push(qty);
      const price = cents(parseAmount(t[2] ?? t[3] ?? t[5]));
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY || !known.has(price)) valid = false;
      sum += qty * price;
    }
    const [ss, se] = sentenceBounds(clean, m.index, end);
    const allowedQty = new Set([...qtys, qtys.reduce((a, b) => a + b, 0)]);
    if (sentenceQuantities(`${clean.slice(ss, m.index)} ${clean.slice(end, se)}`).some((q) => !allowedQty.has(q))) valid = false;
    // El total es el último número del tramo.
    const totalAt = m.index + m[0].lastIndexOf(m[2]);
    out.push({ text: m[0].trim(), start: m.index, end, totalAt, total, valid: valid && sum === total });
  }
  return out;
}

// ── Promociones: porcentajes, NxM y meses sin intereses ──────────────────────
// Solo pasan si están escritos tal cual en la base activa ("50%", "6 meses sin
// intereses"); si no, van a revisión: "10% de descuento", "2x1", "18 MSI". Se
// buscan en el texto SIN enlaces (un enlace trae "%3A", "39x3"… que no son promos).
const PERCENT = new RegExp(
  String.raw`(?<![\p{N}.,])(\d{1,3}(?:[.,]\d{1,2})?)${H}{0,2}(?:%|por${H}{1,3}ciento(?!\p{L}))`,
  "giu",
);
const N_X_M = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,$])(\d{1,2})${H}{0,2}(?:[x×]|por)${H}{0,2}(\d{1,2})(?!\p{N}|[.,]\p{N})(?!${H}{0,3}(?:cm|mm|m|mts?|metros?|pulgadas?|pulg|\$)(?!\p{L}))`,
  "giu",
);
const MSI = new RegExp(
  String.raw`(?<![\p{N}.,])(\d{1,2})${H}{0,3}(?:(?:meses|mensualidades)${H}{1,3}sin${H}{1,3}inter[eé]s(?:es)?|msi)(?!\p{L})`,
  "giu",
);

// Si la respuesta habla de meses sin intereses, cualquier "N meses" / "N mensualidades"
// cuenta como plazo ofrecido ("Manejamos meses sin intereses: hasta 12 meses").
const MSI_CONTEXT = /sin\s{1,3}inter[eé]s|(?<!\p{L})msi(?!\p{L})/iu;
const MONTHS = new RegExp(String.raw`(?<![\p{N}.,])(\d{1,2})${H}{0,3}(?:meses|mensualidades)(?!\p{L})`, "giu");

type Promo = { key: string; text: string };

export function extractPromos(text: string): Promo[] {
  const clean = withoutLinks(text);
  const num = (x: string) => Number(x.replace(",", "."));
  const msiAt = new Set([...clean.matchAll(MSI)].map((m) => m.index));
  return [
    ...[...clean.matchAll(PERCENT)].map((m) => ({ key: `%${num(m[1])}`, text: m[0].trim() })),
    ...[...clean.matchAll(N_X_M)].map((m) => ({ key: `${Number(m[1])}x${Number(m[2])}`, text: m[0].trim() })),
    ...[...clean.matchAll(MSI)].map((m) => ({ key: `msi${Number(m[1])}`, text: m[0].trim() })),
    ...(MSI_CONTEXT.test(clean)
      ? [...clean.matchAll(MONTHS)]
          .filter((m) => !msiAt.has(m.index))
          .map((m) => ({ key: `msi${Number(m[1])}`, text: m[0].trim() }))
      : []),
  ];
}

// Más largo que esto no se revisa: se retiene (acota el costo de las regex; el
// cerebro tiene tope de 1,024 tokens de salida, ~5,000 caracteres).
export const MAX_GUARD_CHARS = 8_000;

// ── Revisión ─────────────────────────────────────────────────────────────────
// Formas Unicode equivalentes a cifras y signos comunes ("＄", "６５００", "⁵⁰⁰") y
// caracteres invisibles (ancho cero) se normalizan antes de revisar.
const normalize = (t: string) => t.normalize("NFKC").replace(/\p{Cf}/gu, "");
// Un "$" junto a cifras (aunque haya un salto de línea) que ningún patrón pudo leer.
const DOLLAR_DIGIT = /\$\s{0,5}\p{N}/gu;

export function reviewReply(input: string, rawKnowledge: { goal: string; faqs: readonly Faq[] }): GuardResult {
  const text = normalize(input);
  const knowledge = {
    goal: normalize(rawKnowledge.goal),
    faqs: rawKnowledge.faqs.map((f) => ({ ...f, question: normalize(f.question), answer: normalize(f.answer) })),
  };
  if (text.length > MAX_GUARD_CHARS) return { ok: false, reason: "Respuesta demasiado larga para revisarla sola" };
  const active = knowledge.faqs.filter((f) => f.enabled !== false);
  const faqText = active.map((f) => `${f.question}\n${f.answer}`).join("\n");
  const known = new Set(extractAmounts(`${knowledge.goal}\n${faqText}`).map((a) => cents(a.value)));
  const knownPromos = new Set(extractPromos(`${knowledge.goal}\n${faqText}`).map((p) => p.key));
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
  // Un desglose correcto justifica SOLO su total, en su posición exacta: ni el mismo
  // número en otra frase ("… = $6,500. La grande te la dejo en $6,500") ni otro
  // monto metido dentro del tramo ("Grande $11,000 (hoy $6,500) = $11,000").
  const justifiedAt = new Set(breakdowns.filter((b) => b.valid).map((b) => b.totalAt));
  const insideBad = (at: number) => badBreakdowns.some((b) => at >= b.start && at < b.end);
  const hits = extractAmounts(text);
  // Falla cerrado: un "$" con cifras que no se pudo leer como monto va a revisión.
  const hitAt = new Set(hits.map((h) => h.at));
  const unread = [...withoutLinks(text).matchAll(DOLLAR_DIGIT)]
    .filter((m) => !hitAt.has(m.index + m[0].length - 1))
    .map((m) => m[0].replace(/\s+/gu, " ").trim());
  if (unread.length) problems.push(`monto que no se pudo leer: ${[...new Set(unread)].join(", ")}`);
  const badAmounts = [
    ...new Set(
      hits
        .filter((a) => !known.has(cents(a.value)) && !justifiedAt.has(a.at) && !insideBad(a.at))
        .map((a) => a.text),
    ),
  ];
  if (badAmounts.length) {
    problems.push(`monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: ${badAmounts.join(", ")}`);
  }

  const badPromos = [...new Set(extractPromos(text).filter((p) => !knownPromos.has(p.key)).map((p) => p.text))];
  if (badPromos.length) problems.push(`promoción que no está en el Goal ni en las FAQs: ${badPromos.join(", ")}`);

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
