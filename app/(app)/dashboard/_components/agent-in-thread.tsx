"use client";

// El Agente IA dentro del hilo (Fase B): aviso "🤖 Agente pausado" con
// "Reactivar" (bajo el aviso de 24 h) y los avisos del agente para el vendedor,
// intercalados en el hilo (discretos, sin acción). Se recarga con cada evento SSE
// de la conversación (refreshToken), igual que los programados.
import { useCallback, useEffect, useState } from "react";
import { getConversationAgent, reactivateAgent } from "@/lib/actions/agente-conversacion";
import type { AgentNoticeView, AgentThreadView } from "@/lib/agente-ia/types";
import { pauseReason } from "@/lib/agente-ia/labels";

// Recarga con cada evento del hilo (refreshToken) y cada vez que la Bandeja
// vuelve a pedir el detalle (detailKey): un `conversation.updated` —pausa,
// reactivación o aviso nuevo— llega por ahí, no por refreshToken.
export function useConversationAgent(conversationId: string, refreshToken: number, detailKey?: unknown) {
  const [agent, setAgent] = useState<AgentThreadView | null>(null);
  const load = useCallback(async () => {
    try {
      setAgent(await getConversationAgent(conversationId));
    } catch {
      // Silencioso: el siguiente evento lo intenta de nuevo.
    }
  }, [conversationId]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, refreshToken, detailKey]);
  return { agent, reload: load };
}

export function AgentPausedBanner({
  conversationId,
  agent,
  onChanged,
}: {
  conversationId: string;
  agent: AgentThreadView | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!agent || agent.channelMode === "off" || agent.agentState === "activo") return null;

  async function reactivate() {
    setBusy(true);
    setError(null);
    const result = await reactivateAgent({ conversationId });
    setBusy(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-muted/60 px-4 py-1.5 text-xs text-foreground">
      <span>
        🤖 <span className="font-medium">Agente pausado</span> · {pauseReason(agent)}
      </span>
      <button
        type="button"
        onClick={() => void reactivate()}
        disabled={busy}
        className="rounded px-2 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 dark:text-sky-300"
      >
        {busy ? "Reactivando…" : "Reactivar"}
      </button>
      {error && <span className="border-l-2 border-brand-orange pl-2">{error}</span>}
    </div>
  );
}

// Aviso del agente para el vendedor (guardia, pidió a un vendedor, freno, envío
// no confirmado): una línea discreta en su lugar del hilo. Nunca frena al agente.
export function AgentNoticeLine({ notice }: { notice: AgentNoticeView }) {
  return (
    <div className="my-2 flex justify-center px-4">
      <p className="max-w-[85%] rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-1 text-center text-[11px] text-muted-foreground">
        🤖 {notice.body}
      </p>
    </div>
  );
}
