"use client";

// Editor grande del Goal (instrucciones del agente), editable ahí mismo como en GHL:
// deshacer, contador de palabras, tokens aproximados y «Copiar» todo el texto. Sin
// "Valores personalizados" desde el 28-sep-2026 (el dueño lo pidió: el Goal escribe
// "Angela" y "Diluvium" tal cual; un {{…}} escrito a mano lo sigue sustituyendo el
// runtime, lib/agente-ia/editor.ts). «Guardar Goal» y «Descartar cambios» piden
// confirmación arriba (regla del dueño, 27-sep-2026; use-confirm.tsx). Al guardar queda
// una versión (se puede nombrar con el lápiz). Avisa hacia arriba si hay cambios sin
// guardar (punto naranja en la subpestaña). Sin lógica de datos: solo llama a las
// Server Actions del editor.
import { useEffect, useRef, useState } from "react";
import { restoreAgentGoal, saveAgentGoal } from "@/lib/actions/agente-ia-editor";
import { approxTokens, countWords } from "@/lib/agente-ia/editor";
import type { VersionView } from "@/lib/agente-ia/types";
import { CopyButton } from "@/components/ui/copy-button";
import { useConfirm } from "./use-confirm";
import { VersionsList } from "./versions-list";

const HISTORY_LIMIT = 100;
const HISTORY_IDLE_MS = 800;

export function GoalEditor({
  goal,
  versions,
  onDirtyChange,
}: {
  goal: string;
  versions: VersionView[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(goal);
  const [saved, setSaved] = useState(goal);
  const [history, setHistory] = useState<string[]>([]);
  const lastPush = useRef(-Infinity);
  const confirm = useConfirm();

  // Al restaurar una versión, el servidor manda otro Goal: se toma como el guardado.
  useEffect(() => {
    const t = setTimeout(() => {
      setText(goal);
      setSaved(goal);
      setHistory([]);
    }, 0);
    return () => clearTimeout(t);
  }, [goal]);

  const dirty = text !== saved;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Un punto de "deshacer" por ráfaga de escritura (`at` = hora del evento) o por
  // cada cambio de un golpe (sin `at`: descartar).
  function remember(previous: string, at?: number) {
    if (at !== undefined && at - lastPush.current < HISTORY_IDLE_MS) return;
    if (at !== undefined) lastPush.current = at;
    setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), previous]);
  }

  function edit(next: string, at: number) {
    remember(text, at);
    setText(next);
  }

  function undo() {
    if (history.length === 0) return;
    setText(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    lastPush.current = -Infinity;
  }

  function save() {
    const goalToSave = text;
    confirm.ask({
      title: "¿Guardar las instrucciones del agente?",
      body: "El agente las sigue desde el siguiente mensaje. Queda una versión que puedes nombrar con el lápiz.",
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: "Listo: Goal guardado (quedó una versión)",
      run: () => saveAgentGoal({ goal: goalToSave }),
      onDone: () => setSaved(goalToSave),
    });
  }

  function discard() {
    confirm.ask({
      title: "¿Descartar los cambios del Goal?",
      body: "El editor regresa a lo último guardado. Si te arrepientes, «↶ Deshacer» trae de vuelta lo que escribiste.",
      confirmLabel: "Sí, descartar",
      done: "Listo: se descartaron los cambios",
      run: async () => ({ ok: true }),
      onDone: () => {
        remember(text);
        lastPush.current = -Infinity;
        setText(saved);
      },
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="rounded border border-black/15 px-2 py-1 text-xs text-foreground hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
        >
          ↶ Deshacer
        </button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {countWords(text).toLocaleString("es-MX")} palabras · ≈ {approxTokens(text).toLocaleString("es-MX")} tokens
        </span>
      </div>
      {/* «Copiar» en la esquina de arriba a la derecha del texto (pedido del dueño,
          28-sep-2026): copia lo que se ve en el editor, con los cambios sin guardar.
          pr-24: ningún renglón queda debajo del botón. */}
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => edit(e.target.value, e.timeStamp)}
          spellCheck={false}
          aria-label="Instrucciones del agente (Goal)"
          className="block min-h-[28rem] w-full resize-y rounded-md border border-black/15 bg-background p-3 pr-24 font-mono text-[13px] leading-relaxed text-foreground dark:border-white/15"
        />
        <CopyButton getText={() => text} title="Copiar todas las instrucciones" className="absolute top-2 right-2" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || confirm.pending}
          className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {confirm.pending ? "Guardando…" : "Guardar Goal"}
        </button>
        {dirty && !confirm.pending && (
          <button type="button" onClick={discard} className="text-xs text-muted-foreground hover:underline">
            Descartar cambios
          </button>
        )}
        {dirty && !confirm.pending && <span className="text-xs text-muted-foreground">Cambios sin guardar.</span>}
        {confirm.error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</span>}
      </div>
      <VersionsList
        versions={versions}
        onRestore={(versionId) => restoreAgentGoal({ versionId })}
        restoreWarning={dirty ? "Los cambios sin guardar del editor se reemplazan por la versión restaurada." : null}
      />
      {confirm.ui}
    </div>
  );
}
