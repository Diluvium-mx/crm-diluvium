"use client";

// Editor de las columnas del Embudo (Columnas del Embudo, 26-sep-2026): una tabla
// simple con nombre, color, orden (arrastrar o flechas), papel, modelo del agente y
// regla del bot, más agregar y borrar (con pop-up para pasar los contactos a otra
// columna). Vive en la subpestaña "Etapas" de Agente IA y en el lápiz del encabezado
// del Embudo (mismo componente en un pop-up). Lo editan vendedores, admin y owner.
// Regla del dueño (27-sep-2026, como toda la pestaña Agente IA): NADA se guarda con un
// solo clic; cada cambio pide confirmación en el pop-up de arriba (use-confirm.tsx).
// Nombre, color y regla se editan como borrador por fila y se guardan con «Guardar».
// Las demás sesiones se enteran por el SSE (stages.updated). Sin lógica de datos.
import { useEffect, useRef, useState, useTransition } from "react";
import { DndContext, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { createStage, deleteStage, getContactCountsByStage, reorderStages, setStageRole, updateStage } from "@/lib/actions/funnel-stages";
import { MAX_STAGES, MAX_STAGE_NAME, MAX_STAGE_RULE, MIN_STAGES, STAGE_ROLE_HINTS, STAGE_ROLE_LABELS, STAGE_ROLES, type FunnelStage, type StageRole } from "@/lib/contacts/stages";
import { useConfirm } from "../agente-ia/_components/use-confirm";
import { useFunnelStages } from "./funnel-stages-provider";

const input = "w-full rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground dark:border-white/15";

type Draft = { name: string; color: string; rule: string };
const draftOf = (s: FunnelStage): Draft => ({ name: s.name, color: s.color.toUpperCase(), rule: s.botRule });
const sameDraft = (a: Draft, b: Draft) => a.name.trim() === b.name.trim() && a.color.toUpperCase() === b.color.toUpperCase() && a.rule.trim() === b.rule.trim();

function StageRow({
  stage,
  index,
  total,
  busy,
  error,
  model1Label,
  model2Label,
  onDirty,
  onSave,
  onSlot,
  onRole,
  onMove,
  onDelete,
}: {
  stage: FunnelStage;
  index: number;
  total: number;
  busy: boolean;
  error: string | null;
  model1Label: string;
  model2Label: string;
  onDirty: (id: string, dirty: boolean) => void;
  onSave: (draft: Draft, reset: () => void) => void;
  onSlot: (slot: 1 | 2) => void;
  onRole: (role: StageRole) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(stage));
  // Si la etapa cambia desde fuera (otra sesión, SSE), el borrador sin tocar se pone al día.
  const [seen, setSeen] = useState(stage);
  if (seen !== stage) {
    setSeen(stage);
    if (sameDraft(draft, draftOf(seen))) setDraft(draftOf(stage));
  }
  const dirty = !sameDraft(draft, draftOf(stage));
  useEffect(() => {
    onDirty(stage.id, dirty);
  }, [dirty, stage.id, onDirty]);
  useEffect(() => () => onDirty(stage.id, false), [stage.id, onDirty]);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: stage.id, disabled: busy });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: stage.id });
  const save = () => onSave(draft, () => setDraft(draftOf(stage)));
  return (
    <li
      ref={setDropRef}
      className={`grid grid-cols-[auto_auto_1fr_auto] items-start gap-x-2 gap-y-1 border-b border-black/5 px-2 py-2 last:border-b-0 dark:border-white/5 ${isOver ? "bg-brand-navy/5" : ""} ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex flex-col items-center gap-0.5 pt-1">
        <button
          ref={setDragRef}
          type="button"
          {...listeners}
          {...attributes}
          aria-label={`Arrastrar ${stage.name} para reordenar`}
          title="Arrastra para reordenar"
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button type="button" disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label={`Subir ${stage.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
          <ArrowUp className="size-3.5" />
        </button>
        <button type="button" disabled={busy || index === total - 1} onClick={() => onMove(1)} aria-label={`Bajar ${stage.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
          <ArrowDown className="size-3.5" />
        </button>
      </div>
      <label className="pt-1" title="Color de la columna">
        <span className="sr-only">Color de {stage.name}</span>
        <input type="color" value={draft.color} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value.toUpperCase() }))} className="size-7 cursor-pointer rounded border border-black/15 bg-transparent p-0 dark:border-white/15" />
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
          <input
            value={draft.name}
            maxLength={MAX_STAGE_NAME}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) save();
              if (e.key === "Escape") setDraft(draftOf(stage));
            }}
            aria-label="Nombre de la etapa"
            className={`${input} max-w-56 font-medium`}
          />
          <select
            value={stage.role ?? ""}
            disabled={busy}
            onChange={(e) => e.target.value && onRole(e.target.value as StageRole)}
            aria-label={`Papel de ${stage.name}`}
            title={stage.role ? STAGE_ROLE_HINTS[stage.role] : "Papel fijo que usa el CRM (cada uno en una sola etapa)"}
            className={`${input} w-auto`}
          >
            <option value="">Sin papel</option>
            {STAGE_ROLES.map((r) => (
              <option key={r} value={r}>
                {STAGE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <div role="radiogroup" aria-label={`Modelo del agente para ${stage.name}`} className="flex overflow-hidden rounded border border-black/15 text-xs dark:border-white/15">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stage.modelSlot === n}
                onClick={() => stage.modelSlot !== n && onSlot(n)}
                title={n === 1 ? model1Label : model2Label}
                aria-label={`Modelo ${n} (${n === 1 ? model1Label : model2Label})`}
                className={`px-2.5 py-1 transition-colors ${stage.modelSlot === n ? "bg-brand-navy text-white" : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"}`}
              >
                Modelo {n}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={draft.rule}
          maxLength={MAX_STAGE_RULE}
          disabled={busy}
          rows={draft.rule.length > 90 ? 2 : 1}
          onChange={(e) => setDraft((d) => ({ ...d, rule: e.target.value }))}
          aria-label={`Regla del bot para ${stage.name}`}
          placeholder={stage.role === "entrada" ? "Aquí llegan los contactos nuevos (sin regla)." : "Cuándo debe mover el agente al contacto aquí (p. ej. «Cuando pregunta precio o da medidas»)."}
          className={`${input} resize-y text-xs`}
        />
        {dirty && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={save} className="rounded bg-brand-orange px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
              Guardar
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(draftOf(stage))} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
              Deshacer
            </button>
          </div>
        )}
        {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
      </div>
      <button
        type="button"
        disabled={busy || Boolean(stage.role) || total <= MIN_STAGES}
        onClick={onDelete}
        aria-label={`Borrar ${stage.name}`}
        title={stage.role ? `Tiene el papel "${STAGE_ROLE_LABELS[stage.role]}": pásalo a otra etapa antes de borrarla` : total <= MIN_STAGES ? `El Embudo necesita al menos ${MIN_STAGES} etapas` : "Borrar (pasa sus contactos a otra columna)"}
        className="mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand-orange disabled:opacity-30"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

// Borrar = pop-up propio: pide a qué columna pasan sus contactos (con cuántos tiene cada una).
function DeleteDialog({ stage, others, onClose, onConfirm }: { stage: FunnelStage; others: FunnelStage[]; onClose: () => void; onConfirm: (moveToId: string) => Promise<void> }) {
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    getContactCountsByStage()
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setCounts({}));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);
  const n = counts?.[stage.key];
  const targetName = others.find((s) => s.id === target)?.name ?? "";
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="borrar-etapa-titulo" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-background p-4 shadow-xl">
        <h3 id="borrar-etapa-titulo" className="text-sm font-semibold text-foreground">{`¿Borrar la columna «${stage.name}»?`}</h3>
        <p className="mt-1 text-xs text-foreground/80">
          {counts === null ? "Contando sus contactos…" : n ? `Tiene ${n === 1 ? "1 contacto" : `${n} contactos`}. Elige a qué columna pasan; se mueven todos de una vez.` : "No tiene contactos."}
        </p>
        <label className="mt-3 block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Pasar sus contactos a</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={input} autoFocus>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {counts?.[s.key] ? ` (${counts[s.key]})` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-foreground/70">El agente deja de ver esta etapa desde su siguiente respuesta. Los workflows que se disparaban al entrar a ella quedan sin etapa.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/15">
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !target || counts === null}
            onClick={() => start(async () => onConfirm(target))}
            className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Borrando…" : n ? `Pasar ${n} a ${targetName} y borrar` : "Sí, borrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StagesEditor({
  model1Label = "Modelo 1",
  model2Label = "Modelo 2",
  onDirtyChange,
}: {
  model1Label?: string;
  model2Label?: string;
  /** Hay nombres, colores o reglas sin guardar (punto naranja en la subpestaña). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { stages, apply } = useFunnelStages();
  const confirm = useConfirm();
  const busy = confirm.pending;
  const [deleting, setDeleting] = useState<FunnelStage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [afterId, setAfterId] = useState<string>("");
  const newNameRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  // Filas con borrador sin guardar.
  const [dirtyRows, setDirtyRows] = useState<ReadonlySet<string>>(new Set());
  const onRowDirty = useRef((id: string, dirty: boolean) => {
    setDirtyRows((cur) => {
      if (cur.has(id) === dirty) return cur;
      const next = new Set(cur);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }).current;
  useEffect(() => {
    onDirtyChange?.(dirtyRows.size > 0 || newName.trim() !== "");
  }, [dirtyRows, newName, onDirtyChange]);

  const name = (s: FunnelStage) => `«${s.name}»`;
  const slotLabel = (n: 1 | 2) => `Modelo ${n} (${n === 1 ? model1Label : model2Label})`;

  function saveRow(stage: FunnelStage, draft: Draft, reset: () => void) {
    const patch: { id: string; name?: string; color?: string; botRule?: string } = { id: stage.id };
    const changes: string[] = [];
    if (draft.name.trim() !== stage.name) {
      if (!draft.name.trim()) {
        confirm.fail("El nombre de la etapa no puede quedar vacío.", stage.id);
        return;
      }
      patch.name = draft.name;
      changes.push(`el nombre a «${draft.name.trim()}»`);
    }
    if (draft.color.toUpperCase() !== stage.color.toUpperCase()) {
      patch.color = draft.color;
      changes.push("el color");
    }
    if (draft.rule.trim() !== stage.botRule) {
      patch.botRule = draft.rule;
      changes.push(draft.rule.trim() ? "la regla del bot" : "la regla del bot (queda vacía: el agente no moverá aquí por su cuenta)");
    }
    if (!changes.length) {
      reset();
      return;
    }
    confirm.ask({
      title: `¿Cambiar ${changes.join(", ")} de ${name(stage)}?`,
      body: patch.name ? "La clave interna no cambia: sus contactos, sus workflows y el agente la siguen reconociendo. Las demás pantallas abiertas lo ven al momento." : "El agente usa la etapa así desde su siguiente respuesta.",
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: `Listo: ${name({ ...stage, name: draft.name.trim() || stage.name })} guardada`,
      scope: stage.id,
      run: () => updateStage(patch),
      onDone: (r) => apply(r.stages),
    });
  }

  function reorder(stage: FunnelStage, toIndex: number) {
    const ids = stages.map((s) => s.id);
    const from = ids.indexOf(stage.id);
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return;
    ids.splice(toIndex, 0, ids.splice(from, 1)[0]);
    confirm.ask({
      title: `¿Mover ${name(stage)} al lugar ${toIndex + 1}?`,
      body: "El agente solo avanza hacia adelante según este orden, desde su siguiente respuesta. Los contactos no cambian de columna.",
      confirmLabel: "Sí, mover",
      pendingLabel: "Moviendo…",
      done: `Listo: ${name(stage)} quedó en el lugar ${toIndex + 1}`,
      run: () => reorderStages({ orderedIds: ids }),
      onDone: (r) => apply(r.stages),
    });
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.over.id === e.active.id) return;
    const stage = stages.find((s) => s.id === String(e.active.id));
    if (stage) reorder(stage, stages.findIndex((s) => s.id === String(e.over!.id)));
  }

  function setSlot(stage: FunnelStage, slot: 1 | 2) {
    confirm.ask({
      title: `¿Cambiar la etapa ${stage.name} al ${slotLabel(slot)}?`,
      body: `Desde el siguiente mensaje, los contactos en ${stage.name} los contestará el ${slotLabel(slot)} en lugar del ${slotLabel(slot === 1 ? 2 : 1)}.`,
      confirmLabel: "Sí, cambiar",
      pendingLabel: "Cambiando…",
      done: `Listo: ${stage.name} ahora la atiende el ${slotLabel(slot)}`,
      scope: stage.id,
      run: () => updateStage({ id: stage.id, modelSlot: slot }),
      onDone: (r) => apply(r.stages),
    });
  }

  function setRole(stage: FunnelStage, role: StageRole) {
    const current = stages.find((s) => s.role === role);
    if (stage.role) {
      confirm.fail(`${name(stage)} ya tiene el papel "${STAGE_ROLE_LABELS[stage.role]}"; pásalo primero a otra etapa (cada etapa tiene un solo papel).`, stage.id);
      return;
    }
    confirm.ask({
      title: `¿Pasar el papel "${STAGE_ROLE_LABELS[role]}" a ${name(stage)}?`,
      body: `${STAGE_ROLE_HINTS[role]} ${current ? `${name(current)} deja de tenerlo (sus contactos se quedan donde están).` : ""}`,
      confirmLabel: "Sí, pasar",
      pendingLabel: "Cambiando…",
      done: `Listo: "${STAGE_ROLE_LABELS[role]}" es ahora ${name(stage)}`,
      scope: stage.id,
      run: () => setStageRole({ id: stage.id, role }),
      onDone: (r) => apply(r.stages),
    });
  }

  function add() {
    const trimmed = newName.trim();
    if (!trimmed) {
      newNameRef.current?.focus();
      return;
    }
    const after = stages.find((s) => s.id === afterId);
    confirm.ask({
      title: `¿Agregar la columna «${trimmed}» ${after ? `después de ${name(after)}` : "al final"}?`,
      body: "Nace sin regla del bot y con el Modelo 2: escribe su regla para que el agente sepa cuándo mover a un contacto ahí.",
      confirmLabel: "Sí, agregar",
      pendingLabel: "Agregando…",
      done: `Listo: «${trimmed}» agregada`,
      scope: "nueva",
      run: () => createStage({ name: trimmed, afterId: afterId || null }),
      onDone: (r) => {
        apply(r.stages);
        setNewName("");
        setAfterId("");
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground/70">
        Nombre, color, orden, papel, modelo del agente y su regla (cuándo mover al contacto aquí). Cada cambio pide confirmación y el agente lo usa en su siguiente respuesta. Entre {MIN_STAGES} y {MAX_STAGES} columnas.
      </p>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <ul aria-busy={busy || undefined} aria-label="Etapas del embudo" className="rounded-md border border-black/10 dark:border-white/10">
          {stages.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              index={index}
              total={stages.length}
              busy={busy}
              error={confirm.errorFor(stage.id)}
              model1Label={model1Label}
              model2Label={model2Label}
              onDirty={onRowDirty}
              onSave={(draft, reset) => saveRow(stage, draft, reset)}
              onSlot={(slot) => setSlot(stage, slot)}
              onRole={(role) => setRole(stage, role)}
              onMove={(delta) => reorder(stage, index + delta)}
              onDelete={() => {
                setDeleteError(null);
                setDeleting(stage);
              }}
            />
          ))}
        </ul>
      </DndContext>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex-1 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Nueva columna</span>
          <input ref={newNameRef} value={newName} maxLength={MAX_STAGE_NAME} disabled={busy || stages.length >= MAX_STAGES} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la etapa" className={input} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Después de</span>
          <select value={afterId} disabled={busy || stages.length >= MAX_STAGES} onChange={(e) => setAfterId(e.target.value)} className={input}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">Al final</option>
          </select>
        </label>
        <button type="submit" disabled={busy || stages.length >= MAX_STAGES} className="flex items-center gap-1 rounded bg-brand-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="size-4" /> Agregar
        </button>
      </form>
      {stages.length >= MAX_STAGES && <p className="text-xs text-muted-foreground">Ya tienes el máximo de {MAX_STAGES} columnas.</p>}
      {(confirm.errorFor("nueva") ?? (confirm.error && !stages.some((s) => confirm.errorFor(s.id)) ? confirm.error : null) ?? deleteError) && (
        <p role="alert" className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">
          {confirm.errorFor("nueva") ?? deleteError ?? confirm.error}
        </p>
      )}
      {deleting && (
        <DeleteDialog
          stage={deleting}
          others={stages.filter((s) => s.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onConfirm={async (moveToId) => {
            try {
              const r = await deleteStage({ id: deleting.id, moveToId });
              if (r.ok) apply(r.stages);
              else setDeleteError(r.message);
            } catch {
              setDeleteError("No se pudo borrar; revisa tu conexión e inténtalo de nuevo.");
            }
            setDeleting(null);
          }}
        />
      )}
      {confirm.ui}
    </div>
  );
}
