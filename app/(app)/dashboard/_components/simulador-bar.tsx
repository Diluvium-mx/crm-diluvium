"use client";

// Barra del cliente de prueba de staging (30-oct-2026; lib/messaging/simulador.ts): arriba de la caja para
// escribir, solo en su chat. Lo que se escribe aquí llega como si lo mandara el cliente (el Agente IA contesta
// con los modelos de verdad, unos centavos por prueba); nada sale a WhatsApp. «Empezar de nuevo» borra el chat,
// el Detalle y los seguimientos de ese contacto y lo deja como nuevo.
import { useState } from "react";
import { empezarDeNuevoClienteDePrueba, escribirComoClienteDePrueba } from "@/lib/actions/simulador";

export function SimuladorBar({ onReset }: { onReset: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"escribir" | "reiniciar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function escribir() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy("escribir");
    setError(null);
    try {
      const r = await escribirComoClienteDePrueba(t);
      if (r.ok) setText("");
      else setError(r.message);
    } catch {
      setError("No se pudo mandar; inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function reiniciar() {
    setBusy("reiniciar");
    setError(null);
    try {
      const r = await empezarDeNuevoClienteDePrueba();
      if (r.ok) {
        setConfirmReset(false);
        onReset();
      } else setError(r.message);
    } catch {
      setError("No se pudo empezar de nuevo; inténtalo otra vez.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-4 mb-1 space-y-1.5 rounded-md border border-dashed border-brand-navy/40 bg-brand-navy/5 px-3 py-2 text-xs dark:border-sky-300/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-brand-navy dark:text-sky-300">🧪 Cliente de prueba (solo staging): nada sale a WhatsApp</span>
        {confirmReset ? (
          <span className="flex items-center gap-1">
            <span>¿Borrar el chat y empezar de nuevo?</span>
            <button type="button" disabled={busy !== null} onClick={() => void reiniciar()} className="rounded px-2 py-0.5 font-medium text-brand-orange hover:bg-brand-orange/10">
              {busy === "reiniciar" ? "Borrando…" : "Sí, borrar"}
            </button>
            <button type="button" onClick={() => setConfirmReset(false)} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted">
              No
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Empezar de nuevo
          </button>
        )}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void escribir();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe como el cliente…"
          aria-label="Escribir como el cliente de prueba"
          maxLength={4000}
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
        />
        <button type="submit" disabled={!text.trim() || busy !== null} className="shrink-0 rounded-md bg-brand-navy px-3 py-1 text-xs font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50">
          {busy === "escribir" ? "Mandando…" : "Mandar como cliente"}
        </button>
      </form>
      {error && <p className="text-brand-orange">⚠ {error}</p>}
    </div>
  );
}
