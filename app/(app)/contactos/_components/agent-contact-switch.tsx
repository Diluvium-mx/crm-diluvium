"use client";

// Interruptor del Agente IA en "Detalle del contacto" (Fase B), en el espacio
// reservado. Una fila por conversación del contacto (normalmente una, la de
// WhatsApp): encendido = el agente puede responder; apagado = pausado por un
// vendedor (se reactiva aquí o con "Reactivar" en la Bandeja). Si el canal está
// apagado en la pestaña Agente IA, el interruptor no aplica.
import { useCallback, useEffect, useState } from "react";
import { getContactAgentStatus, pauseAgent, reactivateAgent } from "@/lib/actions/agente-conversacion";
import { pauseReason } from "@/lib/agente-ia/labels";
import { AGENT_MODE_LABEL } from "@/lib/agente-ia/settings";
import type { ContactAgentView } from "@/lib/agente-ia/types";

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

  async function toggle(row: ContactAgentView) {
    setBusyId(row.conversationId);
    setError(null);
    const on = row.agentState === "activo";
    const result = on
      ? await pauseAgent({ conversationId: row.conversationId })
      : await reactivateAgent({ conversationId: row.conversationId });
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
              ? `Activo · ${AGENT_MODE_LABEL[row.channelMode]}`
              : `Pausado · ${pauseReason(row)}`;
          return (
            <div key={row.conversationId} className="flex items-start gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={!channelOff && on}
                aria-label={`Agente IA en la conversación de ${row.channelName}`}
                disabled={channelOff || busyId === row.conversationId}
                onClick={() => void toggle(row)}
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  !channelOff && on ? "bg-brand-navy" : "bg-muted-foreground/40"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    !channelOff && on ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-xs text-foreground">🤖 {status}</span>
            </div>
          );
        })
      )}
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
