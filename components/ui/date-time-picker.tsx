"use client";

// Calendario propio del CRM (7-oct-2026, diseño aprobado por el dueño): reemplaza los <input type="date">,
// "time" y "datetime-local" del navegador en todo el CRM. El mismo acomodo que el de Chrome (mes ▾ y flechas
// ↑ ↓, días a la izquierda; columnas de hora, minutos y a.m./p.m. a la derecha), con la estética de la marca:
// el día elegido en círculo azul y una marca azul que se desliza (con rebote) a la hora elegida y centra la
// columna. Sin «Borrar» ni «Hoy». En el celular se queda el selector del teléfono (las ruedas del iPhone).
// Mismo valor que el input nativo ("AAAA-MM-DD", "HH:MM" o "AAAA-MM-DDTHH:MM"): quien lo usa no cambia.
// Sin lógica de datos: las cuentas viven en lib/dates/picker.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, Clock } from "lucide-react";
import {
  addMonths,
  clampValue,
  dayOutOfRange,
  displayValue,
  formatValue,
  from12h,
  minuteOptions,
  monthMatrix,
  MONTH_NAMES,
  parseValue,
  to12h,
  WEEKDAY_INITIALS,
  type PickerMode,
  type PickerParts,
} from "@/lib/dates/picker";
import { useIsMobile } from "./use-media-query";

const NATIVE_TYPE: Record<PickerMode, string> = { datetime: "datetime-local", date: "date", time: "time" };
const PLACEHOLDER: Record<PickerMode, string> = { datetime: "dd/mm/aaaa, --:-- --", date: "dd/mm/aaaa", time: "--:-- --" };
const todayMazatlan = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());

export type DateTimePickerProps = {
  mode: PickerMode;
  value: string;
  onChange: (value: string) => void;
  /** Mismo formato que `value`. */
  min?: string;
  max?: string;
  /** Minutos de la columna (1 = 00…59). */
  minuteStep?: number;
  disabled?: boolean;
  "aria-label"?: string;
  /** Clases del campo (las mismas que tenía el input). */
  className?: string;
};

export function DateTimePicker(props: DateTimePickerProps) {
  const mobile = useIsMobile();
  if (mobile) {
    const { mode, value, onChange, min, max, minuteStep, disabled, className } = props;
    return (
      <input
        type={NATIVE_TYPE[mode]}
        value={value}
        min={min}
        max={max}
        step={mode !== "date" && minuteStep && minuteStep > 1 ? minuteStep * 60 : undefined}
        disabled={disabled}
        aria-label={props["aria-label"]}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      />
    );
  }
  return <DesktopPicker {...props} />;
}

function DesktopPicker({ mode, value, onChange, min, max, minuteStep = 1, disabled, className = "", "aria-label": ariaLabel }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const shown = displayValue(value, mode);
  const Icon = mode === "time" ? Clock : CalendarDays;

  // Debajo del campo (o arriba si no cabe), sin salirse de la ventana; se reacomoda al deslizar.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const field = fieldRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!field || !pop) return;
      const { offsetWidth: w, offsetHeight: h } = pop;
      const below = field.bottom + 6;
      const top = below + h > window.innerHeight - 8 && field.top - 6 - h > 8 ? field.top - 6 - h : below;
      const left = Math.min(Math.max(8, field.left), window.innerWidth - w - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Clic afuera cierra.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (fieldRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    fieldRef.current?.focus();
  };

  return (
    <>
      <button
        ref={fieldRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-between gap-2 text-left tabular-nums disabled:opacity-60 ${className}`}
      >
        <span className={shown ? "" : "text-muted-foreground"}>{shown || PLACEHOLDER[mode]}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel ?? "Elegir fecha y hora"}
            // Lo que pasa adentro no llega a las ventanas de atrás (React pasa los eventos del portal a sus padres).
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                event.preventDefault();
                close();
              }
            }}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[60] flex gap-3 rounded-xl border bg-background p-3 text-foreground shadow-xl ring-1 ring-black/5 select-none animate-in fade-in-0 zoom-in-95 duration-150 dark:ring-white/10"
          >
            {mode !== "time" && (
              <Calendar
                value={value}
                min={min}
                max={max}
                onPick={(day) => {
                  const p = parseValue(value, mode) ?? { ...parseValue(day, "date")!, hh: 9, mm: 0 };
                  const next = parseValue(day, "date")!;
                  onChange(clampValue(formatValue({ ...p, y: next.y, m: next.m, d: next.d }, mode), min, max));
                  if (mode === "date") close();
                }}
              />
            )}
            {mode !== "date" && (
              <TimeColumns
                parts={parseValue(value, mode)}
                minuteStep={minuteStep}
                onPick={(hh, mm) => {
                  const base: PickerParts = parseValue(value, mode) ?? { ...parseValue(todayMazatlan(), "date")!, hh: 9, mm: 0 };
                  onChange(clampValue(formatValue({ ...base, hh, mm }, mode), min, max));
                }}
                separated={mode === "datetime"}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Días ─────────────────────────────────────────────────────────────────────

function Calendar({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (day: string) => void }) {
  const selected = value ? value.slice(0, 10) : "";
  const today = todayMazatlan();
  const start = parseValue(selected || today, "date")!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [months, setMonths] = useState(false);
  const move = (delta: number) => setView((v) => addMonths(v.y, v.m, delta));

  return (
    <div className="flex w-[15.5rem] flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonths((s) => !s)}
          aria-expanded={months}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-muted"
        >
          {MONTH_NAMES[view.m - 1]} de {view.y}
          <ChevronDown className={`size-3.5 transition-transform duration-200 ${months ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <span className="flex">
          <button type="button" onClick={() => move(months ? -12 : -1)} aria-label={months ? "Año anterior" : "Mes anterior"} className="rounded-md p-1.5 hover:bg-muted">
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => move(months ? 12 : 1)} aria-label={months ? "Año siguiente" : "Mes siguiente"} className="rounded-md p-1.5 hover:bg-muted">
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
        </span>
      </div>

      {months ? (
        <div className="grid grid-cols-3 gap-1 pt-1">
          {MONTH_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setView((v) => ({ y: v.y, m: i + 1 }));
                setMonths(false);
              }}
              className={`rounded-lg py-2.5 text-sm capitalize transition-colors ${
                view.m === i + 1 ? "bg-brand-navy font-semibold text-white" : "hover:bg-muted"
              }`}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAY_INITIALS.map((w, i) => (
            <span key={i} className="py-1 text-[11px] font-medium text-muted-foreground">
              {w}
            </span>
          ))}
          {monthMatrix(view.y, view.m).map((day) => {
            const isSel = day.value === selected;
            const isToday = day.value === today;
            const off = dayOutOfRange(day.value, min, max);
            return (
              <button
                key={day.value}
                type="button"
                disabled={off}
                aria-pressed={isSel}
                aria-label={`${day.d} de ${MONTH_NAMES[day.m - 1]} de ${day.y}`}
                onClick={() => {
                  if (!day.inMonth) setView({ y: day.y, m: day.m });
                  onPick(day.value);
                }}
                className={`mx-auto flex size-8 items-center justify-center rounded-full text-sm tabular-nums transition-[background-color,color,transform,box-shadow] duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-30 ${
                  isSel
                    ? "scale-110 bg-brand-navy font-semibold text-white shadow-md"
                    : isToday
                      ? "text-brand-navy ring-1 ring-brand-navy hover:bg-brand-navy/10 dark:text-sky-300 dark:ring-sky-300"
                      : day.inMonth
                        ? "hover:bg-muted"
                        : "text-muted-foreground/60 hover:bg-muted"
                }`}
              >
                {day.d}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Hora ─────────────────────────────────────────────────────────────────────

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const pad = (n: number) => String(n).padStart(2, "0");

function TimeColumns({ parts, minuteStep, onPick, separated }: { parts: PickerParts | null; minuteStep: number; onPick: (hh: number, mm: number) => void; separated: boolean }) {
  const hh = parts?.hh ?? null;
  const mm = parts?.mm ?? null;
  const { h12, ap } = hh === null ? { h12: null, ap: null } : to12h(hh);
  const minutes = minuteOptions(minuteStep, mm ?? undefined);
  const curH = h12 ?? 9;
  const curAp = ap ?? "a.m.";
  const curM = mm ?? 0;
  return (
    <div className={`flex gap-1 ${separated ? "border-l pl-3" : ""}`}>
      <Column label="Hora" items={HOURS} selected={h12} render={pad} onSelect={(h) => onPick(from12h(h, curAp), curM)} />
      <Column label="Minutos" items={minutes} selected={mm} render={pad} onSelect={(m) => onPick(from12h(curH, curAp), m)} />
      <Column label="a.m. o p.m." items={["a.m.", "p.m."] as const} selected={ap} render={(v) => v} onSelect={(v) => onPick(from12h(curH, v), curM)} />
    </div>
  );
}

const ROW = 32; // alto de cada opción (h-8)

function Column<T extends string | number>({ label, items, selected, render, onSelect }: { label: string; items: readonly T[]; selected: T | null; render: (v: T) => string; onSelect: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const first = useRef(true);

  // La marca azul se desliza a la opción elegida y la columna la deja en medio.
  useLayoutEffect(() => {
    const col = ref.current;
    const el = col?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!col || !el) return;
    setTop(el.offsetTop);
    col.scrollTo({ top: el.offsetTop - (col.clientHeight - ROW) / 2, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [selected]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="relative h-56 w-14 snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {top !== null && (
        <span
          aria-hidden="true"
          style={{ top }}
          className="pointer-events-none absolute inset-x-0.5 h-8 rounded-lg bg-brand-navy shadow-md transition-[top] duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)] motion-reduce:transition-none"
        />
      )}
      <div aria-hidden="true" className="h-24" />
      {items.map((item) => {
        const isSel = item === selected;
        return (
          <button
            key={String(item)}
            type="button"
            role="option"
            aria-selected={isSel}
            onClick={() => onSelect(item)}
            className={`relative z-10 block h-8 w-full snap-center rounded-lg text-center text-sm tabular-nums transition-colors duration-200 ${
              isSel ? "font-semibold text-white" : "text-foreground hover:bg-muted"
            }`}
          >
            {render(item)}
          </button>
        );
      })}
      <div aria-hidden="true" className="h-24" />
    </div>
  );
}
