"use client";

// Diccionario del equipo para el corrector (lo llena app/(app)/_components/spelling-provider.tsx).
import { createContext, useContext } from "react";

export type SpellingCtx = {
  /** Palabras del equipo en minúsculas: nunca se subrayan. */
  teamWords: ReadonlySet<string>;
  /** «Agregar al diccionario»: para todos los vendedores, para siempre. */
  addWord: (word: string) => Promise<void>;
};

const EMPTY: SpellingCtx = { teamWords: new Set(), addWord: async () => {} };

export const SpellingContext = createContext<SpellingCtx>(EMPTY);

export function useSpelling(): SpellingCtx {
  return useContext(SpellingContext);
}
