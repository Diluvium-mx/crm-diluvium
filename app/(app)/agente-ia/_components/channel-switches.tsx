"use client";

// Subpestaña "Canales" de la pestaña Agente IA: los canales NO archivados (28-sep-2026: el
// sandbox y el número de prueba se ocultan, no se borran) con su interruptor
// Apagado / Encendido. Encender Y apagar piden confirmación arriba antes de guardar
// (regla del dueño, 27-sep-2026; use-confirm.tsx). Sin lógica de datos: solo llama a
// setChannelAgentMode.
import { useState } from "react";
import { setChannelAgentMode } from "@/lib/actions/agente-ia-settings";
import { AGENT_MODE_LABEL, type AgentModeValue } from "@/lib/agente-ia/settings";
import type { AgentActionResult, ChannelAgentView } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";

const MODE_HINT: Record<AgentModeValue, string> = {
  off: "El agente no hace nada en este canal.",
  auto: "Responde todo a los clientes. Se pausa en una conversación solo cuando un vendedor contesta (se reactiva con «Activar»).",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// La acción truena si algo falla; aquí se vuelve un resultado para el pop-up.
async function saveMode(channelId: string, mode: AgentModeValue): Promise<AgentActionResult> {
  try {
    await setChannelAgentMode({ channelId, mode });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: errorMessage(e, "No se pudo cambiar el modo.") };
  }
}

function ChannelSwitch({ channel }: { channel: ChannelAgentView }) {
  const [mode, setMode] = useState<AgentModeValue>(channel.mode);
  const confirm = useConfirm();

  function choose(next: AgentModeValue) {
    if (next === mode) return;
    const name = channel.displayName;
    const on = next === "auto";
    confirm.ask({
      title: on ? `¿Encender el agente en ${name}?` : `¿Apagar el agente en ${name}?`,
      body: on
        ? `El agente responderá a los clientes de «${name}» desde el siguiente mensaje. Se pausa en una conversación solo cuando un vendedor contesta.`
        : "Los clientes de ese canal dejarán de recibir respuestas automáticas. Para un solo cliente usa «Pausar agente» en el Detalle del contacto.",
      confirmLabel: on ? "Sí, encender" : "Sí, apagar",
      pendingLabel: on ? "Encendiendo…" : "Apagando…",
      done: on ? `Listo: el agente está encendido en ${name}` : `Listo: el agente está apagado en ${name}`,
      run: () => saveMode(channel.id, next),
      onDone: () => setMode(next),
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
        <div
          role="radiogroup"
          aria-label={`Modo del agente en ${channel.displayName}`}
          aria-busy={confirm.pending || undefined}
          className="flex overflow-hidden rounded border border-black/15 dark:border-white/15"
        >
          {(["off", "auto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              // Mientras guarda no se deshabilitan (ask() ignora el clic): así el foco
              // puede regresar al botón al cerrarse el pop-up.
              onClick={() => choose(m)}
              className={`px-3 py-1.5 text-sm transition-colors ${
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
      {confirm.error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.error}</span>}
      {confirm.ui}
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
