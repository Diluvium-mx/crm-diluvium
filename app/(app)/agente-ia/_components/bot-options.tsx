"use client";

// Subpestaña "Opciones" de la pestaña Agente IA (26-sep-2026): las opciones del bot
// copiadas de Ángela (GHL), cada una con una línea de ayuda y "En GHL: …". Desde el
// 27-sep-2026 (regla del dueño: nada se guarda con un solo clic) todos los controles
// editan un BORRADOR; si difiere de lo guardado aparecen «Guardar cambios» (naranja) y
// «Descartar». «Guardar cambios» confirma arriba con la lista de cambios y guarda TODO
// en una sola llamada (solo los campos cambiados). Si algo es inválido, el botón se
// deshabilita y se dice por qué. Avisa hacia arriba si hay cambios sin guardar.
// Sin lógica de datos: la regla borrador → cambios vive en lib/agente-ia/opciones-draft.ts
// y las de cada opción en lib/agente-ia/opciones.ts.
import { useEffect, useState } from "react";
import { updateBotOptions } from "@/lib/actions/agente-ia-opciones";
import {
  BOT_OPTIONS_DEFAULTS,
  DAY_LABELS,
  describeChange,
  MAX_DELAY_SECONDS,
  MAX_PAUSE_HOURS,
  MAX_REPLIES_CAP,
  MIN_DELAY_SECONDS,
  OPTION_HELP,
  OPTION_LABELS,
  RESPONSE_LENGTH_LABELS,
  RESPONSE_LENGTHS,
  type BotOptionField,
  type BotOptions,
} from "@/lib/agente-ia/opciones";
import { describePatch, draftFromOptions, draftToPatch, type OptionsDraft } from "@/lib/agente-ia/opciones-draft";
import type { OptionsChangeView } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const radioClass = (on: boolean) =>
  `px-3 py-1.5 text-sm transition-colors disabled:opacity-60 ${on ? "bg-brand-navy text-white" : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"}`;
const inputClass = "w-20 rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground dark:border-white/15";

function Radio<T extends string | number | boolean>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap overflow-hidden rounded border border-black/15 dark:border-white/15">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} onClick={() => value !== o.value && onChange(o.value)} className={radioClass(value === o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Option({ field, children, control }: { field: BotOptionField; children?: React.ReactNode; control: React.ReactNode }) {
  const help = OPTION_HELP[field];
  return (
    <div className="flex flex-col gap-2 border-b border-black/5 pb-3 last:border-0 last:pb-0 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{OPTION_LABELS[field]}</span>
        {control}
      </div>
      {children}
      <p className="text-xs text-foreground/70">
        {help.help} <span className="text-foreground/50">En GHL: {help.ghl}.</span>
      </p>
    </div>
  );
}

// Número del borrador (horas o cantidad), como texto: un valor a medio escribir no se pierde.
function NumberField({ label, value, min, max, unit, disabled, onChange }: { label: string; value: string; min: number; max: number; unit: string; disabled: boolean; onChange: (text: string) => void }) {
  return (
    <span className="flex items-center gap-1">
      <input type="number" inputMode="numeric" min={min} max={max} step={1} value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      <span className="text-xs text-foreground/70">{unit}</span>
    </span>
  );
}

export function BotOptionsSection({
  options: initial,
  lastChange: initialChange,
  onDirtyChange,
}: {
  options: BotOptions;
  lastChange: OptionsChangeView | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<BotOptions>(initial);
  const [draft, setDraft] = useState<OptionsDraft>(() => draftFromOptions(initial));
  const [lastChange, setLastChange] = useState<OptionsChangeView | null>(initialChange);
  const confirm = useConfirm();
  const busy = confirm.pending;

  const { patch, errors, dirty } = draftToPatch(saved, draft);
  const changes = describePatch(saved, patch);
  const canSave = dirty && errors.length === 0 && changes.length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function set(next: Partial<OptionsDraft>) {
    setDraft((d) => ({ ...d, ...next }));
    confirm.clearError();
  }

  function save() {
    if (!canSave) return;
    const sent = patch;
    const lines = changes;
    confirm.ask({
      title: lines.length === 1 ? "¿Guardar este cambio en las Opciones?" : `¿Guardar estos ${lines.length} cambios en las Opciones?`,
      body: (
        <>
          <ul className="my-1 flex list-disc flex-col gap-0.5 pl-4 text-foreground">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          Aplican en menos de un minuto, sin redesplegar.
        </>
      ),
      confirmLabel: "Sí, guardar",
      pendingLabel: "Guardando…",
      done: lines.length === 1 ? "Listo: se guardó 1 cambio" : `Listo: se guardaron ${lines.length} cambios`,
      run: () => updateBotOptions(sent),
      onDone: (r) => {
        setSaved(r.options);
        setLastChange(r.lastChange);
      },
    });
  }

  function discard() {
    confirm.ask({
      title: "¿Descartar los cambios de las Opciones?",
      body: "Todo regresa a lo guardado; no se guarda nada.",
      confirmLabel: "Sí, descartar",
      done: "Listo: se descartaron los cambios",
      run: async () => ({ ok: true }),
      onDone: () => setDraft(draftFromOptions(saved)),
    });
  }

  const yesNo = [
    { value: true, label: "Sí" },
    { value: false, label: "No" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Espera */}
      <Option
        field="responseDelaySeconds"
        control={
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={MIN_DELAY_SECONDS}
              max={MAX_DELAY_SECONDS}
              step={5}
              value={draft.responseDelaySeconds}
              aria-label={OPTION_LABELS.responseDelaySeconds}
              disabled={busy}
              onChange={(e) => set({ responseDelaySeconds: Number(e.target.value) })}
              className="w-40 accent-brand-navy"
            />
            <span className="w-10 text-sm tabular-nums text-foreground">{draft.responseDelaySeconds} s</span>
          </span>
        }
      />

      {/* 2. Pausa por vendedor + reactivar */}
      <Option field="pauseOnHumanReply" control={<Radio label={OPTION_LABELS.pauseOnHumanReply} value={draft.pauseOnHumanReply} options={yesNo} disabled={busy} onChange={(v) => set({ pauseOnHumanReply: v })} />} />
      {draft.pauseOnHumanReply && (
        <Option
          field="humanReplyReactivateHours"
          control={
            <span className="flex flex-wrap items-center gap-2">
              <Radio
                label={OPTION_LABELS.humanReplyReactivateHours}
                value={draft.reactivateMode}
                options={[
                  { value: "nunca", label: "Nunca (a mano con «Activar»)" },
                  { value: "8", label: "8 h" },
                  { value: "24", label: "24 h" },
                  { value: "otro", label: "Número de horas" },
                ]}
                disabled={busy}
                onChange={(m) => set({ reactivateMode: m })}
              />
              {draft.reactivateMode === "otro" && (
                <NumberField label="Horas para reactivar" value={draft.reactivateHours} min={1} max={MAX_PAUSE_HOURS} unit="h" disabled={busy} onChange={(t) => set({ reactivateHours: t })} />
              )}
            </span>
          }
        />
      )}

      {/* 3. Pedir asesor */}
      <Option
        field="handoverPauseHours"
        control={
          <span className="flex flex-wrap items-center gap-2">
            <Radio
              label={OPTION_LABELS.handoverPauseHours}
              value={draft.handoverMode}
              options={[
                { value: "avisar", label: "Avisar al vendedor y seguir contestando" },
                { value: "pausar", label: "Avisar y pausar el bot en ese chat por" },
              ]}
              disabled={busy}
              onChange={(m) => set({ handoverMode: m })}
            />
            {draft.handoverMode === "pausar" && (
              <NumberField label="Horas de pausa al pedir asesor" value={draft.handoverHours} min={1} max={MAX_PAUSE_HOURS} unit="h" disabled={busy} onChange={(t) => set({ handoverHours: t })} />
            )}
          </span>
        }
      />

      {/* 4. Horario */}
      <Option
        field="schedule"
        control={
          <Radio
            label={OPTION_LABELS.schedule}
            value={draft.scheduleMode}
            options={[
              { value: "siempre", label: "24/7" },
              { value: "horario", label: "Días y horas" },
            ]}
            disabled={busy}
            onChange={(m) => set({ scheduleMode: m })}
          />
        }
      >
        {draft.scheduleMode === "horario" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded border border-black/15 dark:border-white/15" role="group" aria-label="Días en que contesta el bot">
              {ALL_DAYS.map((d) => {
                const on = draft.schedule.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() =>
                      set({ schedule: { ...draft.schedule, days: on ? draft.schedule.days.filter((x) => x !== d) : [...draft.schedule.days, d].sort((a, b) => a - b) } })
                    }
                    className={`px-2 py-1 text-xs ${radioClass(on)}`}
                  >
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1 text-xs text-foreground/70">
              de
              <input type="time" value={draft.schedule.from} aria-label="Hora de inicio" disabled={busy} onChange={(e) => set({ schedule: { ...draft.schedule, from: e.target.value } })} className={inputClass} />
            </label>
            <label className="flex items-center gap-1 text-xs text-foreground/70">
              a
              <input type="time" value={draft.schedule.to} aria-label="Hora de fin" disabled={busy} onChange={(e) => set({ schedule: { ...draft.schedule, to: e.target.value } })} className={inputClass} />
            </label>
            <span className="text-xs text-foreground/70">hora de Mazatlán</span>
          </div>
        )}
      </Option>

      {/* 5. Imágenes y notas de voz */}
      <Option field="readImages" control={<Radio label={OPTION_LABELS.readImages} value={draft.readImages} options={yesNo} disabled={busy} onChange={(v) => set({ readImages: v })} />} />
      <Option field="transcribeAudio" control={<Radio label={OPTION_LABELS.transcribeAudio} value={draft.transcribeAudio} options={yesNo} disabled={busy} onChange={(v) => set({ transcribeAudio: v })} />} />

      {/* 6. Longitud y mensajes */}
      <Option
        field="responseLength"
        control={<Radio label={OPTION_LABELS.responseLength} value={draft.responseLength} options={RESPONSE_LENGTHS.map((l) => ({ value: l, label: RESPONSE_LENGTH_LABELS[l] }))} disabled={busy} onChange={(v) => set({ responseLength: v })} />}
      />
      <Option
        field="maxBubbles"
        control={
          <Radio
            label={OPTION_LABELS.maxBubbles}
            value={draft.maxBubbles}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
            ]}
            disabled={busy}
            onChange={(v) => set({ maxBubbles: v })}
          />
        }
      />

      {/* 7. Tope de respuestas */}
      <Option
        field="maxRepliesPerContact"
        control={
          <span className="flex flex-wrap items-center gap-2">
            <Radio
              label={OPTION_LABELS.maxRepliesPerContact}
              value={draft.maxRepliesMode}
              options={[
                { value: "sin_tope", label: "Sin tope" },
                { value: "tope", label: "Máximo" },
              ]}
              disabled={busy}
              onChange={(m) => set({ maxRepliesMode: m })}
            />
            {draft.maxRepliesMode === "tope" && (
              <NumberField label="Máximo de respuestas" value={draft.maxReplies} min={1} max={MAX_REPLIES_CAP} unit="respuestas" disabled={busy} onChange={(t) => set({ maxReplies: t })} />
            )}
          </span>
        }
      />

      {/* Guardar: solo con cambios; un solo botón para todo. Fijo abajo mientras la sección
          está a la vista: no hay que deslizar hasta el final para guardar. */}
      {dirty && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-md border border-brand-orange/50 bg-background p-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!canSave || busy} className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
            <button type="button" onClick={discard} disabled={busy} className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
              Descartar
            </button>
            <span className="text-xs text-foreground/70">
              {changes.length === 1 ? "1 cambio sin guardar." : changes.length > 1 ? `${changes.length} cambios sin guardar.` : "Cambios sin guardar."}
            </span>
          </div>
          {errors.length > 0 && (
            <ul className="flex flex-col gap-0.5 border-l-2 border-brand-orange pl-2 text-xs text-foreground" aria-live="polite">
              {errors.map((e) => (
                <li key={e}>No se puede guardar: {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirm.error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</p>}
      <p className="text-xs text-foreground/60">
        {lastChange
          ? `Último cambio: ${describeChange({ ...lastChange, createdAt: new Date(lastChange.createdAt) }, new Date())}`
          : "Sin cambios todavía: todo está en los valores de fábrica (el comportamiento de siempre)."}
        {JSON.stringify(saved) === JSON.stringify(BOT_OPTIONS_DEFAULTS) && lastChange ? " · Hoy todo está en los valores de fábrica." : ""}
      </p>
      {confirm.ui}
    </div>
  );
}
