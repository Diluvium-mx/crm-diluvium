"use client";

// Ajustes del runtime del Agente IA (Fase B): interruptor por canal y precios.
// Desde el 23-sep-2026 no hay tiempos, pausas ni límites configurables (el agente
// se rige solo por el Goal y las FAQs). Sin lógica de datos: solo llama a las
// Server Actions de lib/actions/agente-ia-settings.ts.
import { useState, useTransition } from "react";
import { resetModelPrice, setChannelAgentMode, updateModelPrice } from "@/lib/actions/agente-ia-settings";
import { AGENT_MODE_LABEL, type AgentModeValue } from "@/lib/agente-ia/settings";
import type { AgentSettingsBundleView, ChannelAgentView, ModelPriceView } from "@/lib/agente-ia/types";

const MODE_HINT: Record<AgentModeValue, string> = {
  off: "El agente no hace nada en este canal.",
  auto: "Responde todo a los clientes. Se pausa en una conversación solo cuando un vendedor contesta (se reactiva con «Reactivar»).",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-foreground/70">{hint}</p>}
      </div>
      {children}
    </section>
  );
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

function PriceRow({ price }: { price: ModelPriceView }) {
  const effIn = price.overrideInput ?? price.defaultInput;
  const effOut = price.overrideOutput ?? price.defaultOutput;
  const [input, setInput] = useState(effIn === null ? "" : String(effIn));
  const [output, setOutput] = useState(effOut === null ? "" : String(effOut));
  const [hasOverride, setHasOverride] = useState(price.overrideInput !== null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    const i = Number(input);
    const o = Number(output);
    if (input === "" || output === "" || Number.isNaN(i) || Number.isNaN(o) || i < 0 || o < 0) {
      setMsg("Precio inválido.");
      return;
    }
    start(async () => {
      try {
        await updateModelPrice({ modelId: price.modelId, inputPerMTok: i, outputPerMTok: o });
        setHasOverride(true);
        setMsg("Guardado.");
      } catch (e) {
        setMsg(errorMessage(e, "No se pudo guardar."));
      }
    });
  }

  function reset() {
    setMsg(null);
    start(async () => {
      try {
        await resetModelPrice({ modelId: price.modelId });
        setHasOverride(false);
        setInput(price.defaultInput === null ? "" : String(price.defaultInput));
        setOutput(price.defaultOutput === null ? "" : String(price.defaultOutput));
        setMsg("Restablecido.");
      } catch (e) {
        setMsg(errorMessage(e, "No se pudo restablecer."));
      }
    });
  }

  const cell = "w-24 rounded border border-black/15 bg-background px-2 py-1 text-sm dark:border-white/15";
  return (
    <tr className="border-t border-black/5 align-top dark:border-white/5">
      <td className="py-2 pr-3">
        <div className="text-sm text-foreground">{price.label}</div>
        <div className="text-xs text-foreground/70">
          {price.providerLabel} · {price.cacheNote}
        </div>
        {price.defaultInput === null && !hasOverride && (
          <div className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">Sin precio: el gasto se registra sin costo.</div>
        )}
      </td>
      <td className="py-2 pr-2">
        <input aria-label={`Entrada ${price.label}`} className={cell} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
      </td>
      <td className="py-2 pr-2">
        <input aria-label={`Salida ${price.label}`} className={cell} inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} />
      </td>
      <td className="py-2">
        <div className="flex flex-col items-start gap-1">
          <button type="button" onClick={save} disabled={pending} className="text-sm font-medium text-brand-navy hover:underline disabled:opacity-50 dark:text-white">
            Guardar
          </button>
          {hasOverride && (
            <button type="button" onClick={reset} disabled={pending} className="text-xs text-foreground/70 hover:underline disabled:opacity-50">
              Restablecer
            </button>
          )}
          {msg && <span className="text-xs text-foreground/70">{msg}</span>}
        </div>
      </td>
    </tr>
  );
}

export function AgenteSettings({ bundle }: { bundle: AgentSettingsBundleView }) {
  const { knowledge } = bundle;
  return (
    <>
      <Section title="Conocimiento del agente">
        {knowledge.goalChars > 0 ? (
          <p className="text-sm text-foreground">
            Goal cargado ({knowledge.goalChars.toLocaleString("es-MX")} caracteres) · {knowledge.faqsEnabled} preguntas
            frecuentes activas.
          </p>
        ) : (
          <p className="border-l-2 border-brand-orange pl-2 text-sm text-foreground">
            Sin Goal cargado: el agente no responderá hasta que se cargue su conocimiento.
          </p>
        )}
      </Section>

      <Section
        title="Interruptor por canal"
        hint="Encendido = el agente responde solo a los clientes del canal. Apagado por defecto."
      >
        {bundle.channels.length === 0 ? (
          <p className="text-sm text-foreground/70">No hay canales de WhatsApp conectados.</p>
        ) : (
          bundle.channels.map((c) => <ChannelSwitch key={c.id} channel={c} />)
        )}
      </Section>

      <Section
        title="Precios de los modelos"
        hint="USD por millón de tokens. Se usan para calcular el costo de cada respuesta; cambiarlos no requiere volver a desplegar."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-foreground/70">
                <th className="pb-2 font-medium">Modelo</th>
                <th className="pb-2 font-medium">Entrada</th>
                <th className="pb-2 font-medium">Salida</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {bundle.prices.map((p) => (
                <PriceRow key={p.modelId} price={p} />
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
