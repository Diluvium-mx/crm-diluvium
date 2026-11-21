"use client";

// Recargas de crédito de los proveedores de IA: cualquier rol registra cada una
// (proveedor, monto en USD sin impuestos y fecha) y puede borrar una capturada
// por error (27-oct-2026: Borrar pregunta con el aviso de arriba del CRM, no con el del navegador). 20-nov-2026 (dueño):
// la lista sale cerrada con un renglón de resumen y se abre con la flecha (se recuerda en esta computadora), para que
// el Dashboard no crezca con cada recarga. Sin lógica de datos: solo llama a las Server Actions.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { addAiTopup, deleteAiTopup } from "@/lib/actions/ai-spend";
import type { TopupRow } from "@/lib/dashboard/ai-spend";
import { formatUsd } from "@/lib/usd-format";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { TopConfirm } from "@/components/ui/top-confirm";
import { usePersistentToggle } from "@/components/ui/use-persistent-toggle";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "xai", label: "xAI" },
  { id: "openrouter", label: "OpenRouter" },
];
const input = "rounded border border-black/15 bg-background px-2 py-1 text-sm text-foreground dark:border-white/15";

function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function AiTopups({ topups, canRegister }: { topups: TopupRow[]; canRegister: boolean }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(todayLocal);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // La recarga que se va a borrar (aviso de arriba abierto).
  const [asking, setAsking] = useState<TopupRow | null>(null);
  const [listOpen, setListOpen] = usePersistentToggle("dashboard.recargas", false);
  const last = topups[0];
  // El Dashboard trae las 20 más recientes (lib/dashboard/ai-spend.ts); el resto está en Historial.
  const resumen = last
    ? `${topups.length >= 20 ? "20 más recientes" : topups.length} · última: ${last.toppedUpOn} · ${last.label} · ${formatUsd(last.amountUsd)}`
    : null;

  function submit() {
    setError(null);
    const value = Number(amount.replace(/[$,\s]/g, ""));
    start(async () => {
      const r = await addAiTopup({ provider, amountUsd: value, toppedUpOn: day });
      if (r.ok) {
        setAmount("");
        setOpen(false);
      } else setError(r.message);
    });
  }

  function remove(t: TopupRow) {
    setError(null);
    start(async () => {
      const r = await deleteAiTopup({ id: t.id });
      if (!r.ok) setError(r.message);
      setAsking(null);
    });
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {resumen ? (
          <h3 className="min-w-0">
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              aria-controls={listOpen ? "recargas-lista" : undefined}
              className="flex min-w-0 items-center gap-1.5 text-left text-xs"
            >
              <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${listOpen ? "rotate-90" : ""}`} aria-hidden="true" />
              <span className="font-semibold text-foreground">Recargas registradas</span>
              <span className="truncate text-muted-foreground tabular-nums">{resumen}</span>
            </button>
          </h3>
        ) : (
          <h3 className="text-xs font-semibold text-foreground">Recargas registradas</h3>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* 1-oct-2026 (dueño): el gasto y las recargas de cada mes o periodo, en su propia página. */}
          <Link href="/inicio/gasto-ia" className="rounded border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
            Historial
          </Link>
          {canRegister && !open && (
            <button type="button" onClick={() => setOpen(true)} className="rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white">
              + Registrar recarga
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            Proveedor
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            Monto (USD, sin impuestos)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="50.00" className={`${input} w-32`} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            Fecha
            <DateTimePicker mode="date" value={day} max={todayLocal()} onChange={setDay} className={input} />
          </label>
          <button type="button" disabled={pending || !amount.trim()} onClick={submit} className="rounded bg-brand-orange px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" disabled={pending} onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">
            Cancelar
          </button>
        </div>
      )}
      {topups.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Todavía no hay recargas registradas.</p>
      ) : (
        listOpen && (
        <ul id="recargas-lista" className="mt-2 flex flex-col divide-y text-xs">
          {topups.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-1">
              <span className="text-foreground">
                {t.toppedUpOn} · {t.label} · <span className="tabular-nums">{formatUsd(t.amountUsd)}</span>
                {t.author ? <span className="text-muted-foreground"> · {t.author}</span> : null}
              </span>
              {canRegister && (
                <button type="button" disabled={pending} onClick={() => setAsking(t)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
        )
      )}
      {error && <p className="mt-2 border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
      {asking && (
        <TopConfirm
          title={`¿Borrar la recarga de ${formatUsd(asking.amountUsd)} en ${asking.label} del ${asking.toppedUpOn}?`}
          confirmLabel="Borrar"
          pendingLabel="Borrando…"
          pending={pending}
          onConfirm={() => remove(asking)}
          onCancel={() => setAsking(null)}
        >
          El saldo de {asking.label} se vuelve a calcular sin ella. Bórrala solo si se capturó por error.
        </TopConfirm>
      )}
    </div>
  );
}
