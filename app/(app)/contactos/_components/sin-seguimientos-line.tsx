"use client";

// Detalle del contacto › Agente IA: el contacto se dio de baja de las promociones de WhatsApp
// (error 131050) y quedó «sin seguimientos». «Quitar» lo regresa (con confirmación); si su chat
// sigue parado, la siguiente lectura del Agente IA arma un seguimiento nuevo (docs/seguimientos.md §15).
import { useState } from "react";
import { quitarSinSeguimientos } from "@/lib/actions/seguimientos";

export function SinSeguimientosLine({ contactId, onCleared }: { contactId: string; onCleared: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quitar = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await quitarSinSeguimientos(contactId);
      if (res.ok) onCleared();
      else setError(res.message);
    } catch {
      setError("No se pudo quitar. Intenta de nuevo.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-amber-500/60 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" data-testid="sin-seguimientos">
      <p>
        <span className="font-medium">Sin seguimientos</span> · se dio de baja de las promociones de WhatsApp, así que el Agente IA no le manda seguimientos.
      </p>
      {confirming ? (
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span>¿Volver a darle seguimientos? Si vuelve a darse de baja, se marca otra vez.</span>
          <button type="button" disabled={busy} onClick={() => void quitar()} className="rounded-md bg-brand-orange px-2 py-0.5 font-medium text-brand-white disabled:opacity-60" data-glow>
            Sí, quitar
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border px-2 py-0.5">
            Cancelar
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-1 rounded-md border border-amber-600/60 px-2 py-0.5 font-medium">
          Quitar
        </button>
      )}
      {error && <p className="mt-1 text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
