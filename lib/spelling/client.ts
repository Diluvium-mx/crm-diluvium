// Puente de la página con el Web Worker del corrector. Un solo Worker para todo el CRM
// (se crea la primera vez que una caja de texto lo pide) y un caché de lo ya revisado.
import type { SpellRequest, SpellResponse } from "./protocol";

type Pending = { resolve: (res: SpellResponse) => void };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();
const verdicts = new Map<string, boolean>(); // palabra → ¿mal escrita?

function getWorker(): Worker | null {
  if (broken || typeof window === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
  } catch {
    console.warn("[corrector] no arrancó el Worker: las cajas quedan sin subrayado");
    broken = true;
    return null;
  }
  worker.addEventListener("message", (event: MessageEvent<SpellResponse>) => {
    pending.get(event.data.id)?.resolve(event.data);
    pending.delete(event.data.id);
  });
  worker.addEventListener("error", (event) => {
    console.warn("[corrector] falló", event.message);
  });
  return worker;
}

type Request = { type: "check"; words: string[] } | { type: "suggest"; word: string };

function send(req: Request): Promise<SpellResponse | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    const message: SpellRequest = { ...req, id };
    w.postMessage(message);
  });
}

/** Las palabras mal escritas de la lista (sin red ni diccionario: ninguna). */
export async function findMisspelled(words: string[]): Promise<Set<string>> {
  const unknown = [...new Set(words)].filter((w) => !verdicts.has(w));
  if (unknown.length > 0) {
    const res = await send({ type: "check", words: unknown });
    if (res?.type === "checked") {
      const bad = new Set(res.misspelled);
      for (const w of unknown) verdicts.set(w, bad.has(w));
    } else if (res?.type === "failed") {
      console.warn("[corrector]", res.message);
    }
  }
  return new Set(words.filter((w) => verdicts.get(w) === true));
}

export async function getSuggestions(word: string): Promise<string[]> {
  const res = await send({ type: "suggest", word });
  return res?.type === "suggested" ? res.suggestions : [];
}
