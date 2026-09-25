"use client";

// Pop-up compacto justo abajo de la barra azul de arriba, centrado en el área de
// contenido (a la derecha del sidebar w-56; la barra mide h-16, ver
// app/(app)/layout.tsx). Dos piezas en el MISMO lugar:
// - TopConfirm: pregunta con "Cancelar" y la acción primaria en naranja. Esc o clic
//   fuera cancelan (salvo mientras guarda). Enfoca "Cancelar" al abrir y devuelve el
//   foco al cerrar.
// - TopNotice: aviso breve de que ya quedó (quien lo muestra decide cuánto dura).
//   Va siempre montado: su región para lectores de pantalla existe antes de que
//   llegue el texto, así el aviso sí se anuncia.
// Sin lógica de datos. Respeta "reducir movimiento" (la animación es motion-safe).
import { useEffect, useId, useLayoutEffect, useRef } from "react";

function TopLayer({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed top-[4.5rem] right-0 left-56 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2">
        {children}
      </div>
    </div>
  );
}

export function TopConfirm({
  title,
  children,
  confirmLabel,
  pendingLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Los manejadores del documento leen siempre lo último sin re-suscribirse.
  const latest = useRef({ pending, onCancel });
  useLayoutEffect(() => {
    latest.current = { pending, onCancel };
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    function cancel() {
      if (!latest.current.pending) latest.current.onCancel();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    }
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return;
      cancel();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <TopLayer>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="flex flex-col gap-1">
          <p id={titleId} className="font-medium text-foreground">
            {title}
          </p>
          {children && (
            <div id={bodyId} className="text-xs text-muted-foreground">
              {children}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded border border-black/15 px-3 py-1.5 text-sm text-foreground disabled:opacity-50 dark:border-white/15"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </TopLayer>
  );
}

export function TopNotice({ message }: { message: string | null }) {
  return (
    <>
      <p role="status" className="sr-only">
        {message ?? ""}
      </p>
      {message && (
        <TopLayer>
          <div
            aria-hidden="true"
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10"
          >
            <span className="font-semibold text-brand-navy dark:text-sky-300">✓</span>
            {message}
          </div>
        </TopLayer>
      )}
    </>
  );
}
