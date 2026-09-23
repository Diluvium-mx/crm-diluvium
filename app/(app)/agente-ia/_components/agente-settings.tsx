"use client";

// Ajustes del runtime del Agente IA (Fase B), estilo GHL recortado: interruptor
// por canal, tiempos, pausas, límites, respuesta y precios. Sin lógica de datos:
// solo llama a las Server Actions de lib/actions/agente-ia-settings.ts.
import { useState, useTransition } from "react";
import {
  resetModelPrice,
  setChannelAgentMode,
  updateAgentSettings,
  updateModelPrice,
} from "@/lib/actions/agente-ia-settings";
import { AGENT_MODE_LABEL, agentSettingsSchema, type AgentModeValue, type AgentSettings } from "@/lib/agente-ia/settings";
import type { AgentSettingsBundleView, ChannelAgentView, ModelPriceView } from "@/lib/agente-ia/types";

const MODE_HINT: Record<AgentModeValue, string> = {
  off: "El agente no hace nada en este canal.",
  borrador: "Genera la respuesta y la deja en la bandeja SIN enviarla.",
  auto: "Responde solo a los clientes.",
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

function NumberField({
  id,
  label,
  hint,
  unit,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="text-xs text-foreground/70">{hint}</span>}
      <span className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 rounded border border-black/15 bg-background px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15"
        />
        {unit && <span className="text-sm text-foreground/70">{unit}</span>}
      </span>
    </label>
  );
}

function ChannelSwitch({ channel }: { channel: ChannelAgentView }) {
  const [mode, setMode] = useState<AgentModeValue>(channel.mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(next: AgentModeValue) {
    if (next === mode) return;
    if (next === "auto" && !window.confirm(`El agente responderá SOLO a los clientes de «${channel.displayName}». ¿Activar el modo automático?`)) {
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
          {(["off", "borrador", "auto"] as const).map((m) => (
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

type Draft = Record<Exclude<keyof AgentSettings, "pauseOnHumanReply" | "maxRepliesPerContact">, string> & {
  pauseOnHumanReply: boolean;
  noContactCap: boolean;
  maxRepliesPerContact: string;
};

function toDraft(s: AgentSettings): Draft {
  return {
    responseDelaySeconds: String(s.responseDelaySeconds),
    maxWaitSeconds: String(s.maxWaitSeconds),
    pauseOnHumanReply: s.pauseOnHumanReply,
    handoverReactivateHours: String(s.handoverReactivateHours),
    antiLoopMaxPerHour: String(s.antiLoopMaxPerHour),
    noContactCap: s.maxRepliesPerContact === null,
    maxRepliesPerContact: String(s.maxRepliesPerContact ?? 50),
    contextMessages: String(s.contextMessages),
    maxBubbles: String(s.maxBubbles),
    dailyBudgetUsd: String(s.dailyBudgetUsd),
  };
}

function fromDraft(d: Draft): unknown {
  return {
    responseDelaySeconds: Number(d.responseDelaySeconds),
    maxWaitSeconds: Number(d.maxWaitSeconds),
    pauseOnHumanReply: d.pauseOnHumanReply,
    handoverReactivateHours: Number(d.handoverReactivateHours),
    antiLoopMaxPerHour: Number(d.antiLoopMaxPerHour),
    maxRepliesPerContact: d.noContactCap ? null : Number(d.maxRepliesPerContact),
    contextMessages: Number(d.contextMessages),
    maxBubbles: Number(d.maxBubbles),
    dailyBudgetUsd: Number(d.dailyBudgetUsd),
  };
}

function SettingsForm({ initial }: { initial: AgentSettings }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function save() {
    setError(null);
    setSavedAt(null);
    const parsed = agentSettingsSchema.safeParse(fromDraft(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los valores.");
      return;
    }
    start(async () => {
      try {
        await updateAgentSettings(parsed.data);
        setSavedAt(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        setError(errorMessage(e, "No se pudo guardar."));
      }
    });
  }

  return (
    <>
      <Section title="Tiempo de respuesta" hint="Espera a que el cliente termine de escribir para contestar todo en una sola respuesta.">
        <NumberField
          id="espera"
          label="Esperar antes de responder"
          hint="Cada mensaje nuevo del cliente reinicia la espera."
          unit="segundos"
          value={draft.responseDelaySeconds}
          onChange={set("responseDelaySeconds")}
        />
        <NumberField
          id="espera-max"
          label="Espera máxima"
          hint="Aunque el cliente siga escribiendo, responde a más tardar este tiempo después de su primer mensaje."
          unit="segundos"
          value={draft.maxWaitSeconds}
          onChange={set("maxWaitSeconds")}
        />
      </Section>

      <Section title="Pausas">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.pauseOnHumanReply}
            onChange={(e) => set("pauseOnHumanReply")(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--brand-navy)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Pausar el agente cuando un vendedor responde a mano</span>
            <span className="text-xs text-foreground/70">
              Incluye respuestas desde el celular (WhatsApp Business). Queda pausado en esa conversación hasta que alguien
              pulse «Reactivar agente» en la bandeja.
            </span>
          </span>
        </label>
        <NumberField
          id="handover"
          label="Reactivar después de «pasar a humano»"
          hint="Al transferir, el contacto recibe la etiqueta «pasar a humano» y el agente se calla este tiempo."
          unit="horas"
          value={draft.handoverReactivateHours}
          onChange={set("handoverReactivateHours")}
        />
      </Section>

      <Section title="Límites">
        <NumberField
          id="presupuesto"
          label="Presupuesto de modelos por día"
          hint="Gasto máximo de toda la organización en las últimas 24 h. Al llegar, el agente deja de responder hasta que baje."
          unit="USD"
          value={draft.dailyBudgetUsd}
          onChange={set("dailyBudgetUsd")}
        />
        <NumberField
          id="antibucle"
          label="Máximo de respuestas por conversación por hora"
          hint="Freno anti-bucle: si se alcanza, el agente se pausa y el contacto recibe la etiqueta «revisión humana»."
          value={draft.antiLoopMaxPerHour}
          onChange={set("antiLoopMaxPerHour")}
        />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Máximo de respuestas por contacto</span>
          <span className="text-xs text-foreground/70">Tope total del agente con un mismo contacto.</span>
          <label className="mt-1 flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.noContactCap}
              onChange={(e) => set("noContactCap")(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand-navy)]"
            />
            Sin tope
          </label>
          {!draft.noContactCap && (
            <NumberField id="tope-contacto" label="" value={draft.maxRepliesPerContact} onChange={set("maxRepliesPerContact")} unit="respuestas" />
          )}
        </div>
      </Section>

      <Section title="Respuesta">
        <NumberField
          id="contexto"
          label="Mensajes del historial que lee el agente"
          unit="mensajes"
          value={draft.contextMessages}
          onChange={set("contextMessages")}
        />
        <NumberField
          id="burbujas"
          label="Máximo de burbujas por respuesta"
          hint="Separadas por un salto de línea doble, con 1.5 s entre cada una."
          unit="burbujas"
          value={draft.maxBubbles}
          onChange={set("maxBubbles")}
        />
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="min-h-5 text-xs">
          {pending && <span className="text-foreground/70">Guardando…</span>}
          {!pending && error && <span className="border-l-2 border-brand-orange pl-2 text-foreground">{error}</span>}
          {!pending && !error && savedAt && <span className="text-foreground/70">Guardado a las {savedAt}</span>}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-brand-orange px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange-light disabled:opacity-60"
        >
          Guardar ajustes
        </button>
      </div>
    </>
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
        hint="Apagado por defecto. Prueba primero en «Borrador»: la respuesta aparece en la bandeja y un vendedor decide si la envía."
      >
        {bundle.channels.length === 0 ? (
          <p className="text-sm text-foreground/70">No hay canales de WhatsApp conectados.</p>
        ) : (
          bundle.channels.map((c) => <ChannelSwitch key={c.id} channel={c} />)
        )}
      </Section>

      <SettingsForm initial={bundle.settings} />

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
