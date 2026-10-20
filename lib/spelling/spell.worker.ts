// Web Worker del corrector ortográfico (20-oct-2026, docs/corrector.md): carga el
// diccionario UNA vez (~0.9 MB, ~0.3 s) y revisa fuera del hilo de la página, para que
// escribir nunca se sienta lento.
import nspell from "nspell";
import { isMisspelled, suggestionsFor, type Dictionary } from "./rules";
import { DICTIONARY_AFF_URL, DICTIONARY_DIC_URL, type SpellRequest, type SpellResponse } from "./protocol";

async function loadText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar el diccionario (${res.status}).`);
  return res.text();
}

const ready: Promise<Dictionary> = Promise.all([loadText(DICTIONARY_AFF_URL), loadText(DICTIONARY_DIC_URL)]).then(
  ([aff, dic]) => nspell(aff, dic),
);

function reply(message: SpellResponse): void {
  postMessage(message);
}

addEventListener("message", (event: MessageEvent<SpellRequest>) => {
  const req = event.data;
  ready
    .then((dict) => {
      if (req.type === "check") {
        reply({ type: "checked", id: req.id, misspelled: req.words.filter((w) => isMisspelled(w, dict)) });
      } else {
        reply({ type: "suggested", id: req.id, suggestions: suggestionsFor(req.word, dict) });
      }
    })
    .catch((error: unknown) => {
      reply({ type: "failed", id: req.id, message: error instanceof Error ? error.message : String(error) });
    });
});
