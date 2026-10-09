"use client";

// Editor grande del Goal (instrucciones del agente), editable ahí mismo como en GHL:
// deshacer, contador de palabras, tokens aproximados y «Copiar» todo el texto. Sin
// "Valores personalizados" desde el 28-sep-2026 (el dueño lo pidió: el Goal escribe
// "Angela" y "Diluvium" tal cual; un {{…}} escrito a mano lo sigue sustituyendo el
// runtime, lib/agente-ia/editor.ts). «Guardar Goal» y «Descartar cambios» piden
// confirmación arriba (regla del dueño, 27-sep-2026; use-confirm.tsx). Al guardar queda
// una versión (se puede nombrar con el lápiz). Avisa hacia arriba si hay cambios sin
// guardar (punto naranja en la subpestaña). «Programar para las 22:00» (9-oct-2026, regla del
// dueño): por defecto el Goal se programa y el worker lo aplica a las 22:00 junto con las FAQs
// (schedule-controls.tsx); «Ahora» queda para un error grave. Sin lógica de datos: solo llama
// a las Server Actions del editor.
import { useEffect, useRef, useState } from "react";
import { restoreAgentGoal, saveAgentGoal, scheduleAgentGoal, scheduleAgentVersion } from "@/lib/actions/agente-ia-editor";
import { approxTokens, countWords } from "@/lib/agente-ia/editor";
import type { VersionView } from "@/lib/agente-ia/types";
import { CopyButton } from "@/components/ui/copy-button";
import { useConfirm } from "./use-confirm";
import { VersionsList } from "./versions-list";
import { ApplyModeToggle, whenText, type ApplyMode } from "./schedule-controls";

const HISTORY_LIMIT = 100;
const HISTORY_IDLE_MS = 800;

export function GoalEditor({
  goal,
  scheduledGoal,
  versions,
  onDirtyChange,
}: {
  goal: string;
  // El Goal programado para las 22:00 (null = no hay).
  scheduledGoal: string | null;
  versions: VersionView[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // «Hoy a las 22:00» parte de lo programado (o del Goal en vivo); «Ahora», del Goal en vivo.
  const [mode, setMode] = useState<ApplyMode>("programar");
  const baseFor = (m: ApplyMode) => (m === "programar" ? (scheduledGoal ?? goal) : goal);
  const [text, setText] = useState(() => baseFor("programar"));
  const [saved, setSaved] = useState(() => baseFor("programar"));
  const [history, setHistory] = useState<string[]>([]);
  const lastPush = useRef(-Infinity);
  const modeRef = useRef<ApplyMode>("programar");
  const confirm = useConfirm();

  // Al restaurar o programar, el servidor manda otro Goal: se toma como el guardado.
  useEffect(() => {
    const t = setTimeout(() => {
      const base = modeRef.current === "programar" ? (scheduledGoal ?? goal) : goal;
      setText(base);
      setSaved(base);
      setHistory([]);
    }, 0);
    return () => clearTimeout(t);
  }, [goal, scheduledGoal]);

  // Cambiar de modo: si no había cambios, el editor pasa al texto de ese modo; si los había, se quedan.
  function changeMode(m: ApplyMode) {
    const base = baseFor(m);
    if (text === saved) setText(base);
    setSaved(base);
    modeRef.current = m;
    setMode(m);
  }

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
    if (mode === "programar") {
      confirm.ask({
        title: "¿Programar las instrucciones del agente?",
        body: `Se aplican ${whenText()}, junto con los demás cambios programados. Mientras, el Agente IA sigue con el Goal actual.`,
        confirmLabel: "Sí, programar",
        pendingLabel: "Programando…",
        done: "Listo: Goal programado",
        run: () => scheduleAgentGoal({ goal: goalToSave }),
        onDone: () => setSaved(goalToSave),
      });
      return;
    }
    confirm.ask({
      title: "¿Guardar ahora las instrucciones del agente?",
      body: "Solo para un error grave: el agente las sigue desde el siguiente mensaje y se vuelve a cobrar el Goal completo (~US$0.09). Lo normal es programarlas para las 22:00. Queda una versión que puedes nombrar con el lápiz.",
      confirmLabel: "Sí, guardar ahora",
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
      <ApplyModeToggle mode={mode} onChange={changeMode} disabled={confirm.pending} />
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
          {confirm.pending ? (mode === "programar" ? "Programando…" : "Guardando…") : mode === "programar" ? "Programar para las 22:00" : "Guardar ahora"}
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
        onRestore={(versionId) => (mode === "programar" ? scheduleAgentVersion({ kind: "goal", versionId }) : restoreAgentGoal({ versionId }))}
        schedule={mode === "programar"}
        restoreWarning={dirty ? "Los cambios sin guardar del editor se reemplazan por la versión restaurada." : null}
      />
      {confirm.ui}
    </div>
  );
}
