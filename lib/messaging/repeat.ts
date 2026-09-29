// Candado anti-repetición (28-sep-2026, pregunta duplicada): ni el Agente IA ni un
// workflow suyo (agente o palabra clave) le mandan al cliente un texto IDÉNTICO a uno
// que ya salió después de su último mensaje. PURO (sin BD).
//
// "Idéntico" = el mismo texto sin importar mayúsculas, espacios de más ni la forma
// Unicode de los acentos. Una paráfrasis NO es idéntica: eso lo evita la regla de la
// pregunta del workflow (lib/workflows/steps.ts, endsWithQuestionStep).
export function repeatKey(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}

/**
 * Separa lo que se puede mandar de lo repetido: contra lo que ya salió y contra lo
 * que va antes en la misma lista (dos burbujas iguales salen una vez). El orden se
 * conserva.
 */
export function splitRepeated(texts: readonly string[], alreadySent: readonly (string | null)[]): { keep: string[]; dropped: string[] } {
  const seen = new Set(alreadySent.flatMap((t) => (t && repeatKey(t) ? [repeatKey(t)] : [])));
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const t of texts) {
    const key = repeatKey(t);
    if (key && seen.has(key)) {
      dropped.push(t);
      continue;
    }
    if (key) seen.add(key);
    keep.push(t);
  }
  return { keep, dropped };
}
