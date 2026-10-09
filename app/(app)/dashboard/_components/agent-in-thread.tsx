"use client";

// El Agente IA dentro del hilo (Fase B): aviso "🤖 Pausado · vuelve hoy 22:30" (o
// "Pausado indefinidamente"), solo informativo desde el 26-sep-2026, y los avisos
// del agente para el vendedor, intercalados en el hilo (discretos, sin acción). Se
// recarga con cada evento SSE de la conversación (refreshToken), igual que los programados.
import { useCallback, useEffect, useRef, useState } from "react";
import { getConversationAgent } from "@/lib/actions/agente-conversacion";
import type { AgentNoticeView, AgentThreadView } from "@/lib/agente-ia/types";
import { agentStatusLabel } from "@/lib/agente-ia/labels";
import { EVENT_BATCH_MS } from "./chat-events";

// Recarga con cada mensaje que llega o se va (refreshToken) y cada vez que la Bandeja
// vuelve a pedir el detalle (detailKey): un `conversation.updated` —pausa,
// reactivación o aviso nuevo— llega por ahí, no por refreshToken. Si los dos cambian
// seguidos (llegó un mensaje), es UNA sola lectura (EVENT_BATCH_MS).
export function useConversationAgent(conversationId: string, refreshToken: number, detailKey?: unknown) {
  const [agent, setAgent] = useState<AgentThreadView | null>(null);
  const load = useCallback(async () => {
    try {
      setAgent(await getConversationAgent(conversationId));
    } catch {
      // Silencioso: el siguiente evento lo intenta de nuevo.
    }
  }, [conversationId]);
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    const delay = loadedForRef.current === conversationId ? EVENT_BATCH_MS : 0;
    loadedForRef.current = conversationId;
    const t = setTimeout(() => void load(), delay);
    return () => clearTimeout(t);
  }, [load, refreshToken, detailKey, conversationId]);
  return { agent, reload: load };
}

export function AgentPausedBanner({
  agent,
  nowMs,
}: {
  agent: AgentThreadView | null;
  // Reloj del chat: "hoy"/"mañana" se recalculan con él.
  nowMs?: number;
}) {
  if (!agent || agent.channelMode === "off" || agent.agentState === "activo") return null;
  // Solo informa: "Activar" vive en el Detalle del contacto (decisión del dueño, 26-sep-2026).
  return (
    <div className="border-b bg-muted/60 px-4 py-1.5 text-center text-xs text-foreground">
      🤖 <span className="font-medium">{agentStatusLabel(agent, nowMs === undefined ? undefined : new Date(nowMs))}</span>
      <span className="text-muted-foreground"> · se activa en el Detalle del contacto</span>
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
