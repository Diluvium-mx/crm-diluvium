"use client";

// Lista o cuadrícula de los mensajes rápidos en su sección, acomodable arrastrando la manija ⋮⋮ (26-oct-2026,
// pedido del dueño): al soltar sobre otro, toma su lugar; una raya azul marca dónde va a quedar. Con el mouse
// basta moverlo un poco; en el celular, dejar el dedo un momento en la manija. Sin lógica de datos: el orden
// lo guarda quien la usa (fragmentos-tab.tsx › reorderSnippets).
import { useCallback, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { SnippetView } from "@/lib/snippets/types";
import { HighlightBody } from "./highlight";

export const TOKEN_CLASS = "rounded bg-brand-orange/15 px-1 font-medium text-brand-orange";

type Props = {
  items: SnippetView[];
  grid: boolean;
  /** Se puede acomodar (quien puede gestionar, sin búsqueda y con más de uno). */
  sortable: boolean;
  canManage: boolean;
  onEdit: (snippet: SnippetView) => void;
  onRemove: (snippet: SnippetView) => void;
  /** Soltó `fromId` sobre `toId`: `fromId` toma el lugar de `toId`. */
  onMove: (fromId: string, toId: string) => void;
};

export function FragmentosLista({ items, grid, sortable, canManage, onEdit, onRemove, onMove }: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? items.findIndex((s) => s.id === activeId) : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (event.over && event.over.id !== event.active.id) onMove(String(event.active.id), String(event.over.id));
  }

  return (
    // id fijo: sin él dnd-kit numera su descripción accesible distinto en el servidor y en el navegador.
    <DndContext
      id="mensajes-rapidos-orden"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <ul aria-label="Mensajes rápidos" className={grid ? "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3" : "space-y-2"}>
        {items.map((snippet, index) => (
          <Item
            key={snippet.id}
            snippet={snippet}
            grid={grid}
            sortable={sortable}
            canManage={canManage}
            // Dónde cae: antes si viene de más abajo, después si viene de más arriba.
            dropSide={activeIndex < 0 || activeIndex === index ? null : activeIndex > index ? "before" : "after"}
            onEdit={() => onEdit(snippet)}
            onRemove={() => onRemove(snippet)}
          />
        ))}
      </ul>
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }}>
        {active ? (
          <div className="h-full cursor-grabbing overflow-hidden rounded-lg border bg-card p-3 shadow-2xl ring-2 ring-brand-navy/40">
            <div className="flex items-center gap-2">
              <GripVertical className="-ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{active.name}</p>
            </div>
            <Body snippet={active} grid={grid} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Item({
  snippet,
  grid,
  sortable,
  canManage,
  dropSide,
  onEdit,
  onRemove,
}: {
  snippet: SnippetView;
  grid: boolean;
  sortable: boolean;
  canManage: boolean;
  dropSide: "before" | "after" | null;
  onEdit: () => void;
  onRemove: () => void;
}) {
  // La tarjeta entera es lo que se arrastra y donde se suelta (así se mide su tamaño real); la manija solo la levanta.
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({ id: snippet.id, disabled: !sortable });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: snippet.id, disabled: !sortable });
  const setRef = useCallback(
    (node: HTMLLIElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  const marker = isOver && dropSide;
  return (
    <li ref={setRef} className={`relative min-w-0 rounded-lg border bg-card p-3 shadow-sm transition-opacity ${isDragging ? "opacity-40" : ""}`}>
      {marker && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full bg-brand-navy ${
            grid
              ? `inset-y-1 w-1 ${marker === "before" ? "-left-2" : "-right-2"}`
              : `inset-x-1 h-1 ${marker === "before" ? "-top-1.5" : "-bottom-1.5"}`
          }`}
        />
      )}
      {/* Renglón del nombre (manija, nombre, lápiz y bote); el texto va abajo a todo lo ancho. */}
      <div className="flex items-center gap-2">
        {sortable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...listeners}
            {...attributes}
            aria-label={`Arrastrar ${snippet.name} para cambiar el orden`}
            title="Arrastra para cambiar el orden"
            className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{snippet.name}</p>
        {canManage && (
          <div className="-my-1 flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar ${snippet.name}`}
              title="Editar"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Borrar ${snippet.name}`}
              title="Borrar"
              className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <Body snippet={snippet} grid={grid} />
    </li>
  );
}

function Body({ snippet, grid }: { snippet: SnippetView; grid: boolean }) {
  return (
    <>
      <p className={`mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90 ${grid ? "line-clamp-6" : ""}`}>
        <HighlightBody body={snippet.body} tokenClassName={TOKEN_CLASS} />
      </p>
      {snippet.variables.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {snippet.variables.map((v) => (
            <span key={v} className={TOKEN_CLASS}>{`{{${v}}}`}</span>
          ))}
        </div>
      )}
    </>
  );
}
