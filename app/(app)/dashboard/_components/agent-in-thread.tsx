"use client";

// El Agente IA dentro del hilo (Fase B): aviso "🤖 Agente pausado" con
// "Reactivar" (bajo el aviso de 24 h) y el borrador del modo "borrador" al
// final del hilo (Enviar / Descartar). Se recarga con cada evento SSE de la
// conversación (refreshToken), igual que los programados.
import { useCallback, useEffect, useState } from "react";
import {
  approveAgentDraft,
  discardAgentDraft,
  getConversationAgent,
  reactivateAgent,
} from "@/lib/actions/agente-conversacion";
import type { AgentActionResult, AgentThreadView } from "@/lib/agente-ia/types";
import { pauseReason } from "@/lib/agente-ia/labels";

// Recarga con cada evento del hilo (refreshToken) y cada vez que la Bandeja
// vuelve a pedir el detalle (detailKey): un `conversation.updated` —pausa,
// reactivación o borrador nuevo— llega por ahí, no por refreshToken.
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

export function AgentDraftInThread({
  agent,
  onChanged,
}: {
  agent: AgentThreadView | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = agent?.draft;
  if (!draft) return null;

  async function act(kind: "send" | "discard", run: () => Promise<AgentActionResult>) {
    setBusy(kind);
    setError(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl border border-dashed border-brand-navy/50 bg-card px-3 py-2 text-sm shadow-sm">
        <p className="text-[11px] font-medium text-muted-foreground">🤖 Borrador del agente · aún no se envía</p>
        <div className="mt-1 space-y-2">
          {draft.bubbles.map((b, i) => (
            <p key={i} className="whitespace-pre-wrap break-words">
              {b}
            </p>
          ))}
        </div>
        <div className="mt-1 flex justify-end gap-1 text-[11px]">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("send", () => approveAgentDraft({ draftId: draft.id }))}
            className="rounded px-1.5 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 dark:text-sky-300"
          >
            {busy === "send" ? "Enviando…" : "Enviar"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("discard", () => discardAgentDraft({ draftId: draft.id }))}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {busy === "discard" ? "Descartando…" : "Descartar"}
          </button>
        </div>
        {error && <p className="mt-1 border-l-2 border-brand-orange pl-2 text-[11px] text-foreground">{error}</p>}
      </div>
    </div>
  );
}
