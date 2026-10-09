"use client";

// «Programar para las 22:00» del Goal y las FAQs (9-oct-2026, regla del dueño): el selector
// «Cuándo se aplica» de cada editor y el aviso de lo que ya está programado (con «Aplicar
// ahora» y «Quitar programación»). Cada guardado del Goal o de una FAQ hace que Anthropic
// vuelva a cobrar el Goal completo; lo normal es juntar los cambios y aplicarlos de una vez a
// las 22:00. «Ahora» queda para un error grave. Sin lógica de datos: solo llama a las Server
// Actions del editor.
import { CalendarClock } from "lucide-react";
import { applyAgentScheduleNow, cancelAgentSchedule } from "@/lib/actions/agente-ia-editor";
import { APPLY_LABEL, isNight } from "@/lib/agente-ia/scheduled-rules";
import type { ScheduledView } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";

export type ApplyMode = "programar" | "ahora";

/** «Hoy a las 22:00» o, de noche, «en el siguiente minuto». */
export function whenText(now: Date = new Date()): string {
  return isNight(now) ? "en el siguiente minuto (ya es de noche)" : `hoy a las ${APPLY_LABEL}`;
}

export function ApplyModeToggle({ mode, onChange, disabled }: { mode: ApplyMode; onChange: (m: ApplyMode) => void; disabled?: boolean }) {
  const options: { value: ApplyMode; label: string }[] = [
    { value: "programar", label: `Hoy a las ${APPLY_LABEL}` },
    { value: "ahora", label: "Ahora (error grave)" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Cuándo se aplica:</span>
      <div role="radiogroup" aria-label="Cuándo se aplican los cambios" className="flex rounded-md bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded px-2.5 py-1 transition-colors disabled:opacity-50 ${
              mode === o.value ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground">
        {mode === "programar"
          ? "Los cambios se juntan y el Agente IA los usa desde las 22:00; mientras, sigue con lo actual."
          : "Solo para un error grave: el Agente IA lo usa desde el siguiente mensaje y se vuelve a cobrar el Goal completo (~US$0.09)."}
      </span>
    </div>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mazatlan", hour: "2-digit", minute: "2-digit", hour12: false });

/** Aviso de lo programado, arriba del Goal y de las FAQs. */
export function ScheduledBanner({ scheduled }: { scheduled: ScheduledView | null }) {
  const confirm = useConfirm();
  if (!scheduled) return null;
  const parts = [scheduled.goal !== null ? "el Goal" : null, scheduled.faqs !== null ? `las FAQs (${scheduled.faqSummary})` : null].filter(Boolean);
  const conflict = scheduled.status === "conflicto";
  const what = parts.join(" y ");

  function applyNow(force: boolean) {
    confirm.ask({
      title: force ? "¿Aplicar lo programado de todos modos?" : "¿Aplicar ahora lo programado?",
      body: force
        ? "Se reemplaza lo que se guardó «Ahora» después de programarlo. El Agente IA lo usa desde el siguiente mensaje."
        : `Solo para un error grave: ${what} se aplican ya, sin esperar a las ${APPLY_LABEL}, y se vuelve a cobrar el Goal completo (~US$0.09).`,
      confirmLabel: force ? "Sí, aplicar de todos modos" : "Sí, aplicar ahora",
      pendingLabel: "Aplicando…",
      done: "Listo: se aplicó lo programado (quedó una versión)",
      run: () => applyAgentScheduleNow({ force }),
    });
  }

  function cancel() {
    confirm.ask({
      title: "¿Quitar lo programado?",
      body: `Se borran los cambios programados de ${what}. El Agente IA sigue con lo actual.`,
      confirmLabel: "Sí, quitar",
      pendingLabel: "Quitando…",
      done: "Listo: ya no hay nada programado",
      run: () => cancelAgentSchedule({ part: "todo" }),
    });
  }

  return (
    <div
      className={`flex flex-col gap-1.5 border-l-2 px-3 py-2 text-xs ${
        conflict ? "border-brand-orange bg-muted/40" : "border-brand-navy bg-brand-navy/5 dark:border-sky-400"
      }`}
    >
      <p className="flex items-start gap-1.5 text-foreground">
        <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {conflict ? (
            <>
              <span className="font-medium">No se aplicó lo programado</span> ({what}): {scheduled.conflict}
            </>
          ) : (
            <>
              <span className="font-medium">Programado para las {time(scheduled.applyAt)}:</span> {what}
              {scheduled.author ? ` · ${scheduled.author}` : ""}. Mientras, el Agente IA sigue con lo actual.
            </>
          )}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1 pl-5">
        <button
          type="button"
          disabled={confirm.pending}
          onClick={() => applyNow(conflict)}
          className="rounded border border-black/15 px-2 py-0.5 font-medium text-foreground hover:bg-muted disabled:opacity-50 dark:border-white/15"
        >
          {conflict ? "Aplicar de todos modos" : "Aplicar ahora"}
        </button>
        <button type="button" disabled={confirm.pending} onClick={cancel} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
          Quitar programación
        </button>
        {confirm.error && <span className="border-l-2 border-brand-orange pl-2 text-foreground">{confirm.error}</span>}
      </div>
      {confirm.ui}
    </div>
  );
}
