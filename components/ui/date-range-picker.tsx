"use client";

// Calendario de RANGO del CRM (23-nov-2026, pedido del dueño: «Desde» y «Hasta» en un solo control, como el de Meta
// Ads). Un botón con el periodo escrito («12 nov – 30 nov 2026»); al picarle se abre un recuadro con los atajos a la
// izquierda (Hoy, Ayer, Últimos 7 días, Últimos 30 días, Este mes, Mes pasado), dos meses juntos (primer clic = inicio,
// segundo = fin; los días de en medio en azul suave) y abajo Cancelar y Aplicar. Los días después de
// hoy no se pueden elegir. Misma estética que el calendario de un día (date-time-picker.tsx). En el celular, el
// recuadro trae los atajos y dos campos con el calendario del teléfono. Sin lógica de datos: las reglas viven en
// lib/dates/range-picker.ts.
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addMonths, MONTH_NAMES, monthMatrix, WEEKDAY_INITIALS } from "@/lib/dates/picker";
import {
  formatRangeLabel,
  matchingPreset,
  nextRange,
  presetRange,
  RANGE_PRESETS,
  visibleMonths,
  type RangeDraft,
} from "@/lib/dates/range-picker";
import { useIsMobile } from "./use-media-query";

type Month = { y: number; m: number };

export function DateRangePicker({
  desde,
  hasta,
  today,
  onApply,
  className = "",
}: {
  desde: string;
  hasta: string;
  /** Hoy en la zona del filtro ("AAAA-MM-DD"): los atajos salen de aquí y después de hoy no se elige. */
  today: string;
  onApply: (desde: string, hasta: string) => void;
  className?: string;
}) {
  const mobile = useIsMobile();
  // Un mes en curso llega hasta su último día (?mes=): se ve y se elige solo hasta hoy.
  const hastaReal = hasta > today ? today : hasta;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<RangeDraft>({ desde, hasta: hastaReal, esperandoFin: false });
  const [view, setView] = useState<Month>(() => visibleMonths(hastaReal).right);
  const [hover, setHover] = useState<string | null>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Debajo del botón, pegado a su orilla derecha (o arriba si no cabe), sin salirse de la ventana.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const field = fieldRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!field || !pop) return;
      const { offsetWidth: w, offsetHeight: h } = pop;
      const below = field.bottom + 6;
      const top = below + h > window.innerHeight - 8 && field.top - 6 - h > 8 ? field.top - 6 - h : below;
      const left = Math.min(Math.max(8, field.right - w), window.innerWidth - w - 8);
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

  // Clic afuera cierra sin aplicar.
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

  const openPicker = () => {
    setDraft({ desde, hasta: hastaReal, esperandoFin: false });
    setView(visibleMonths(hastaReal).right);
    setHover(null);
    setPos(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    fieldRef.current?.focus();
  };
  const apply = () => {
    if (draft.desde && draft.hasta) onApply(draft.desde, draft.hasta);
    close();
  };

  // Mientras se espera el fin, el rango se ve hasta el día bajo el mouse.
  const [shownFrom, shownTo] =
    draft.esperandoFin && hover ? (hover < draft.desde ? [hover, draft.desde] : [draft.desde, hover]) : [draft.desde, draft.hasta];
  const activePreset = draft.esperandoFin ? null : matchingPreset(draft.desde, draft.hasta, today);
  const todayMonth = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
  const canNext = view.y * 12 + view.m < todayMonth.y * 12 + todayMonth.m;
  const left = addMonths(view.y, view.m, -1);
  const validDraft = draft.desde !== "" && draft.hasta !== "" && draft.desde <= draft.hasta && draft.hasta <= today;

  return (
    <>
      <button
        ref={fieldRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Periodo: ${formatRangeLabel(desde, hastaReal)}. Cambiar periodo`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm tabular-nums hover:bg-muted ${className}`}
      >
        <CalendarDays className="size-4 shrink-0 text-brand-navy-dark" aria-hidden="true" />
        <span>{formatRangeLabel(desde, hastaReal)}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Elegir periodo"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                event.preventDefault();
                close();
              }
            }}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="fixed z-[60] flex max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border bg-background text-sm text-foreground shadow-xl ring-1 ring-black/5 transition-none select-none animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none dark:ring-white/10 max-sm:flex-col"
          >
            <div role="group" aria-label="Atajos" className="flex flex-col gap-0.5 border-r p-2 max-sm:flex-row max-sm:flex-wrap max-sm:border-r-0 max-sm:border-b">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={activePreset === p.key}
                  onClick={() => {
                    const r = presetRange(p.key, today);
                    setDraft({ ...r, esperandoFin: false });
                    setView(visibleMonths(r.hasta).right);
                  }}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-left ${
                    activePreset === p.key ? "bg-brand-navy-dark/10 font-medium text-brand-navy-dark dark:text-sky-300" : "hover:bg-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 p-3">
              {mobile ? (
                // data-buscador: es un filtro (no guarda nada), así que «Solo lectura» sí escribe la fecha.
                <div data-buscador className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Desde
                    <input
                      type="date"
                      value={draft.desde}
                      max={today}
                      onChange={(e) => setDraft((d) => ({ desde: e.target.value, hasta: d.hasta < e.target.value ? e.target.value : d.hasta, esperandoFin: false }))}
                      className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Hasta
                    <input
                      type="date"
                      value={draft.hasta}
                      min={draft.desde}
                      max={today}
                      onChange={(e) => setDraft((d) => ({ ...d, hasta: e.target.value, esperandoFin: false }))}
                      className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                    />
                  </label>
                </div>
              ) : (
                <div className="flex gap-6" onMouseLeave={() => setHover(null)}>
                  <MonthGrid
                    month={left}
                    from={shownFrom}
                    to={shownTo}
                    today={today}
                    header={
                      <button type="button" aria-label="Meses anteriores" onClick={() => setView(left)} className="rounded p-1 hover:bg-muted">
                        <ChevronLeft className="size-4" aria-hidden="true" />
                      </button>
                    }
                    side="left"
                    onPick={(day) => setDraft((d) => nextRange(d, day))}
                    onHover={setHover}
                  />
                  <MonthGrid
                    month={view}
                    from={shownFrom}
                    to={shownTo}
                    today={today}
                    header={
                      <button
                        type="button"
                        aria-label="Meses siguientes"
                        disabled={!canNext}
                        onClick={() => setView(addMonths(view.y, view.m, 1))}
                        className="rounded p-1 hover:bg-muted disabled:opacity-30"
                      >
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </button>
                    }
                    side="right"
                    onPick={(day) => setDraft((d) => nextRange(d, day))}
                    onHover={setHover}
                  />
                </div>
              )}
              {/* 23-nov-2026 (dueño): sin «Del … al …» abajo; el rango ya se ve en los dos meses y en el botón. */}
              <div className="flex items-center justify-end gap-3 border-t pt-3">
                <div className="flex gap-2">
                  <button type="button" onClick={close} className="rounded-md border px-3 py-1.5 hover:bg-muted">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!validDraft}
                    onClick={apply}
                    className="rounded-md bg-brand-navy px-3 py-1.5 font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const dayLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function MonthGrid({
  month,
  from,
  to,
  today,
  header,
  side,
  onPick,
  onHover,
}: {
  month: Month;
  from: string;
  to: string;
  today: string;
  header: ReactNode;
  side: "left" | "right";
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
}) {
  const days = monthMatrix(month.y, month.m);
  const title = `${MONTH_NAMES[month.m - 1]} ${month.y}`;
  return (
    <div className="w-[15.5rem]">
      <div className={`mb-2 flex items-center ${side === "left" ? "justify-between" : "justify-between flex-row-reverse"}`}>
        {header}
        <span className="font-medium">{title}</span>
        <span className="size-6" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEKDAY_INITIALS.map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {days.map((d) => {
          if (!d.inMonth) return <span key={d.value} className="h-8" aria-hidden="true" />;
          const futuro = d.value > today;
          const extremo = d.value === from || d.value === to;
          const enMedio = d.value > from && d.value < to;
          const banda = from !== to && (enMedio || extremo);
          // La banda azul suave une el inicio y el fin; los extremos van en círculo navy.
          const bandaClase = !banda ? "" : d.value === from ? "rounded-l-full bg-brand-navy-dark/15" : d.value === to ? "rounded-r-full bg-brand-navy-dark/15" : "bg-brand-navy-dark/15";
          return (
            <div key={d.value} className={`h-8 ${bandaClase}`}>
              <button
                type="button"
                disabled={futuro}
                aria-label={dayLabel.format(new Date(`${d.value}T12:00:00Z`))}
                aria-pressed={extremo || enMedio}
                onClick={() => onPick(d.value)}
                onMouseEnter={() => onHover(d.value)}
                className={`size-8 rounded-full text-xs tabular-nums ${
                  extremo
                    ? "bg-brand-navy-dark font-medium text-white"
                    : futuro
                      ? "cursor-default text-muted-foreground/40"
                      : `hover:bg-muted ${d.value === today ? "font-semibold text-brand-navy-dark dark:text-sky-300" : ""}`
                }`}
              >
                {d.d}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
