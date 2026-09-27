"use client";

// Editor grande del Goal (instrucciones del agente), editable ahí mismo como en GHL:
// deshacer, contador de palabras, tokens aproximados y "Valores personalizados"
// (se insertan donde está el cursor). «Guardar Goal» y «Descartar cambios» piden
// confirmación arriba (regla del dueño, 27-sep-2026; use-confirm.tsx). Al guardar queda
// una versión (se puede nombrar con el lápiz). Avisa hacia arriba si hay cambios sin
// guardar (punto naranja en la subpestaña). Sin lógica de datos: solo llama a las
// Server Actions del editor.
import { useEffect, useRef, useState } from "react";
import { restoreAgentGoal, saveAgentGoal } from "@/lib/actions/agente-ia-editor";
import { approxTokens, countWords, CUSTOM_VALUES } from "@/lib/agente-ia/editor";
import type { VersionView } from "@/lib/agente-ia/types";
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
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
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
  // cada inserción (sin `at`).
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

  function insert(token: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    remember(text);
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    setText(next);
    setMenu(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
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
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            className="rounded border border-black/15 px-2 py-1 text-xs text-foreground hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          >
            {"{ }"} Valores personalizados
          </button>
          {menu && (
            <ul className="absolute left-0 z-10 mt-1 w-64 rounded-md border bg-card py-1 text-xs shadow-md">
              {CUSTOM_VALUES.map((v) => (
                <li key={v.token}>
                  <button type="button" onClick={() => insert(v.token)} className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted">
                    <span className="text-foreground">{v.label}</span>
                    <code className="text-muted-foreground">{v.token}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {countWords(text).toLocaleString("es-MX")} palabras · ≈ {approxTokens(text).toLocaleString("es-MX")} tokens
        </span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => edit(e.target.value, e.timeStamp)}
        spellCheck={false}
        aria-label="Instrucciones del agente (Goal)"
        className="min-h-[28rem] w-full resize-y rounded-md border border-black/15 bg-background p-3 font-mono text-[13px] leading-relaxed text-foreground dark:border-white/15"
      />
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
