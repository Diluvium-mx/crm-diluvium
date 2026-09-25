"use client";

// Pestaña "Agente IA" como el editor de GHL: nombre del agente editable con lápiz y
// dos secciones. "Crear": Modelo 1 y Modelo 2 con qué etapa atiende cada uno (Fase E;
// costo aproximado y panel "APIs de IA"), Goal y FAQs. Sin sección "Empresa" (25-sep-2026): el Goal ya dice quién es
// la empresa; {{empresa.nombre}} sigue saliendo del nombre guardado o, si no hay, del de
// la organización. "Implementar": los canales con su interruptor. Solo sirve para personalizar al agente. Sin lógica de datos: solo
// llama a Server Actions.
import { useState, useTransition } from "react";
import { updateAgentProfile } from "@/lib/actions/agente-ia-editor";
import { COST_WINDOW_DAYS, MIN_REAL_CONVERSATIONS, MIN_REAL_RESPONSES } from "@/lib/agente-ia/model-cost";
import type { AgentEditorView } from "@/lib/agente-ia/types";
import { ApiStatusPanel } from "./api-status-panel";
import { BrainModelPicker, Model1Picker } from "./brain-model-picker";
import { ChannelSwitches } from "./channel-switches";
import { FaqEditor } from "./faq-editor";
import { GoalEditor } from "./goal-editor";
import { StageModelAssignment } from "./stage-model-assignment";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-foreground/70">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// El nombre que se muestra vive en AgenteEditor (lo usa también la confirmación
// del cambio de modelo); aquí solo se edita.
function AgentName({ shown, onSaved }: { shown: string; onSaved: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await updateAgentProfile({ agentName: value });
      if (r.ok) {
        onSaved(value.trim());
        setEditing(false);
      } else setError(r.message);
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">{shown}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Editar el nombre del agente"
          title="Editar el nombre"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✎
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(shown);
            setEditing(false);
          }
        }}
        aria-label="Nombre del agente"
        className="rounded border border-black/15 bg-background px-2 py-1 text-lg font-semibold text-foreground dark:border-white/15"
      />
      <button type="button" disabled={pending} onClick={save} className="rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
        {pending ? "Guardando…" : "Guardar"}
      </button>
      {error && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</span>}
    </div>
  );
}

function SubTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {hint && <p className="text-xs text-foreground/70">{hint}</p>}
    </div>
  );
}

function costHint(basis: AgentEditorView["costBasis"]): string {
  return basis.source === "real"
    ? `Costo aproximado por cada 100 conversaciones, con el uso real de los últimos ${COST_WINDOW_DAYS} días (${basis.responses} respuestas en ${basis.conversations} conversaciones).`
    : `Costo aproximado por cada 100 conversaciones, con un perfil fijo (el uso real cuenta desde ${MIN_REAL_RESPONSES} respuestas en ${MIN_REAL_CONVERSATIONS} conversaciones de los últimos ${COST_WINDOW_DAYS} días).`;
}

export function AgenteEditor({ data }: { data: AgentEditorView }) {
  const [tab, setTab] = useState<"crear" | "implementar">("crear");
  const [agentName, setAgentName] = useState(data.agentName);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <AgentName shown={agentName} onSaved={setAgentName} />
        <div role="tablist" aria-label="Secciones del agente" className="flex overflow-hidden rounded border border-black/15 dark:border-white/15">
          {(["crear", "implementar"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm transition-colors ${
                tab === t ? "bg-brand-navy text-white" : "bg-background text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {t === "crear" ? "Crear" : "Implementar"}
            </button>
          ))}
        </div>
      </header>

      {tab === "crear" ? (
        <>
          <Section
            title="Modelos"
            hint={`Los modelos que piensan y redactan las respuestas: cada etapa del Embudo usa el Modelo 1 o el Modelo 2. ${costHint(data.costBasis)}`}
          >
            <SubTitle title="Modelo 1" hint="Por defecto GPT-5.6 Luna: el más económico, para las primeras preguntas." />
            <Model1Picker options={data.model1Options} value={data.modelo1} agentName={agentName} />
            <SubTitle title="Modelo 2" hint="Por defecto Claude Sonnet 5: el más capaz, para datos bancarios y comprobantes." />
            <BrainModelPicker options={data.brainOptions} value={data.modeloCerebro} agentName={agentName} />
            <SubTitle title="Qué modelo atiende cada etapa" hint="Se usa la etapa del contacto en el momento de responder." />
            <StageModelAssignment
              value={data.etapasModelo1}
              model1Label={data.model1Options.find((o) => o.id === data.modelo1)?.label ?? data.modelo1}
              model2Label={data.brainOptions.find((o) => o.id === data.modeloCerebro)?.label ?? data.modeloCerebro}
            />
            <ApiStatusPanel providers={data.apiProviders} />
          </Section>
          <Section title="Instrucciones (Goal)" hint="Cómo se comporta el agente: lo que dice aquí es lo único que sigue, junto con las preguntas frecuentes.">
            <GoalEditor goal={data.goal} versions={data.goalVersions} />
          </Section>
          <Section title="FAQs" hint="Preguntas frecuentes que el agente usa para responder.">
            <FaqEditor faqs={data.faqs} versions={data.faqVersions} />
          </Section>
        </>
      ) : (
        <Section title="Canales" hint="Encendido = el agente responde todo en ese canal; se pausa en una conversación solo cuando un vendedor contesta.">
          <ChannelSwitches channels={data.channels} />
        </Section>
      )}
    </div>
  );
}
