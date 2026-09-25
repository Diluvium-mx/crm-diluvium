"use client";

// Tarjeta "El agente no pudo responder" (Fase E, "reenvío seguro"): el error en
// palabras simples y dos botones para el vendedor. "Reintentar" = un intento más;
// "Apagar" = pausa al agente solo en esta conversación ("Reactivar" lo regresa).
// Mientras nadie elija, el agente no vuelve a llamar al modelo aquí. Ya atendida,
// queda como línea con lo que se eligió. Sin lógica de datos: Server Actions.
import { useState } from "react";
import { pauseAgentAfterError, retryAgentAfterError } from "@/lib/actions/agente-error";
import type { AgentNoticeView } from "@/lib/agente-ia/types";

const RESOLUTION_TEXT: Record<string, string> = {
  reintentar: "Se reintentó.",
  apagar: "Se apagó el agente en esta conversación.",
  superada: "El agente volvió a contestar.",
};

export function AgentErrorCard({ notice, onChanged }: { notice: AgentNoticeView; onChanged: () => void }) {
  const [busy, setBusy] = useState<"reintentar" | "apagar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "reintentar" | "apagar") {
    setBusy(kind);
    setError(null);
    try {
      const r = kind === "reintentar" ? await retryAgentAfterError({ noticeId: notice.id }) : await pauseAgentAfterError({ noticeId: notice.id });
      if (!r.ok) setError(r.message);
    } catch {
      setError("No se pudo; revisa tu conexión e inténtalo de nuevo.");
    }
    setBusy(null);
    onChanged();
  }

  const resolved = notice.resolvedAt !== null;
  return (
    <div className="my-2 flex justify-center px-4">
      <div
        role="status"
        className={`flex max-w-[85%] flex-col items-center gap-2 rounded-lg border px-3 py-2 text-center text-xs ${
          resolved ? "border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground" : "border-brand-orange/60 bg-brand-orange/10 text-foreground"
        }`}
      >
        <p>⚠ 🤖 {notice.body}</p>
        {resolved ? (
          <p className="text-[11px]">{RESOLUTION_TEXT[notice.resolution ?? ""] ?? "Atendida."}</p>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void act("reintentar")}
              disabled={busy !== null}
              className="rounded bg-brand-orange px-3 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "reintentar" ? "Reintentando…" : "Reintentar"}
            </button>
            <button
              type="button"
              onClick={() => void act("apagar")}
              disabled={busy !== null}
              className="rounded border border-black/15 px-3 py-1 font-medium text-foreground hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
            >
              {busy === "apagar" ? "Apagando…" : "Apagar"}
            </button>
          </div>
        )}
        {error && <p className="border-l-2 border-brand-orange pl-2 text-[11px] text-foreground">{error}</p>}
      </div>
    </div>
  );
}
