"use client";

// Subpestaña «Seguimientos» de la pestaña Agente IA (Parte 4, aprobada por el dueño el 6-oct-2026): la
// tabla de casos de los seguimientos y el horario de los vendedores. Como en Opciones, todo edita un
// BORRADOR; con cambios aparecen «Guardar cambios» (naranja) y «Descartar», y «Guardar cambios» confirma
// arriba con la lista de cambios. Cada guardado queda en Agente IA › Historial. Lo fijo (7:00–21:00,
// plantillas hasta las 19:00, 7 días entre plantillas) solo se muestra. Sin lógica de datos: las reglas
// viven en lib/followups/tabla.ts y el guardado en la Server Action.
import { useEffect, useState } from "react";
import { saveFollowUpTableAction, type FollowUpTableLastChange } from "@/lib/actions/agente-ia-seguimientos";
import { CASE_RULES } from "@/lib/followups/cases";
import { EDITABLE_CASES, MAX_BUSCA, MAX_STEPS, tableChanges, tableFromInput, tableProblems, WEEKDAY_LABEL, WEEKDAYS, type EditableCase, type FollowUpTableInput } from "@/lib/followups/tabla";
import { returnLabel } from "@/lib/agente-ia/pause";
import { useConfirm } from "./use-confirm";

const STEP_HELP = ["antes de que cierre su ventana de 24 h", "día 2", "día 9"] as const;
const FIRST_STEP_NOTE: Partial<Record<EditableCase, string>> = {
  asesor_sin_respuesta: "El 1.er mensaje sale 2 h después; la hora es para los demás.",
  pidio_fecha: "El 1.er mensaje sale a la hora que pidió el cliente; la hora es para los demás (o si solo dijo el día y no hay otro pendiente).",
};
const timeClass = "w-32 rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground disabled:opacity-60 dark:border-white/15";

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-brand-navy" : "bg-black/20 dark:bg-white/25"}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const clone = (t: FollowUpTableInput): FollowUpTableInput => JSON.parse(JSON.stringify(t)) as FollowUpTableInput;

export function FollowUpRulesSection({
  table: initial,
  lastChange: initialChange,
  onDirtyChange,
}: {
  table: FollowUpTableInput;
  lastChange: FollowUpTableLastChange | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<FollowUpTableInput>(initial);
  const [draft, setDraft] = useState<FollowUpTableInput>(() => clone(initial));
  const [lastChange, setLastChange] = useState<FollowUpTableLastChange | null>(initialChange);
  const confirm = useConfirm();
  const busy = confirm.pending;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = tableProblems(draft);
  const valid = Object.keys(problems).length === 0;
  const changes = valid && dirty ? tableChanges(tableFromInput(saved), tableFromInput(draft)) : [];
  const changedCases = new Set(changes.map((c) => c.title.split(" · ")[0]));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function setCase(caso: EditableCase, patch: Partial<FollowUpTableInput["casos"][EditableCase]>) {
    setDraft((d) => ({ ...d, casos: { ...d.casos, [caso]: { ...d.casos[caso], ...patch } } }));
    confirm.clearError();
  }
  function setDay(day: number, value: { from: string; to: string } | null) {
    setDraft((d) => ({ ...d, vendedores: { ...d.vendedores, [String(day)]: value } }));
    confirm.clearError();
  }

  function save() {
    if (!valid || changes.length === 0) return;
    const sent = clone(draft);
    const lines = changes.map((c) => `${c.title}: ${c.before ?? "—"} → ${c.after ?? "—"}`);
    confirm.ask({
      title: lines.length === 1 ? "¿Guardar este cambio en los seguimientos?" : `¿Guardar estos ${lines.length} cambios en los seguimientos?`,
      body: (
        <>
          <ul className="my-1 flex list-disc flex-col gap-0.5 pl-4 text-foreground">
            {lines.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ul>
          Aplican en menos de un minuto. Lo que ya está programado conserva su hora; si su caso o su intento quedó apagado, al llegar se cancela o pasa al siguiente.
        </>
      ),
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: lines.length === 1 ? "Listo: se guardó 1 cambio" : `Listo: se guardaron ${lines.length} cambios`,
      run: () => saveFollowUpTableAction(sent),
      onDone: (r) => {
        setSaved(r.table);
        setDraft(clone(r.table));
        setLastChange(r.lastChange);
      },
    });
  }

  function discard() {
    confirm.ask({
      title: "¿Descartar los cambios de los seguimientos?",
      body: "Todo regresa a lo guardado; no se guarda nada.",
      confirmLabel: "Sí, descartar",
      done: "Listo: se descartaron los cambios",
      run: async () => ({ ok: true }),
      onDone: () => setDraft(clone(saved)),
    });
  }

  const problem = (key: string) => problems[key] && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{problems[key]}</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-dashed border-black/20 px-3 py-2 text-xs text-foreground/70 dark:border-white/20">
        Fijo: de 7:00 a 21:00 hora del cliente · plantillas hasta las 19:00 · 7 días entre plantillas · «No seguir» nunca sale.
      </p>

      <ul className="flex flex-col gap-2">
        {EDITABLE_CASES.map((caso) => {
          const c = draft.casos[caso];
          const label = CASE_RULES[caso].label;
          return (
            <li key={caso} className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Switch on={c.on} label={`${c.on ? "Apagar" : "Encender"} «${label}»`} disabled={busy} onChange={(on) => setCase(caso, { on })} />
                <span className={`min-w-44 text-sm font-medium ${c.on ? "text-foreground" : "text-foreground/50"}`}>
                  {label}
                  {changedCases.has(label) && (
                    <>
                      <span aria-hidden="true" className="ml-1.5 inline-block size-1.5 rounded-full bg-brand-orange align-middle" />
                      <span className="sr-only"> (cambiado)</span>
                    </>
                  )}
                </span>
                <span role="group" aria-label={`Intentos de «${label}»`} className="flex gap-1">
                  {Array.from({ length: MAX_STEPS }, (_, k) => {
                    const on = c.intentos[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        disabled={busy || !c.on}
                        title={`${k + 1}.º intento: ${STEP_HELP[k]}`}
                        onClick={() => {
                          const intentos = [...c.intentos] as [boolean, boolean, boolean];
                          intentos[k] = !on;
                          setCase(caso, { intentos });
                        }}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                          on ? "border-brand-navy bg-brand-navy text-white" : "border-black/20 text-foreground/60 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
                        }`}
                      >
                        {k + 1}.º
                      </button>
                    );
                  })}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-foreground/70 sm:ml-auto">
                  de
                  <input type="time" step={300} value={c.from} aria-label={`«${label}»: desde (hora del cliente)`} disabled={busy || !c.on} onChange={(e) => setCase(caso, { from: e.target.value })} className={timeClass} />
                  a
                  <input type="time" step={300} value={c.to} aria-label={`«${label}»: hasta (hora del cliente)`} disabled={busy || !c.on} onChange={(e) => setCase(caso, { to: e.target.value })} className={timeClass} />
                </span>
              </div>
              {FIRST_STEP_NOTE[caso] && <p className="text-xs text-foreground/60">{FIRST_STEP_NOTE[caso]}</p>}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-foreground/70">Qué busca (lo lee el Agente IA)</span>
                <textarea
                  value={c.busca}
                  // Crece con el texto (unas 100 letras por renglón), de 2 a 5 renglones.
                  rows={Math.min(5, Math.max(2, Math.ceil(c.busca.length / 100)))}
                  maxLength={MAX_BUSCA}
                  disabled={busy || !c.on}
                  onChange={(e) => setCase(caso, { busca: e.target.value })}
                  className="w-full resize-y rounded border border-black/15 bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60 dark:border-white/15"
                />
              </label>
              {problem(`${caso}.from`)}
              {problem(`${caso}.to`)}
              {problem(`${caso}.intentos`)}
              {problem(`${caso}.busca`)}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-foreground/60">
        Intentos: 1.º antes de que cierre su ventana de 24 h (mensaje del Agente IA) · 2.º día 2 · 3.º día 9. Apagado = el Agente IA reconoce el caso, pero no le escribe. La hora
        es la del cliente (según su lada).
      </p>

      <section className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium text-foreground">Horario de los vendedores</h3>
          <p className="text-xs text-foreground/70">
            Hora de Mazatlán. En un chat con el Agente IA en pausa a mano, el seguimiento no sale solo: se le presenta al vendedor a su hora o, si cae fuera de este horario, en su última
            hora de trabajo antes.
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {WEEKDAYS.map((day) => {
            const shift = draft.vendedores[String(day)] ?? null;
            const name = WEEKDAY_LABEL[day];
            return (
              <li key={day} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch on={shift !== null} label={`${name}: trabaja`} disabled={busy} onChange={(on) => setDay(day, on ? { from: "09:00", to: "18:00" } : null)} />
                  <span className="w-9 text-sm text-foreground">{name}</span>
                  {shift ? (
                    <span className="flex items-center gap-1.5 text-xs text-foreground/70">
                      <input type="time" step={300} value={shift.from} aria-label={`${name}: entrada`} disabled={busy} onChange={(e) => setDay(day, { ...shift, from: e.target.value })} className={timeClass} />
                      a
                      <input type="time" step={300} value={shift.to} aria-label={`${name}: salida`} disabled={busy} onChange={(e) => setDay(day, { ...shift, to: e.target.value })} className={timeClass} />
                    </span>
                  ) : (
                    <span className="text-xs text-foreground/60">no trabaja</span>
                  )}
                </div>
                {problem(`${day}.to`)}
                {problem(`${day}.from`)}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Guardar: solo con cambios; fijo abajo mientras la sección está a la vista. */}
      {dirty && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-md border border-brand-orange/50 bg-background p-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!valid || changes.length === 0 || busy} className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
            <button type="button" onClick={discard} disabled={busy} className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
              Descartar
            </button>
            <span className="text-xs text-foreground/70" aria-live="polite">
              {!valid
                ? "Corrige lo marcado para poder guardar."
                : changes.length === 1
                  ? "1 cambio sin guardar."
                  : changes.length > 1
                    ? `${changes.length} cambios sin guardar.`
                    : "Cambios sin guardar."}
            </span>
          </div>
        </div>
      )}

      {confirm.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</p>}
      <p className="text-xs text-foreground/60">
        {lastChange
          ? `Último cambio: ${lastChange.author?.trim() || "alguien"}, ${returnLabel(new Date(lastChange.at), new Date())}. Cada cambio queda en Historial.`
          : "Sin cambios todavía: todo está en los valores de fábrica."}
      </p>
      {confirm.ui}
    </div>
  );
}
