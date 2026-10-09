// Reglas puras de «Programar para las 22:00» (9-oct-2026, regla del dueño): cuándo se aplica,
// los cambios a la lista de FAQs programada y el resumen del aviso. Sin base de datos: las usan
// el editor (cliente), las Server Actions y el worker. Detalle: docs/agente-ia.md › Programar el
// Goal y las FAQs para las 22:00.
import { instantToLocal, localToInstant } from "@/lib/scheduled/rules";

/** Hora en que se aplica lo programado (Mazatlán). */
export const APPLY_HOUR = 22;
/** Antes de esta hora (madrugada) también es «de noche»: lo programado se aplica de inmediato. */
export const NIGHT_UNTIL_HOUR = 6;
export const APPLY_LABEL = "22:00";

export type FaqItem = { id: string; question: string; answer: string; enabled: boolean; position: number };
export type FaqInput = { question: string; answer: string; enabled: boolean };

function localHour(now: Date): number {
  return Number(instantToLocal(now).slice(11, 13));
}

/** De 22:00 a 6:00 (Mazatlán) lo programado se aplica en el siguiente minuto. */
export function isNight(now: Date): boolean {
  const h = localHour(now);
  return h >= APPLY_HOUR || h < NIGHT_UNTIL_HOUR;
}

/** Cuándo se aplica algo programado ahora: hoy a las 22:00, o de inmediato si ya es de noche. */
export function applyAtFor(now: Date): Date {
  if (isNight(now)) return now;
  return localToInstant(`${instantToLocal(now).slice(0, 10)}T${String(APPLY_HOUR).padStart(2, "0")}:00`) ?? now;
}

/** Lista en orden y con posiciones 1..n (como la arma el editor). */
export function normalizeFaqs(list: readonly FaqItem[]): FaqItem[] {
  return [...list]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((f, i) => ({ id: f.id, question: f.question.trim(), answer: f.answer.trim(), enabled: f.enabled, position: i + 1 }));
}

/** Mismo contenido y mismo orden (los ids no cuentan: una versión restaurada trae ids nuevos). */
export function sameFaqs(a: readonly FaqItem[], b: readonly FaqItem[]): boolean {
  const x = normalizeFaqs(a);
  const y = normalizeFaqs(b);
  return x.length === y.length && x.every((f, i) => f.question === y[i].question && f.answer === y[i].answer && f.enabled === y[i].enabled);
}

export function addFaq(list: readonly FaqItem[], input: FaqInput, id: string): FaqItem[] {
  const next = normalizeFaqs(list);
  return [...next, { id, question: input.question.trim(), answer: input.answer.trim(), enabled: input.enabled, position: next.length + 1 }];
}

export function editFaq(list: readonly FaqItem[], id: string, input: FaqInput): FaqItem[] {
  return normalizeFaqs(list).map((f) => (f.id === id ? { ...f, question: input.question.trim(), answer: input.answer.trim(), enabled: input.enabled } : f));
}

export function removeFaqs(list: readonly FaqItem[], ids: readonly string[]): FaqItem[] {
  const drop = new Set(ids);
  return normalizeFaqs(list.filter((f) => !drop.has(f.id)));
}

export type FaqChanges = { nuevas: number; editadas: number; borradas: number };

/** Qué cambia la lista programada contra la de antes (por id). */
export function faqChanges(before: readonly FaqItem[], after: readonly FaqItem[]): FaqChanges {
  const old = new Map(before.map((f) => [f.id, f]));
  const now = new Set(after.map((f) => f.id));
  let nuevas = 0;
  let editadas = 0;
  for (const f of after) {
    const o = old.get(f.id);
    if (!o) nuevas++;
    else if (o.question.trim() !== f.question.trim() || o.answer.trim() !== f.answer.trim() || o.enabled !== f.enabled) editadas++;
  }
  const borradas = before.filter((f) => !now.has(f.id)).length;
  return { nuevas, editadas, borradas };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «2 nuevas, 1 editada, 1 borrada» (o «el orden» si solo cambió el orden). */
export function describeFaqChanges(c: FaqChanges): string {
  const parts = [
    c.nuevas ? plural(c.nuevas, "nueva", "nuevas") : null,
    c.editadas ? plural(c.editadas, "editada", "editadas") : null,
    c.borradas ? plural(c.borradas, "borrada", "borradas") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "el orden";
}
