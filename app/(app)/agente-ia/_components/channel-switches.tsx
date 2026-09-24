"use client";

// Sección "Implementar" de la pestaña Agente IA: los canales con su interruptor
// Apagado / Encendido. Sin lógica de datos: solo llama a setChannelAgentMode.
import { useState, useTransition } from "react";
import { setChannelAgentMode } from "@/lib/actions/agente-ia-settings";
import { AGENT_MODE_LABEL, type AgentModeValue } from "@/lib/agente-ia/settings";
import type { ChannelAgentView } from "@/lib/agente-ia/types";

const MODE_HINT: Record<AgentModeValue, string> = {
  off: "El agente no hace nada en este canal.",
  auto: "Responde todo a los clientes. Se pausa en una conversación solo cuando un vendedor contesta (se reactiva con «Reactivar»).",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ChannelSwitch({ channel }: { channel: ChannelAgentView }) {
  const [mode, setMode] = useState<AgentModeValue>(channel.mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(next: AgentModeValue) {
    if (next === mode) return;
    if (next === "auto" && !window.confirm(`El agente responderá SOLO a los clientes de «${channel.displayName}». ¿Encenderlo?`)) {
      return;
    }
    const previous = mode;
    setMode(next);
    setError(null);
    start(async () => {
      try {
        await setChannelAgentMode({ channelId: channel.id, mode: next });
      } catch (e) {
        setMode(previous);
        setError(errorMessage(e, "No se pudo cambiar el modo."));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-black/5 pb-3 last:border-0 last:pb-0 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{channel.displayName}</span>
          <span className="text-xs text-foreground/70">
            {channel.phoneE164 ?? "sin teléfono"}
            {!channel.isActive && " · canal desactivado"}
          </span>
        </div>
        <div role="radiogroup" aria-label={`Modo del agente en ${channel.displayName}`} className="flex overflow-hidden rounded border border-black/15 dark:border-white/15">
          {(["off", "auto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={pending}
              onClick={() => choose(m)}
              className={`px-3 py-1.5 text-sm transition-colors disabled:opacity-60 ${
                mode === m
                  ? m === "auto"
                    ? "bg-brand-orange text-white"
                    : "bg-brand-navy text-white"
                  : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {AGENT_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <span className="text-xs text-foreground/70">{MODE_HINT[mode]}</span>
      {error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</span>}
    </div>
  );
}

export function ChannelSwitches({ channels }: { channels: ChannelAgentView[] }) {
  if (channels.length === 0) return <p className="text-sm text-foreground/70">No hay canales de WhatsApp conectados.</p>;
  return (
    <div className="flex flex-col gap-3">
      {channels.map((c) => (
        <ChannelSwitch key={c.id} channel={c} />
      ))}
    </div>
  );
}
