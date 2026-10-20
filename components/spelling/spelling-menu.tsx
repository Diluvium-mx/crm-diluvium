"use client";

// Menú del corrector (estilo Apple): sale pegado a la palabra subrayada al hacer clic
// izquierdo. Arriba la palabra correcta en negritas; abajo Ignorar y Agregar al diccionario.
// Va en un portal con posición fija; no le quita el foco a la caja de texto.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Caja de la palabra en la pantalla (getBoundingClientRect). */
  anchor: DOMRect;
  /** null = todavía buscando. */
  suggestions: string[] | null;
  onPick: (suggestion: string) => void;
  onIgnore: () => void;
  onAdd: () => void;
};

const GAP = 4;
const EDGE = 8;

const ITEM =
  "flex w-full cursor-default items-center rounded-md px-2.5 py-1 text-left text-sm outline-none select-none hover:bg-brand-navy hover:text-white focus-visible:bg-brand-navy focus-visible:text-white";

export function SpellingMenu({ anchor, suggestions, onPick, onIgnore, onAdd }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Debajo de la palabra; si no cabe (la caja del chat va abajo de la pantalla), arriba.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetHeight: h, offsetWidth: w } = el;
    const below = anchor.bottom + GAP;
    const top = below + h <= window.innerHeight - EDGE ? below : Math.max(EDGE, anchor.top - GAP - h);
    const left = Math.min(Math.max(EDGE, anchor.left), window.innerWidth - w - EDGE);
    setPos({ top, left });
  }, [anchor, suggestions]);

  // mousedown sin default: el clic no le quita el foco (ni la selección) a la caja.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Corrección ortográfica"
      data-spelling-menu=""
      onMouseDown={keepFocus}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed z-[60] min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      {suggestions === null ? (
        <p className="px-2.5 py-1 text-sm text-muted-foreground">Buscando…</p>
      ) : suggestions.length === 0 ? (
        <p className="px-2.5 py-1 text-sm text-muted-foreground">Sin sugerencias</p>
      ) : (
        suggestions.map((s) => (
          <button key={s} type="button" role="menuitem" className={`${ITEM} font-semibold`} onClick={() => onPick(s)}>
            {s}
          </button>
        ))
      )}
      <div role="separator" className="mx-1.5 my-1 h-px bg-foreground/10" />
      <button type="button" role="menuitem" className={ITEM} onClick={onIgnore}>
        Ignorar
      </button>
      <button type="button" role="menuitem" className={ITEM} onClick={onAdd}>
        Agregar al diccionario
      </button>
    </div>,
    document.body,
  );
}
