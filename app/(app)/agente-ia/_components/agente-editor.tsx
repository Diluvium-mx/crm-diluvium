"use client";

// Pestaña "Agente IA" como el editor de GHL: nombre del agente editable con lápiz y,
// justo abajo, una barra de SUBPESTAÑAS fija al hacer scroll (27-sep-2026; antes el
// conmutador «Crear | Implementar» y todo en una sola página larga): Modelos · Etapas ·
// Instrucciones (Goal) · FAQs · Opciones · Tallas y medidas · Canales · Historial (quién
// cambió qué y cuándo, 28-sep-2026) y, desde el 6-oct-2026, Seguimientos (después de Opciones: la
// tabla de casos de los seguimientos del Agente IA). "Etapas" (columnas
// del Embudo, con la regla del bot y el modelo de cada una) es el mismo editor que abre el
// lápiz del Embudo. Cada subpestaña
// muestra solo su sección; TODOS los paneles siguen montados (ocultos con `hidden`) para
// que un borrador sin guardar (Goal, Opciones, Tallas) no se pierda al cambiar, y la
// subpestaña con cambios sin guardar lleva un punto naranja. La elegida va en la URL
// (?seccion=…). Con cambios sin guardar, salir de la página pregunta (beforeunload).
// Regla del dueño: todo cambio de esta pestaña pide confirmación arriba (use-confirm.tsx).
// Sin sección "Empresa" (25-sep-2026): el Goal ya dice quién es la empresa;
// {{empresa.nombre}} sigue saliendo del nombre guardado o, si no hay, del de la
// organización. Solo sirve para personalizar al agente. Sin lógica de datos: solo llama
// a Server Actions.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { updateAgentProfile } from "@/lib/actions/agente-ia-editor";
import { COST_WINDOW_DAYS, MIN_REAL_CONVERSATIONS, MIN_REAL_RESPONSES } from "@/lib/agente-ia/model-cost";
import { AGENT_SECTIONS, type AgentSection } from "@/lib/agente-ia/sections";
import type { AgentEditorView } from "@/lib/agente-ia/types";
import { ApiStatusPanel } from "./api-status-panel";
import { BotOptionsSection } from "./bot-options";
import { BrainModelPicker, Model1Picker } from "./brain-model-picker";
import { ChannelSwitches } from "./channel-switches";
import { FaqEditor } from "./faq-editor";
import { FollowUpRulesSection } from "./followup-rules-section";
import { GoalEditor } from "./goal-editor";
import { ScheduledBanner } from "./schedule-controls";
import { HistoryPanel } from "./history-panel";
import { SizeRangesSection } from "./size-ranges-section";
import { StagesEditor } from "../../_components/stages-editor";
import { useConfirm } from "./use-confirm";
import { useLogoMotions } from "./use-logo-motions";
import type { SizeRange } from "@/lib/contacts/sizes";
import type { FollowUpTableInput } from "@/lib/followups/tabla";
import type { FollowUpTableLastChange } from "@/lib/actions/agente-ia-seguimientos";

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
// del cambio de modelo); aquí solo se edita. «Guardar» pide confirmación arriba.
function AgentName({ shown, onSaved }: { shown: string; onSaved: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shown);
  const [invalid, setInvalid] = useState<string | null>(null);
  const confirm = useConfirm();

  function cancel() {
    setValue(shown);
    setEditing(false);
    setInvalid(null);
    confirm.clearError();
  }

  function save() {
    const name = value.trim();
    if (name === shown) {
      cancel();
      return;
    }
    // Lo mismo que valida el servidor (profileSchema): sin pop-up si ni se puede guardar.
    if (!name) {
      setInvalid("El agente necesita un nombre.");
      return;
    }
    setInvalid(null);
    confirm.ask({
      title: `¿Cambiar el nombre del agente de ${shown} a ${name}?`,
      // El nombre llega al modelo solo por {{agente.nombre}}; el Goal de hoy escribe el nombre tal cual.
      body: "Es el nombre que se ve en el CRM. El agente se presenta como lo diga el Goal («Eres …»): si quieres que use el nuevo nombre, cámbialo también ahí.",
      confirmLabel: "Sí, cambiar",
      pendingLabel: "Guardando…",
      done: `Listo: el agente se llama ${name}`,
      run: () => updateAgentProfile({ agentName: value }),
      onDone: () => {
        onSaved(name);
        setEditing(false);
      },
    });
  }

  // confirm.ui va siempre en el mismo lugar: el aviso "Listo…" sobrevive al cerrar la edición.
  return (
    <>
      {!editing ? (
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">{shown}</h1>
          <button
            type="button"
            onClick={() => {
              setValue(shown);
              setEditing(true);
            }}
            aria-label="Editar el nombre del agente"
            title="Editar el nombre"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✎
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            aria-label="Nombre del agente"
            className="rounded border border-black/15 bg-background px-2 py-1 text-lg font-semibold text-foreground dark:border-white/15"
          />
          <button type="button" disabled={confirm.pending} onClick={save} className="rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
            {confirm.pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" disabled={confirm.pending} onClick={cancel} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          {(invalid ?? confirm.error) && <span className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{invalid ?? confirm.error}</span>}
        </div>
      )}
      {confirm.ui}
    </>
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

const tabId = (s: AgentSection) => `agente-tab-${s}`;
const panelId = (s: AgentSection) => `agente-panel-${s}`;

type Dirty = Partial<Record<AgentSection, boolean>>;

export function AgenteEditor({
  data,
  sizeRanges,
  followUps,
  initialSection,
  canSeeSellers,
}: {
  data: AgentEditorView;
  sizeRanges: SizeRange[];
  followUps: { table: FollowUpTableInput; lastChange: FollowUpTableLastChange | null };
  initialSection: AgentSection;
  canSeeSellers: boolean;
}) {
  const [section, setSection] = useState<AgentSection>(initialSection);
  const [agentName, setAgentName] = useState(data.agentName);
  const [dirty, setDirty] = useState<Dirty>({});
  // Un solo sorteo por página para Modelo 1 y Modelo 2: la misma marca se mueve igual en los dos.
  const logoMotions = useLogoMotions();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<AgentSection, HTMLButtonElement | null>>>({});

  // Un callback estable por sección (los hijos lo usan en un efecto).
  const markDirty = useCallback((s: AgentSection, value: boolean) => setDirty((d) => (Boolean(d[s]) === value ? d : { ...d, [s]: value })), []);
  const goalDirty = useCallback((v: boolean) => markDirty("goal", v), [markDirty]);
  const optionsDirty = useCallback((v: boolean) => markDirty("opciones", v), [markDirty]);
  const followUpsDirty = useCallback((v: boolean) => markDirty("seguimientos", v), [markDirty]);
  const sizesDirty = useCallback((v: boolean) => markDirty("tallas", v), [markDirty]);
  const stagesDirty = useCallback((v: boolean) => markDirty("etapas", v), [markDirty]);
  const anyDirty = Object.values(dirty).some(Boolean);

  // Salir de la página (recargar, cerrar, otra URL) con cambios sin guardar pregunta.
  useEffect(() => {
    if (!anyDirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // En celular la barra se desliza en horizontal: la subpestaña elegida queda a la vista
  // (sin mover la página en vertical).
  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[section];
    if (!list || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 16);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 16;
  }, [section]);

  function select(next: AgentSection) {
    if (next === section) return;
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("seccion", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // Si la barra ya estaba pegada arriba, la sección nueva empieza desde su inicio.
    const top = sentinelRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) window.scrollBy({ top });
  }

  function onTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const n = AGENT_SECTIONS.length;
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % n;
    else if (event.key === "ArrowLeft") next = (index - 1 + n) % n;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else return;
    event.preventDefault();
    const id = AGENT_SECTIONS[next].id;
    select(id);
    tabRefs.current[id]?.focus();
  }

  const panel = (s: AgentSection, children: React.ReactNode) => (
    <div role="tabpanel" id={panelId(s)} aria-labelledby={tabId(s)} hidden={section !== s} className="flex flex-col gap-4">
      {children}
    </div>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <AgentName shown={agentName} onSaved={setAgentName} />
      </header>

      {/* Marca dónde empieza la barra: si ya pasó hacia arriba, la barra está pegada. */}
      <div ref={sentinelRef} aria-hidden="true" className="-mb-4 h-0" />
      {/* Fija arriba al hacer scroll (la página se desliza en la ventana: app/(app)/layout.tsx). */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-black/10 bg-background/95 px-4 backdrop-blur dark:border-white/10">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Secciones del agente"
          // Móvil: las subpestañas se acomodan en varios renglones (nada se desliza de
          // lado, solo el Embudo); desde md, un renglón que se desliza como siempre.
          className="relative flex min-w-0 flex-wrap gap-1 md:flex-nowrap md:overflow-x-auto md:overscroll-x-contain md:[scrollbar-width:thin]"
        >
          {AGENT_SECTIONS.map((s, i) => {
            const selected = section === s.id;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabRefs.current[s.id] = el;
                }}
                id={tabId(s.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId(s.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(s.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  selected
                    ? "border-brand-navy font-medium text-foreground dark:border-sky-300"
                    : "border-transparent text-foreground/70 hover:text-foreground"
                }`}
              >
                {s.label}
                {dirty[s.id] && (
                  <>
                    <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-brand-orange" />
                    <span className="sr-only"> (cambios sin guardar)</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {panel(
        "modelos",
        <Section
          title="Modelos"
          hint={`Los modelos que piensan y redactan las respuestas: cada etapa del Embudo usa el Modelo 1 o el Modelo 2. ${costHint(data.costBasis)}`}
        >
          <SubTitle title="Modelo 1" hint="Por defecto GPT-5.6 Luna: el más económico, para las primeras preguntas." />
          <Model1Picker options={data.model1Options} value={data.modelo1} agentName={agentName} motions={logoMotions} />
          <SubTitle title="Modelo 2" hint="Por defecto Claude Sonnet 5: el más capaz, para datos bancarios y comprobantes." />
          <BrainModelPicker options={data.brainOptions} value={data.modeloCerebro} agentName={agentName} motions={logoMotions} />
          <SubTitle title="Qué modelo atiende cada etapa" hint="Se usa la etapa del contacto en el momento de responder. Se elige por etapa en la subpestaña Etapas." />
          <button
            type="button"
            onClick={() => select("etapas")}
            className="self-start rounded border border-black/15 px-3 py-1.5 text-sm text-foreground hover:bg-muted dark:border-white/15"
          >
            Ir a Etapas →
          </button>
          <ApiStatusPanel providers={data.apiProviders} />
        </Section>,
      )}
      {panel(
        "etapas",
        <Section
          title="Etapas del embudo"
          hint="Las columnas del Embudo. El agente recibe esta lista (clave, nombre y regla, en este orden) en cada respuesta y solo avanza hacia adelante; el modelo de la etapa del contacto contesta."
        >
          <StagesEditor
            model1Label={data.model1Options.find((o) => o.id === data.modelo1)?.label ?? data.modelo1}
            model2Label={data.brainOptions.find((o) => o.id === data.modeloCerebro)?.label ?? data.modeloCerebro}
            onDirtyChange={stagesDirty}
          />
        </Section>,
      )}
      {panel(
        "goal",
        <Section title="Instrucciones (Goal)" hint="Cómo se comporta el agente: lo que dice aquí es lo único que sigue, junto con las preguntas frecuentes.">
          <ScheduledBanner scheduled={data.scheduled} />
          <GoalEditor goal={data.goal} scheduledGoal={data.scheduled?.goal ?? null} versions={data.goalVersions} onDirtyChange={goalDirty} />
        </Section>,
      )}
      {panel(
        "faqs",
        <Section title="FAQs" hint="Preguntas frecuentes que el agente usa para responder.">
          <ScheduledBanner scheduled={data.scheduled} />
          <FaqEditor faqs={data.faqs} scheduledFaqs={data.scheduled?.faqs ?? null} versions={data.faqVersions} />
        </Section>,
      )}
      {panel(
        "opciones",
        <Section title="Opciones" hint="Cómo se comporta el Agente IA, como las opciones de Ángela en GHL. Los valores de fábrica son el comportamiento de siempre; los cambios se guardan juntos con «Guardar cambios» y aplican en menos de un minuto, sin redesplegar.">
          <BotOptionsSection options={data.options} lastChange={data.optionsLastChange} onDirtyChange={optionsDirty} />
        </Section>,
      )}
      {panel(
        "seguimientos",
        <Section
          title="Seguimientos"
          hint="Cuándo y para qué le escribe el Agente IA a un cliente que dejó de contestar, por caso. Los valores de fábrica son los de siempre; los cambios se guardan juntos con «Guardar cambios» y aplican en menos de un minuto."
        >
          <FollowUpRulesSection table={followUps.table} lastChange={followUps.lastChange} onDirtyChange={followUpsDirty} />
        </Section>,
      )}
      {panel(
        "tallas",
        <Section title="Tallas y medidas" hint="Qué tamaño corresponde a cada ancho de entrada, por línea (mini y estándar).">
          <SizeRangesSection initial={sizeRanges} onDirtyChange={sizesDirty} />
        </Section>,
      )}
      {panel(
        "canales",
        <Section title="Canales" hint="Encendido = el agente responde todo en ese canal; se pausa en una conversación solo cuando un vendedor contesta.">
          <ChannelSwitches channels={data.channels} />
        </Section>,
      )}
      {panel(
        "historial",
        <Section title="Historial" hint="Quién cambió qué y cuándo (hora de Mazatlán), lo más nuevo arriba: opciones, Goal y FAQs, modelos, etapas, canales, workflows y pausas del agente por chat.">
          <HistoryPanel active={section === "historial"} canSeeSellers={canSeeSellers} />
        </Section>,
      )}
    </div>
  );
}
