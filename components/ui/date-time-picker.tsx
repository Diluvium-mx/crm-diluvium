"use client";

// Calendario propio del CRM (7-oct-2026, diseño aprobado por el dueño): reemplaza los <input type="date">,
// "time" y "datetime-local" del navegador en todo el CRM. El mismo acomodo que el de Chrome (mes ▾ y flechas
// ↑ ↓, días a la izquierda; columnas de hora, minutos y a.m./p.m. a la derecha), con la estética de la marca:
// el día elegido en círculo azul. Sin «Borrar» ni «Hoy». En el celular se queda el selector del teléfono.
// 7-oct-2026 (2.ª ronda, pedido del dueño): la hora y los minutos son RUEDAS INFINITAS como las de Apple (la banda
// azul queda fija en medio, la lista gira debajo y lo que queda en la banda al soltar es lo elegido; nunca se
// acaba) y deslizar hacia arriba o abajo sobre los días (Magic Mouse o trackpad) cambia de mes con el mismo gesto
// del visor de archivos (lib/inbox/viewer.ts › wheelSwipe), pero en vertical.
// Mismo valor que el input nativo ("AAAA-MM-DD", "HH:MM" o "AAAA-MM-DDTHH:MM"): quien lo usa no cambia.
// Sin lógica de datos: las cuentas viven en lib/dates/picker.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { WHEEL_SWIPE_START, wheelSwipe } from "@/lib/inbox/viewer";
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
      // Solo si cambió: girar una rueda también avisa «scroll» y no debe volver a pintar todo.
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
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
            // Escondido hasta saber dónde va. `transition-none`: con `duration-*` (para la entrada) el navegador
            // animaba TAMBIÉN la posición y el calendario llegaba «volando» desde arriba (7-oct-2026).
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="fixed z-[60] flex gap-3 rounded-xl border bg-background p-3 text-foreground shadow-xl ring-1 ring-black/5 transition-none select-none animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none dark:ring-white/10"
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

// Si la rueda deja de llegar este tiempo sin cambiar de mes, los días regresan a su lugar (como el visor).
const WHEEL_IDLE_MS = 180;

function Calendar({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (day: string) => void }) {
  const selected = value ? value.slice(0, 10) : "";
  const today = todayMazatlan();
  const start = parseValue(selected || today, "date")!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [months, setMonths] = useState(false);
  // Dirección del último cambio de mes (para la entrada de los días) y lo que siguen al dedo mientras se desliza.
  const [slide, setSlide] = useState<1 | -1 | 0>(0);
  const [drag, setDrag] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const wheel = useRef(WHEEL_SWIPE_START);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const move = (delta: number) => {
    setSlide(delta > 0 ? 1 : -1);
    setDrag(0);
    setView((v) => addMonths(v.y, v.m, delta));
  };
  const moveRef = useRef(move);
  useLayoutEffect(() => {
    moveRef.current = move;
  });

  // Deslizar arriba/abajo sobre los días = mes anterior/siguiente (un dedo en el Magic Mouse, dos en el trackpad).
  useEffect(() => {
    const el = gridRef.current;
    if (!el || months) return;
    const onWheel = (event: WheelEvent) => {
      const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
      if (Math.abs(dy) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      const { state, action } = wheelSwipe(wheel.current, dy, performance.now(), () => true);
      wheel.current = state;
      if (idle.current) clearTimeout(idle.current);
      if (action.type === "go") moveRef.current(action.dir);
      else if (action.type === "follow") {
        setDrag(Math.max(-28, Math.min(28, action.px * 0.4)));
        idle.current = setTimeout(() => {
          if (!wheel.current.locked) {
            wheel.current = { ...wheel.current, acc: 0 };
            setDrag(0);
          }
        }, WHEEL_IDLE_MS);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (idle.current) clearTimeout(idle.current);
    };
  }, [months]);

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
        <div ref={gridRef} className="overflow-hidden overscroll-contain">
          <div
            // Cada mes entra deslizándose desde abajo (siguiente) o desde arriba (anterior), como el visor.
            key={`${view.y}-${view.m}`}
            style={{ transform: `translateY(${drag}px)`, transition: drag === 0 ? "transform 220ms cubic-bezier(0.3, 1.4, 0.5, 1)" : "none" }}
            className={`grid grid-cols-7 gap-0.5 text-center ${
              slide === 1 ? "animate-in fade-in-0 slide-in-from-bottom-6 duration-200" : slide === -1 ? "animate-in fade-in-0 slide-in-from-top-6 duration-200" : ""
            } motion-reduce:animate-none`}
          >
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
                    if (!day.inMonth) move(day.y * 12 + day.m - (view.y * 12 + view.m));
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
        </div>
      )}
    </div>
  );
}

// ── Hora: ruedas como las de Apple ───────────────────────────────────────────

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const pad = (n: number) => String(n).padStart(2, "0");

function TimeColumns({ parts, minuteStep, onPick, separated }: { parts: PickerParts | null; minuteStep: number; onPick: (hh: number, mm: number) => void; separated: boolean }) {
  const hh = parts?.hh ?? null;
  const mm = parts?.mm ?? null;
  const { h12, ap } = hh === null ? { h12: null, ap: null } : to12h(hh);
  const minutes = useMemo(() => minuteOptions(minuteStep, mm ?? undefined), [minuteStep, mm]);
  const curH = h12 ?? 9;
  const curAp = ap ?? "a.m.";
  const curM = mm ?? 0;
  return (
    // `self-center`: el bloque mide lo que las ruedas (h-56) y la banda queda justo en su medio.
    <div className={`relative flex gap-1 self-center ${separated ? "border-l pl-3" : ""}`}>
      {/* La banda azul fija en medio (las columnas giran debajo). */}
      <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 right-0 h-8 -translate-y-1/2 rounded-lg bg-brand-navy shadow-md ${separated ? "left-3" : "left-0"}`} />
      <Wheel label="Hora" items={HOURS} selected={h12} loop render={pad} onSelect={(h) => onPick(from12h(h, curAp), curM)} />
      <Wheel label="Minutos" items={minutes} selected={mm} loop render={pad} onSelect={(m) => onPick(from12h(curH, curAp), m)} />
      <Wheel label="a.m. o p.m." items={AMPM} selected={ap} render={(v) => v} onSelect={(v) => onPick(from12h(curH, v), curM)} />
    </div>
  );
}

const AMPM = ["a.m.", "p.m."] as const;
const ROW = 32; // alto de cada opción (h-8)
const VISIBLE = 7; // renglones a la vista (h-56)
const PAD = ((VISIBLE - 1) / 2) * ROW; // espacio arriba y abajo para que la primera y la última lleguen a la banda
const SETTLE_MS = 120; // sin girar este tiempo = soltó la rueda

/**
 * Una rueda. Con `loop` la lista se repite (copias suficientes para ~1,500 px de cada lado) y al soltar se
 * regresa en silencio a la copia de en medio: nunca se acaba. Lo que queda en la banda al soltar es lo elegido;
 * tocar una opción la lleva a la banda.
 */
function Wheel<T extends string | number>({
  label,
  items,
  selected,
  render,
  onSelect,
  loop = false,
}: {
  label: string;
  items: readonly T[];
  selected: T | null;
  render: (v: T) => string;
  onSelect: (v: T) => void;
  loop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = items.length;
  const side = loop ? Math.ceil(48 / n) : 0;
  const copies = 2 * side + 1;
  const rows = useMemo(() => Array.from({ length: n * copies }, (_, k) => items[k % n]), [items, n, copies]);
  const [center, setCenter] = useState<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placed = useRef(false);
  const latest = useRef({ selected, onSelect });
  useLayoutEffect(() => {
    latest.current = { selected, onSelect };
  });
  const mod = (k: number) => ((k % n) + n) % n;

  // Lo elegido va a la banda: al abrir, en la copia de en medio; si cambia desde fuera, en la copia más cercana.
  useLayoutEffect(() => {
    const col = ref.current;
    if (!col || selected === null) return;
    const i = items.indexOf(selected);
    if (i < 0) return;
    const cur = Math.round(col.scrollTop / ROW);
    if (placed.current && rows[cur] === selected) return;
    const k = placed.current ? cur + (((i - mod(cur) + n + Math.floor(n / 2)) % n) - Math.floor(n / 2)) : side * n + i;
    col.scrollTop = k * ROW;
    setCenter(k);
    placed.current = true;
    // `mod` y `rows` dependen de `items`; basta con reaccionar a lo elegido y a la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const onScroll = () => {
    const col = ref.current;
    if (!col) return;
    setCenter(Math.round(col.scrollTop / ROW));
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const k = Math.round(col.scrollTop / ROW);
      const i = mod(k);
      // Lejos de la copia de en medio: se regresa a ella sin que se note (misma opción, otra copia).
      if (loop && (k < n || k >= (copies - 1) * n)) {
        col.scrollTop = (side * n + i) * ROW;
        setCenter(side * n + i);
      }
      if (items[i] !== latest.current.selected) latest.current.onSelect(items[i]);
    }, SETTLE_MS);
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      onScroll={onScroll}
      // Se desvanece arriba y abajo, como la rueda del iPhone.
      className="relative z-10 h-56 w-14 snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)] [&::-webkit-scrollbar]:hidden"
    >
      <div aria-hidden="true" style={{ height: PAD }} />
      {rows.map((item, k) => {
        const inBand = k === center;
        return (
          <button
            key={k}
            type="button"
            role="option"
            aria-selected={item === selected && inBand}
            tabIndex={inBand ? 0 : -1}
            onClick={() => ref.current?.scrollTo({ top: k * ROW, behavior: "smooth" })}
            className={`block h-8 w-full snap-center text-center text-sm tabular-nums transition-[color,transform] duration-150 ${
              inBand ? "scale-105 font-semibold text-white" : "text-foreground/80 hover:text-foreground"
            }`}
          >
            {render(item)}
          </button>
        );
      })}
      <div aria-hidden="true" style={{ height: PAD }} />
    </div>
  );
}
