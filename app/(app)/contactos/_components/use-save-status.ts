"use client";

// Aviso sutil de guardado automático (B2): "Guardando…" mientras corre y
// "Guardado" un momento al terminar; si falla, el mensaje queda visible.
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const SAVED_VISIBLE_MS = 1_500;
// Un error se queda al menos esto aunque otro guardado posterior salga bien.
const ERROR_MIN_MS = 5_000;

export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastErrorAt = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Corre `action` mostrando el estado. Devuelve true si guardó. */
  const run = useCallback(async (action: () => Promise<unknown>, errorMessage = "No se pudo guardar."): Promise<boolean> => {
    pending.current++;
    // Un error reciente no se tapa con "Guardando…": se queda su tiempo mínimo.
    if (Date.now() - lastErrorAt.current >= ERROR_MIN_MS) {
      clearTimeout(timer.current);
      setStatus({ state: "saving" });
    }
    try {
      await action();
      pending.current--;
      const errorShownFor = Date.now() - lastErrorAt.current;
      if (pending.current === 0 && errorShownFor >= ERROR_MIN_MS) {
        setStatus({ state: "saved" });
        timer.current = setTimeout(() => setStatus({ state: "idle" }), SAVED_VISIBLE_MS);
      }
      return true;
    } catch {
      pending.current--;
      lastErrorAt.current = Date.now();
      setStatus({ state: "error", message: errorMessage });
      timer.current = setTimeout(() => setStatus({ state: "idle" }), ERROR_MIN_MS);
      return false;
    }
  }, []);

  return { status, run };
}
