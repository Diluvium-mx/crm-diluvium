// Revisión del borrador de seguimiento ANTES de guardarlo (reglas del dueño, 3-oct-2026): una
// sola pregunta, nunca una pregunta que la empresa ya hizo en el chat y nunca el precio que ya
// se le dio. PURO. Si falla, el lector lo rehace una vez (lector.ts); si vuelve a fallar, el
// intento no sale con texto.
import { normalizeSearch } from "@/lib/text/search";
import { amountsIn } from "@/lib/ai/runtime/lector-core";
import { hasForeignScript } from "@/lib/ai/runtime/internal-text";

// Palabras que no dicen de qué trata una pregunta.
const STOP = new Set(
  "para porque como cuando donde cual cuales cuanto cuanta cuantos cuantas esta este estos estas esa ese eso usted ustedes ud nos les le lo la las los una uno unos unas del al que con por sin sus su mas muy ya hay tiene tienen tuvo pudo puede podria quiere quisiera gustaria me mi se si no y o de en el es son fue sea algo alguna algun hola buenas buenos dias tardes noches gracias favor claro bien".split(
    " ",
  ),
);

// Temas que se preguntan con palabras distintas («¿tiene problemas de inundaciones?» y «¿se le
// mete el agua?» son la misma pregunta).
const TOPICS: readonly { name: string; re: RegExp }[] = [
  { name: "si se le mete el agua", re: /inunda|mete el agua|se le mete|entra el agua|le entra agua|problemas? (de|con) (el )?agua/ },
];

function questionsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/¿?[^.?!¡¿\n]*\?/g)) {
    const q = m[0].replace(/^¿/, "").trim();
    if (q.length >= 4) out.push(q);
  }
  return out;
}

function words(text: string): Set<string> {
  return new Set(
    normalizeSearch(text)
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

// Solo cantidades de dinero: fuera medidas («120 cm», «1.5 m», «52 pulgadas»), meses y porcentajes.
function moneyIn(text: string): number[] {
  const clean = text.replace(/\d+(?:[.,]\d+)?\s*(?:cm|cms|cent[ií]metros?|mts?|metros?|m\b|pulgadas?|"|meses|%)/gi, " ");
  return amountsIn(clean);
}

export type BorradorCheckInput = {
  borrador: string;
  /** Lo que escribió la empresa en el chat (Agente IA, vendedor, automático). */
  companyTexts: readonly string[];
};

/** Problemas del borrador, en palabras del vendedor ([] = está bien). */
export function borradorProblems({ borrador, companyTexts }: BorradorCheckInput): string[] {
  const problems: string[] = [];
  // 6-oct: letras de otro alfabeto (chino, cirílico…) → se rehace; la puerta de envío tampoco lo deja salir.
  if (hasForeignScript(borrador)) problems.push("trae letras de otro idioma (debe ser solo español)");
  const mine = questionsOf(borrador);
  if (mine.length > 1) problems.push(`hace ${mine.length} preguntas (debe ser una sola)`);

  const asked = companyTexts.flatMap(questionsOf);
  const askedNorm = asked.map((q) => normalizeSearch(q));
  for (const q of mine) {
    const nq = normalizeSearch(q);
    const topic = TOPICS.find((t) => t.re.test(nq) && askedNorm.some((a) => t.re.test(a)));
    if (topic) {
      problems.push(`vuelve a preguntar ${topic.name}, que ya se le preguntó`);
      continue;
    }
    const a = words(q);
    for (const other of asked) {
      const b = words(other);
      const shared = [...a].filter((w) => b.has(w)).length;
      if (shared >= 3 && shared / Math.min(a.size, b.size) >= 0.7) {
        problems.push(`repite una pregunta que ya se hizo: «${other}»`);
        break;
      }
    }
  }

  const said = new Set(companyTexts.flatMap(moneyIn));
  const repeated = moneyIn(borrador).filter((n) => said.has(n));
  if (repeated.length) problems.push(`repite el precio que ya se le dio ($${repeated[0].toLocaleString("es-MX")})`);
  return problems;
}
