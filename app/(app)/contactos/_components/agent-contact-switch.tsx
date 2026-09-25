"use client";

// Estado del Agente IA en "Detalle del contacto" (Fase B). Una fila por
// conversación del contacto (normalmente una, la de WhatsApp): activo con "Apagar
// bot", o apagado (un vendedor contestó o lo apagó con el botón) con su hora de
// regreso y "Reactivar", igual que en la Bandeja. Si el canal está apagado en la
// pestaña Agente IA, no aplica.
import { useCallback, useEffect, useRef, useState } from "react";
import { getContactAgentStatus, reactivateAgent } from "@/lib/actions/agente-conversacion";
import { pauseReason } from "@/lib/agente-ia/labels";
import type { ContactAgentView } from "@/lib/agente-ia/types";
import { BotOffMenu } from "../../dashboard/_components/bot-off-menu";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";

export function AgentContactSwitch({ contactId }: { contactId: string }) {
  const [rows, setRows] = useState<ContactAgentView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getContactAgentStatus(contactId));
    } catch {
      setRows([]);
    }
  }, [contactId]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Tiempo real con el MISMO SSE compartido de la Bandeja: si el agente se
  // pausa o reactiva en otro lado (worker, "Reactivar" del hilo, otro vendedor),
  // el interruptor se actualiza solo.
  const idsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    idsRef.current = new Set((rows ?? []).map((r) => r.conversationId));
  }, [rows]);
  useInboxStream((event) => {
    if (event.type === "reload") return void load();
    if (event.type === "conversation.updated" && idsRef.current.has(event.conversationId)) void load();
  });

  async function reactivate(row: ContactAgentView) {
    setBusyId(row.conversationId);
    setError(null);
    const result = await reactivateAgent({ conversationId: row.conversationId });
    setBusyId(null);
    if (!result.ok) setError(result.message);
    await load();
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Agente IA</p>
      {rows === null ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin conversación de WhatsApp todavía.</p>
      ) : (
        rows.map((row) => {
          const channelOff = row.channelMode === "off";
          const on = row.agentState === "activo";
          const status = channelOff
            ? `Apagado en «${row.channelName}» (se enciende en la pestaña Agente IA)`
            : on
              ? "Activo"
              : `Bot apagado · ${pauseReason(row)}`;
          return (
            <div key={row.conversationId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-foreground">🤖 {status}</span>
              {!channelOff && (
                <BotOffMenu conversationId={row.conversationId} paused={!on} onChanged={() => void load()} align="start" />
              )}
              {!channelOff && !on && (
                <button
                  type="button"
                  disabled={busyId === row.conversationId}
                  onClick={() => void reactivate(row)}
                  className="rounded px-2 py-0.5 text-xs font-medium text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 dark:text-sky-300"
                >
                  {busyId === row.conversationId ? "Reactivando…" : "Reactivar"}
                </button>
              )}
            </div>
          );
        })
      )}
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
