"use client";

// Editor grande del Goal (instrucciones del agente), editable ahí mismo como en GHL:
// deshacer, contador de palabras, tokens aproximados y "Valores personalizados"
// (se insertan donde está el cursor). Al guardar queda una versión. Sin lógica de
// datos: solo llama a las Server Actions del editor.
import { useEffect, useRef, useState, useTransition } from "react";
import { restoreAgentGoal, saveAgentGoal } from "@/lib/actions/agente-ia-editor";
import { approxTokens, countWords, CUSTOM_VALUES } from "@/lib/agente-ia/editor";
import type { VersionView } from "@/lib/agente-ia/types";
import { VersionsList } from "./versions-list";

const HISTORY_LIMIT = 100;
const HISTORY_IDLE_MS = 800;

export function GoalEditor({ goal, versions }: { goal: string; versions: VersionView[] }) {
  const [text, setText] = useState(goal);
  const [saved, setSaved] = useState(goal);
  const [history, setHistory] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastPush = useRef(-Infinity);

  // Al restaurar una versión, el servidor manda otro Goal: se toma como el guardado.
  useEffect(() => {
    const t = setTimeout(() => {
      setText(goal);
      setSaved(goal);
      setHistory([]);
    }, 0);
    return () => clearTimeout(t);
  }, [goal]);

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
    setMessage(null);
    start(async () => {
      const r = await saveAgentGoal({ goal: text });
      if (r.ok) {
        setSaved(text);
        setMessage({ ok: true, text: "Goal guardado (quedó una versión)." });
      } else setMessage({ ok: false, text: r.message });
    });
  }

  const dirty = text !== saved;

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
          disabled={!dirty || pending}
          className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar Goal"}
        </button>
        {dirty && !pending && (
          <button type="button" onClick={() => setText(saved)} className="text-xs text-muted-foreground hover:underline">
            Descartar cambios
          </button>
        )}
        {message && (
          <span className={`text-xs ${message.ok ? "text-muted-foreground" : "border-l-2 border-brand-orange pl-2 text-foreground"}`}>
            {message.text}
          </span>
        )}
      </div>
      <VersionsList versions={versions} onRestore={(versionId) => restoreAgentGoal({ versionId })} />
    </div>
  );
}
