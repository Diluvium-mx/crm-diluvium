"use client";

// Estado del Agente IA en "Detalle del contacto" (Fase B; rediseño del 26-sep-2026). Es el
// ÚNICO control del agente por conversación (se quitó del encabezado del chat): el estado
// y un solo botón. Activo → "Pausar agente" (8/12/24 h, fecha y hora o indefinidamente);
// pausado → "Activar". Una sola fila: la conversación que se está viendo (la Bandeja pasa
// la suya; el pop-up del Embudo abre la más reciente, que es la primera). Un contacto con
// chat en dos canales (p. ej. el sandbox y el número de prueba) mostraba dos filas.
// Si el canal está apagado en la pestaña Agente IA, no aplica.
import { useCallback, useEffect, useRef, useState } from "react";
import { getContactAgentStatus, reactivateAgent } from "@/lib/actions/agente-conversacion";
import { agentStatusLabel } from "@/lib/agente-ia/labels";
import type { ContactAgentView } from "@/lib/agente-ia/types";
import { BotOffMenu } from "../../dashboard/_components/bot-off-menu";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";

export function AgentContactSwitch({ contactId, conversationId }: { contactId: string; conversationId?: string }) {
  const [rows, setRows] = useState<ContactAgentView[] | null>(null);
  const [busy, setBusy] = useState(false);
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

  // La conversación que se está viendo; sin ella, la más reciente (vienen ordenadas).
  const row = rows === null ? null : (rows.find((r) => r.conversationId === conversationId) ?? rows[0] ?? null);

  // Tiempo real con el MISMO SSE compartido de la Bandeja: si el agente se pausa o
  // activa en otro lado (worker, otro vendedor, una respuesta a mano), se actualiza solo.
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    idRef.current = row?.conversationId ?? null;
  }, [row]);
  useInboxStream((event) => {
    if (event.type === "reload") return void load();
    if (event.type === "conversation.updated" && event.conversationId === idRef.current) void load();
  });

  async function activate(target: ContactAgentView) {
    setBusy(true);
    setError(null);
    const result = await reactivateAgent({ conversationId: target.conversationId });
    setBusy(false);
    if (!result.ok) setError(result.message);
    await load();
  }

  const channelOff = row?.channelMode === "off";
  const on = row?.agentState === "activo";
  return (
    <div className="space-y-1.5">
      {rows === null ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : !row ? (
        <p className="text-xs text-muted-foreground">Sin conversación de WhatsApp todavía.</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${channelOff ? "bg-muted-foreground/40" : on ? "bg-emerald-500" : "bg-brand-orange"}`}
            />
            <span className="truncate">🤖 {channelOff ? `Apagado en «${row.channelName}»` : agentStatusLabel(row)}</span>
          </span>
          {!channelOff &&
            (on ? (
              <BotOffMenu conversationId={row.conversationId} paused={false} onChanged={() => void load()} align="end" />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void activate(row)}
                className="shrink-0 rounded-md bg-brand-navy px-2.5 py-1 text-xs font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
              >
                {busy ? "Activando…" : "Activar"}
              </button>
            ))}
        </div>
      )}
      {channelOff && <p className="text-xs text-muted-foreground">Se enciende en la pestaña Agente IA.</p>}
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
