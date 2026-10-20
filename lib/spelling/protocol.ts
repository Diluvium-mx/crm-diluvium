// Mensajes entre la página y el Web Worker del corrector (spell.worker.ts).
export type SpellRequest =
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string };

export type SpellResponse =
  | { type: "checked"; id: number; misspelled: string[] }
  | { type: "suggested"; id: number; suggestions: string[] }
  | { type: "failed"; id: number; message: string };

// Archivos del diccionario (public/diccionario). Si se actualiza el paquete
// dictionary-es-mx se vuelven a copiar (lo vigila rules.test.ts).
export const DICTIONARY_AFF_URL = "/diccionario/es-MX.aff";
export const DICTIONARY_DIC_URL = "/diccionario/es-MX.dic";
