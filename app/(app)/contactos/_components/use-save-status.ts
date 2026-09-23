"use client";

// Aviso sutil de guardado automático (B2): "Guardando…" mientras corre y
// "Guardado" un momento al terminar; si falla, el mensaje queda visible.
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const SAVED_VISIBLE_MS = 1_500;

export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Corre `action` mostrando el estado. Devuelve true si guardó. */
  const run = useCallback(async (action: () => Promise<unknown>, errorMessage = "No se pudo guardar."): Promise<boolean> => {
    pending.current++;
    clearTimeout(timer.current);
    setStatus({ state: "saving" });
    try {
      await action();
      pending.current--;
      if (pending.current === 0) {
        setStatus({ state: "saved" });
        timer.current = setTimeout(() => setStatus({ state: "idle" }), SAVED_VISIBLE_MS);
      }
      return true;
    } catch {
      pending.current--;
      setStatus({ state: "error", message: errorMessage });
      return false;
    }
  }, []);

  return { status, run };
}
