import { normalizeSearch } from "@/lib/text/search";

// Nombre del cliente (28-oct-2026, dueño: «por nada del mundo debe suceder»). PURO (sin BD).
//
// El 28-oct el Agente IA le contestó «Claro, Carlos. Quedamos a sus órdenes…» a una clienta: Carlos es
// el vendedor («Hola muy buenos días, aquí Carlos de Diluvium»). Sonnet calló ante «Enterado cualquier
// duda los contacto», eso contó como respuesta vacía y contestó GPT-5.6 Luna, que tomó el único nombre
// del chat. El modelo no recibe el nombre del cliente y los mensajes del vendedor le llegan como suyos
// (transcript.ts), así que cualquier modelo puede volver a confundirlo.
//
// Regla: el Agente IA solo llama al cliente por un nombre que el CLIENTE dio: lo escribió, lo dijo en una
// nota de voz o está en su perfil (nombre, apellido, usuario de Instagram). Cualquier otro nombre con el
// que se dirija a él se quita de la burbuja («Claro, Carlos. Quedamos…» → «Claro. Quedamos…») y el resto
// sale igual. Lo que escribió el vendedor NO cuenta: ahí va su propio nombre («aquí Carlos»).
//
// Cuándo un nombre es para dirigirse al cliente: va después de una coma y antes de un signo o del final
// («Gracias, Sandra.», «No puedo darle un tiempo exacto, Sandra.», «¡Gracias, Miguel!»), o justo después
// de un saludo al inicio de la frase («Hola Carlos,»). Antes de la coma va una palabra en minúscula o el
// inicio de la frase: «Estamos en Los Mochis, Sinaloa.» y «Paiporta, Valencia.» son lugares, no nombres.

// «don», «señora», «Lic.»… delante del nombre se quitan con él.
const HONORIFIC = String.raw`(?:(?:[Dd]on|[Dd]oña|[Ss]eñor|[Ss]eñora|[Ss]eñorita|[Ss]ra?|[Ss]rita|[Ll]ic|[Ii]ng|[Dd]ra?)\.?\s+)?`;
// Una o dos palabras con mayúscula inicial («Sandra», «Ana María»).
const WORD = String.raw`\p{Lu}[\p{Ll}\p{M}]+`;
const NAME = String.raw`${WORD}(?:\s+${WORD})?`;
// Después del nombre: un signo, un emoji o el final.
const AFTER = String.raw`(?=\s*(?:[,.;:!?¡¿…)]|\p{Extended_Pictographic}|$))`;
const START = String.raw`(?:^|[.!?…:\n]|\p{Extended_Pictographic})[\s¡¿"«(]*`;
const GREETING = String.raw`(?:Hola|Buen(?:os|as)\s+(?:días|tardes|noches)|(?:Muchas\s+)?[Gg]racias|Bienvenid[oa]s?|Mucho\s+gusto|Con\s+gusto)`;

const AFTER_COMMA = new RegExp(String.raw`,\s*${HONORIFIC}(${NAME})${AFTER}`, "gu");
const AFTER_GREETING = new RegExp(String.raw`(${START}${GREETING})\s+${HONORIFIC}(${NAME})${AFTER}`, "gu");
const LAST_WORD = /([\p{L}\p{N}]+)[^\p{L}\p{N}]*$/u;
const SENTENCE_START = new RegExp(String.raw`${START}$`, "u");

// Palabras con mayúscula que no son el nombre de nadie: marcas, pagos, paqueterías, estados y cortesías.
// Sin las que también son nombres o apellidos («Luis», «León», «Guerrero», «Hidalgo»): esas pasan por la
// regla de siempre. «Nuevo León» o «Mercado Libre» se reconocen por la otra palabra.
const NOT_NAMES = new Set(
  [
    "Diluvium", "México", "Amazon", "Mercado", "Libre", "Pago", "Shopify", "Instagram", "Facebook", "Google", "Maps",
    "Visa", "Mastercard", "Estafeta", "Paquetexpress", "Envia", "Fedex", "Dhl", "Dios",
    "Aguascalientes", "Baja", "California", "Sur", "Campeche", "Chiapas", "Chihuahua", "Coahuila", "Colima", "Durango",
    "Guanajuato", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo", "Oaxaca", "Puebla", "Querétaro", "Quintana",
    "Roo", "Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
    "Ciudad", "Estado", "Col", "Colonia",
    "Usted", "Ustedes", "Igualmente", "Gracias", "Saludos", "Bendiciones", "Excelente", "Perfecto", "Claro", "Listo",
    "Sí", "No", "Ok", "Señor", "Señora", "Señorita", "Don", "Doña", "Joven", "Amigo", "Amiga", "Estimado", "Estimada",
  ].map(normalizeSearch),
);
const isNotName = (words: readonly string[]) => words.some((w) => NOT_NAMES.has(w));

const wordsOf = (text: string): string[] => normalizeSearch(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Palabras con las que el cliente se ha dado a conocer: lo que escribió, lo que dijo en sus notas de voz y
 * su perfil (nombre, apellido, usuario de Instagram). Sin acentos ni mayúsculas.
 */
export function clientNameWords(texts: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const words = new Set<string>();
  for (const t of texts) if (t) for (const w of wordsOf(t)) words.add(w);
  return words;
}

// ¿Lo que va antes de la coma deja el nombre como vocativo? Palabra en minúscula («exacto, Sandra») o el
// inicio de la frase («Claro, Carlos»). Un nombre propio o un número antes («Los Mochis, Sinaloa»,
// «123, Col.») es un lugar o una dirección.
function beforeCommaIsVocative(prefix: string): boolean {
  const last = LAST_WORD.exec(prefix);
  if (!last) return true;
  const word = last[1];
  if (/^\p{Ll}/u.test(word)) return true;
  if (!/^\p{Lu}/u.test(word)) return false;
  return SENTENCE_START.test(prefix.slice(0, last.index));
}

/** Una burbuja sin los nombres con los que se dirige al cliente que el cliente no dio. */
export function withoutUnknownName(text: string, known: ReadonlySet<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const unknown = (name: string) => {
    const words = wordsOf(name);
    return !isNotName(words) && !words.every((w) => known.has(w));
  };
  let out = text.replace(AFTER_COMMA, (match: string, name: string, offset: number, whole: string) => {
    if (!beforeCommaIsVocative(whole.slice(0, offset)) || !unknown(name)) return match;
    removed.push(name);
    return "";
  });
  out = out.replace(AFTER_GREETING, (match: string, greeting: string, name: string) => {
    if (!unknown(name)) return match;
    removed.push(name);
    return greeting;
  });
  return { text: out, removed };
}

/** Las burbujas de la respuesta con el candado de nombres (run.ts, antes de enviar). */
export function withoutUnknownNames(bubbles: readonly string[], known: ReadonlySet<string>): { keep: string[]; removed: string[] } {
  const removed: string[] = [];
  const keep = bubbles.map((b) => {
    const r = withoutUnknownName(b, known);
    removed.push(...r.removed);
    return r.text;
  });
  return { keep, removed };
}
