"use client";

// Confirmación compartida de la pestaña Agente IA (27-sep-2026). REGLA DEL DUEÑO: cualquier
// cambio en esta pestaña muestra una ventana emergente para confirmar lo que se está
// haciendo; nada se guarda con un solo clic. Mismo patrón que el cambio de modelo
// (use-model-change.tsx):
// - ask({ title, body, confirmLabel, pendingLabel, done, run }) abre el pop-up de arriba
//   (TopConfirm) y NO guarda nada todavía;
// - con la acción primaria corre `run` (la Server Action); mientras guarda, Esc y clic
//   fuera no cancelan (lo cuida TopConfirm);
// - si sale bien, se cierra, corre `onDone` y aparece `done` 3 s en el mismo lugar
//   (TopNotice); si falla (o se cae la red), se cierra y `error` queda para que el
//   componente lo muestre como siempre (borde naranja). `scope` dice a qué parte del
//   componente pertenece el error (p. ej. qué formulario).
// Sin lógica de datos: cada llamada trae su `run`.
import { useEffect, useState, useTransition } from "react";
import { TopConfirm, TopNotice } from "@/components/ui/top-confirm";
import type { AgentActionResult } from "@/lib/agente-ia/types";

const DONE_MS = 3_000;
const NETWORK_ERROR = "No se pudo guardar; revisa tu conexión e inténtalo de nuevo.";

export type ConfirmRequest<R extends AgentActionResult> = {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  // Aviso breve al terminar bien ("Listo: …").
  done: string;
  run: () => Promise<R>;
  // Solo si salió bien, en el mismo render en que se cierra el pop-up.
  onDone?: (result: Extract<R, { ok: true }>) => void;
  // A qué parte del componente pertenece un error (formulario, fila…).
  scope?: string;
  // Mensaje si `run` truena (red caída, sesión vencida…).
  fallbackError?: string;
};

type Outcome = { ok: true; after: () => void } | { ok: false; message: string };

type Asking = {
  key: number;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  done: string;
  scope: string | null;
  exec: () => Promise<Outcome>;
};

export function useConfirm() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [done, setDone] = useState<{ text: string; key: number } | null>(null);
  const [error, setError] = useState<{ message: string; scope: string | null } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  function ask<R extends AgentActionResult>(request: ConfirmRequest<R>) {
    // Un cambio a la vez: mientras guarda, otro clic no abre otra pregunta.
    if (pending) return;
    setError(null);
    setDone(null);
    setAsking({
      key: Date.now(),
      title: request.title,
      body: request.body,
      confirmLabel: request.confirmLabel,
      pendingLabel: request.pendingLabel,
      done: request.done,
      scope: request.scope ?? null,
      exec: async () => {
        let r: R;
        try {
          r = await request.run();
        } catch {
          return { ok: false, message: request.fallbackError ?? NETWORK_ERROR };
        }
        const result: AgentActionResult = r;
        if (!result.ok) return { ok: false, message: result.message };
        return { ok: true, after: () => request.onDone?.(r as Extract<R, { ok: true }>) };
      },
    });
  }

  function confirm() {
    const current = asking;
    if (!current) return;
    start(async () => {
      const outcome = await current.exec();
      // Después del await, las actualizaciones van en su propia transición (React 19):
      // así el pop-up se cierra en el mismo render en que termina "pending".
      start(() => {
        setAsking(null);
        if (outcome.ok) {
          outcome.after();
          setDone({ text: current.done, key: Date.now() });
        } else {
          setError({ message: outcome.message, scope: current.scope });
        }
      });
    });
  }

  const ui = (
    <>
      {asking && (
        <TopConfirm
          key={asking.key}
          title={asking.title}
          confirmLabel={asking.confirmLabel}
          pendingLabel={asking.pendingLabel}
          pending={pending}
          onConfirm={confirm}
          onCancel={() => setAsking(null)}
        >
          {asking.body}
        </TopConfirm>
      )}
      <TopNotice message={!asking && done ? done.text : null} />
    </>
  );

  return {
    ask,
    pending,
    // Pregunta abierta (o guardando).
    open: asking !== null,
    error: error?.message ?? null,
    // El error solo si pertenece a esa parte del componente.
    errorFor: (scope: string) => (error && error.scope === scope ? error.message : null),
    clearError: () => setError(null),
    // Error sin pop-up (p. ej. un campo obligatorio vacío): no hay nada que confirmar.
    fail: (message: string, scope?: string) => setError({ message, scope: scope ?? null }),
    ui,
  };
}
