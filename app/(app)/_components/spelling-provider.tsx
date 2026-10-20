"use client";

// Diccionario del equipo del corrector ortográfico (20-oct-2026, docs/corrector.md). El
// layout lo carga del servidor; al volver a la pestaña se relee, para que lo que otro
// vendedor agregó deje de subrayarse sin recargar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { addSpellingWord, getSpellingWords } from "@/lib/actions/spelling";
import { customWordKey } from "@/lib/spelling/rules";
import { SpellingContext, type SpellingCtx } from "@/components/spelling/spelling-context";

export function SpellingProvider({ initial, children }: { initial: string[]; children: React.ReactNode }) {
  const [words, setWords] = useState<ReadonlySet<string>>(() => new Set(initial));

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      getSpellingWords()
        .then((fresh) => setWords(new Set(fresh)))
        .catch(() => {
          // Sin red: se queda con lo que hay.
        });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const addWord = useCallback(async (word: string) => {
    const key = customWordKey(word);
    // Se quita el subrayado en el momento; si el servidor la rechaza, regresa.
    setWords((prev) => new Set(prev).add(key));
    try {
      await addSpellingWord(word);
    } catch (error) {
      setWords((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      throw error;
    }
  }, []);

  const value = useMemo<SpellingCtx>(() => ({ teamWords: words, addWord }), [words, addWord]);
  return <SpellingContext.Provider value={value}>{children}</SpellingContext.Provider>;
}
