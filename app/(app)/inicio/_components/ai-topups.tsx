"use client";

// Recargas de crédito de los proveedores de IA: owner/admin registra cada una
// (proveedor, monto en USD sin impuestos y fecha) y puede borrar una capturada
// por error. Sin lógica de datos: solo llama a las Server Actions.
import { useState, useTransition } from "react";
import { addAiTopup, deleteAiTopup } from "@/lib/actions/ai-spend";
import type { TopupRow } from "@/lib/dashboard/ai-spend";
import { formatUsd } from "@/lib/usd-format";

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
    if (!window.confirm(`¿Borrar la recarga de ${formatUsd(t.amountUsd)} en ${t.label} del ${t.toppedUpOn}?`)) return;
    start(async () => {
      const r = await deleteAiTopup({ id: t.id });
      if (!r.ok) setError(r.message);
    });
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">Recargas registradas</h3>
        {canRegister && !open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white">
            + Registrar recarga
          </button>
        )}
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
            <input type="date" value={day} max={todayLocal()} onChange={(e) => setDay(e.target.value)} className={input} />
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
        <ul className="mt-2 flex flex-col divide-y text-xs">
          {topups.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-1">
              <span className="text-foreground">
                {t.toppedUpOn} · {t.label} · <span className="tabular-nums">{formatUsd(t.amountUsd)}</span>
                {t.author ? <span className="text-muted-foreground"> · {t.author}</span> : null}
              </span>
              {canRegister && (
                <button type="button" disabled={pending} onClick={() => remove(t)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
