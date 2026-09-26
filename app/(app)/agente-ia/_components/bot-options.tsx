"use client";

// Sección "Opciones" de la pestaña Agente IA (26-sep-2026): las opciones del bot
// copiadas de Ángela (GHL), cada una con una línea de ayuda y "En GHL: …". Cada
// opción se guarda sola al cambiarla (las que llevan número, con «Guardar»). Los valores
// de fábrica son el comportamiento de hoy. Sin lógica de datos: solo llama a la Server
// Action; las reglas viven en lib/agente-ia/opciones.ts.
import { useRef, useState, useTransition } from "react";
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
  type BotOptionsPatch,
  type BotSchedule,
} from "@/lib/agente-ia/opciones";
import type { OptionsChangeView } from "@/lib/agente-ia/types";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_SCHEDULE: BotSchedule = { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "18:00" };

const radioClass = (on: boolean) =>
  `px-3 py-1.5 text-sm transition-colors disabled:opacity-60 ${on ? "bg-brand-navy text-white" : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"}`;
const inputClass = "w-20 rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground dark:border-white/15";
const saveClass = "rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white disabled:opacity-50";

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

// Número con «Guardar» (horas o cantidad): no se manda cada tecla.
function NumberWithSave({ label, value, min, max, unit, disabled, onSave }: { label: string; value: number; min: number; max: number; unit: string; disabled: boolean; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  return (
    <span className="flex items-center gap-1">
      <input type="number" inputMode="numeric" min={min} max={max} value={text} aria-label={label} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && n !== value && onSave(n)} className={inputClass} />
      <span className="text-xs text-foreground/70">{unit}</span>
      {n !== value && (
        <button type="button" disabled={disabled || !valid} onClick={() => onSave(n)} className={saveClass}>
          Guardar
        </button>
      )}
    </span>
  );
}

export function BotOptionsSection({ options: initial, lastChange: initialChange }: { options: BotOptions; lastChange: OptionsChangeView | null }) {
  const [options, setOptions] = useState<BotOptions>(initial);
  const [lastChange, setLastChange] = useState<OptionsChangeView | null>(initialChange);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Última espera GUARDADA: el deslizador solo guarda al soltarlo si cambió.
  const savedDelay = useRef(initial.responseDelaySeconds);
  // Borradores de las opciones con varios campos (horario y modo de las horas).
  const [schedule, setSchedule] = useState<BotSchedule>(options.schedule ?? DEFAULT_SCHEDULE);
  const [reactivateMode, setReactivateMode] = useState<"nunca" | "8" | "24" | "otro">(
    options.humanReplyReactivateHours === null ? "nunca" : options.humanReplyReactivateHours === 8 ? "8" : options.humanReplyReactivateHours === 24 ? "24" : "otro",
  );

  function save(patch: BotOptionsPatch) {
    const previous = options;
    setOptions({ ...options, ...patch } as BotOptions);
    setError(null);
    start(async () => {
      try {
        const r = await updateBotOptions(patch);
        if (r.ok) {
          setOptions(r.options);
          setLastChange(r.lastChange);
          savedDelay.current = r.options.responseDelaySeconds;
        } else {
          setOptions(previous);
          setError(r.message);
        }
      } catch {
        setOptions(previous);
        setError("No se pudo guardar; revisa tu conexión e inténtalo de nuevo.");
      }
    });
  }

  function commitDelay(value: number) {
    if (value !== savedDelay.current) save({ responseDelaySeconds: value });
  }

  const yesNo = [
    { value: true, label: "Sí" },
    { value: false, label: "No" },
  ];

  const scheduleDirty = JSON.stringify(schedule) !== JSON.stringify(options.schedule);

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
              value={options.responseDelaySeconds}
              aria-label={OPTION_LABELS.responseDelaySeconds}
              disabled={pending}
              onChange={(e) => setOptions({ ...options, responseDelaySeconds: Number(e.target.value) })}
              onPointerUp={(e) => commitDelay(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => commitDelay(Number((e.target as HTMLInputElement).value))}
              className="w-40 accent-brand-navy"
            />
            <span className="w-10 text-sm tabular-nums text-foreground">{options.responseDelaySeconds} s</span>
          </span>
        }
      />

      {/* 2. Pausa por vendedor + reactivar */}
      <Option field="pauseOnHumanReply" control={<Radio label={OPTION_LABELS.pauseOnHumanReply} value={options.pauseOnHumanReply} options={yesNo} disabled={pending} onChange={(v) => save({ pauseOnHumanReply: v })} />} />
      {options.pauseOnHumanReply && (
        <Option
          field="humanReplyReactivateHours"
          control={
            <span className="flex flex-wrap items-center gap-2">
              <Radio
                label={OPTION_LABELS.humanReplyReactivateHours}
                value={reactivateMode}
                options={[
                  { value: "nunca", label: "Nunca (a mano con «Activar»)" },
                  { value: "8", label: "8 h" },
                  { value: "24", label: "24 h" },
                  { value: "otro", label: "Número de horas" },
                ]}
                disabled={pending}
                onChange={(m) => {
                  setReactivateMode(m);
                  if (m === "nunca") save({ humanReplyReactivateHours: null });
                  else if (m === "8" || m === "24") save({ humanReplyReactivateHours: Number(m) });
                }}
              />
              {reactivateMode === "otro" && (
                <NumberWithSave label="Horas para reactivar" value={options.humanReplyReactivateHours ?? 12} min={1} max={MAX_PAUSE_HOURS} unit="h" disabled={pending} onSave={(n) => save({ humanReplyReactivateHours: n })} />
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
              value={options.handoverPauseHours === null ? "avisar" : "pausar"}
              options={[
                { value: "avisar", label: "Avisar al vendedor y seguir contestando" },
                { value: "pausar", label: "Avisar y pausar el bot en ese chat por" },
              ]}
              disabled={pending}
              onChange={(m) => save({ handoverPauseHours: m === "avisar" ? null : 8 })}
            />
            {options.handoverPauseHours !== null && (
              <NumberWithSave label="Horas de pausa al pedir asesor" value={options.handoverPauseHours} min={1} max={MAX_PAUSE_HOURS} unit="h" disabled={pending} onSave={(n) => save({ handoverPauseHours: n })} />
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
            value={options.schedule === null ? "siempre" : "horario"}
            options={[
              { value: "siempre", label: "24/7" },
              { value: "horario", label: "Días y horas" },
            ]}
            disabled={pending}
            onChange={(m) => {
              if (m === "siempre") save({ schedule: null });
              else {
                setSchedule(options.schedule ?? DEFAULT_SCHEDULE);
                save({ schedule: options.schedule ?? DEFAULT_SCHEDULE });
              }
            }}
          />
        }
      >
        {options.schedule !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded border border-black/15 dark:border-white/15" role="group" aria-label="Días en que contesta el bot">
              {ALL_DAYS.map((d) => {
                const on = schedule.days.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} disabled={pending} onClick={() => setSchedule({ ...schedule, days: on ? schedule.days.filter((x) => x !== d) : [...schedule.days, d].sort((a, b) => a - b) })} className={`px-2 py-1 text-xs ${radioClass(on)}`}>
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1 text-xs text-foreground/70">
              de
              <input type="time" value={schedule.from} aria-label="Hora de inicio" onChange={(e) => setSchedule({ ...schedule, from: e.target.value })} className={inputClass} />
            </label>
            <label className="flex items-center gap-1 text-xs text-foreground/70">
              a
              <input type="time" value={schedule.to} aria-label="Hora de fin" onChange={(e) => setSchedule({ ...schedule, to: e.target.value })} className={inputClass} />
            </label>
            <span className="text-xs text-foreground/70">hora de Mazatlán</span>
            {scheduleDirty && (
              <button type="button" disabled={pending || schedule.days.length === 0 || schedule.from === schedule.to} onClick={() => save({ schedule })} className={saveClass}>
                Guardar horario
              </button>
            )}
          </div>
        )}
      </Option>

      {/* 5. Imágenes y notas de voz */}
      <Option field="readImages" control={<Radio label={OPTION_LABELS.readImages} value={options.readImages} options={yesNo} disabled={pending} onChange={(v) => save({ readImages: v })} />} />
      <Option field="transcribeAudio" control={<Radio label={OPTION_LABELS.transcribeAudio} value={options.transcribeAudio} options={yesNo} disabled={pending} onChange={(v) => save({ transcribeAudio: v })} />} />

      {/* 6. Longitud y mensajes */}
      <Option
        field="responseLength"
        control={<Radio label={OPTION_LABELS.responseLength} value={options.responseLength} options={RESPONSE_LENGTHS.map((l) => ({ value: l, label: RESPONSE_LENGTH_LABELS[l] }))} disabled={pending} onChange={(v) => save({ responseLength: v })} />}
      />
      <Option
        field="maxBubbles"
        control={
          <Radio
            label={OPTION_LABELS.maxBubbles}
            value={options.maxBubbles}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
            ]}
            disabled={pending}
            onChange={(v) => save({ maxBubbles: v })}
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
              value={options.maxRepliesPerContact === null ? "sin_tope" : "tope"}
              options={[
                { value: "sin_tope", label: "Sin tope" },
                { value: "tope", label: "Máximo" },
              ]}
              disabled={pending}
              onChange={(m) => save({ maxRepliesPerContact: m === "sin_tope" ? null : 50 })}
            />
            {options.maxRepliesPerContact !== null && (
              <NumberWithSave label="Máximo de respuestas" value={options.maxRepliesPerContact} min={1} max={MAX_REPLIES_CAP} unit="respuestas" disabled={pending} onSave={(n) => save({ maxRepliesPerContact: n })} />
            )}
          </span>
        }
      />

      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
      <p className="text-xs text-foreground/60">
        {lastChange
          ? `Último cambio: ${describeChange({ ...lastChange, createdAt: new Date(lastChange.createdAt) }, new Date())}`
          : "Sin cambios todavía: todo está en los valores de fábrica (el comportamiento de siempre)."}
        {JSON.stringify(options) === JSON.stringify(BOT_OPTIONS_DEFAULTS) && lastChange ? " · Hoy todo está en los valores de fábrica." : ""}
      </p>
    </div>
  );
}
