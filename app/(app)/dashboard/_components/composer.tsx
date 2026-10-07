"use client";

// Composer del chat (Bandeja y pop-up del Embudo). Separado de chat-thread.tsx
// para que el hilo (burbujas) y el composer evolucionen por separado.
// - Ventana de 24 h ABIERTA: texto libre, ⚡ Fragmentos, 📄 Plantillas y "/"
//   para buscar fragmentos mientras se escribe (↑↓ elige, Enter inserta, Esc
//   cierra), como las respuestas rápidas de GHL.
// - Ventana CERRADA: solo plantilla (docs/investigacion/plantillas-zernio.md).
// - Instagram (docs/instagram.md): no hay plantillas. `windowOpen` ya trae la regla de
//   Instagram (un vendedor puede escribir hasta 7 días); pasado eso, la caja se bloquea.
// Al insertar un fragmento, {{vendedor}} se rellena con el nombre del usuario
// logueado; las demás variables las completa el vendedor a mano.
// Adjuntos (28-sep-2026): 📎 abre el selector, Cmd+V pega una foto o captura y
// arriba de la caja va la vista previa; el texto, si hay, sale como pie del
// PRIMER archivo. Enviar espera a que todos terminen de subir.
// 📎 con menú (30-sep-2026): «Adjunta +» (archivos del equipo) y «Multimedia»
// (fotos y videos de la Biblioteca; entran a la misma vista previa ya listos).
// La caja empieza con 2 renglones y crece sola desde el 3.º (28-sep-2026: lo
// escrito se perdía arriba); pasado el tope (max-h) se desliza por dentro.
// Seguimiento del Agente IA (2-oct-2026): píldora 🤖 en el hueco de la barra arriba de ⚡ 📄 📎
// (en el celular, al final del renglón de iconos; con la ventana cerrada, junto a "Enviar
// plantilla") y su burbuja (followup-pill.tsx). Solo cuando el chat tiene un seguimiento.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clock, Play, Zap } from "lucide-react";
import { CHAT_CAPTION_MAX } from "@/lib/chat-attachments/rules";
import type { ChatSendItem } from "@/lib/inbox/attachment-actions";
import { AttachMenu } from "./attach-menu";
import { AttachmentTray } from "./attachment-tray";
import { MultimediaPicker } from "./multimedia-picker";
import { prefetchMultimedia } from "./use-multimedia-assets";
import type { ChatAttachments } from "./use-chat-attachments";
import { useSession } from "@/lib/auth/client";
import { listSnippets } from "@/lib/actions/snippets";
import { listWorkflowCommands } from "@/lib/actions/workflows";
import { applySlashInsert, filterSnippets, findSlashQuery, normalizeForSearch } from "@/lib/snippets/slash";
import type { SnippetView } from "@/lib/snippets/types";
import { renderSnippet } from "@/lib/snippets/variables";
import { parseCommand } from "@/lib/workflows/steps";
import { ScheduleForm } from "./schedule-form";
import { SnippetPicker } from "./snippet-picker";
import { TemplatePicker } from "./template-picker";
import { useIsMobile } from "@/components/ui/use-media-query";
import { CloseX } from "@/components/ui/close-x";
import { WorkflowPicker } from "./workflow-picker";
import { bajaAlreadySeen, FollowUpPanel, FollowUpPill, markBajaSeen, useFollowUp } from "./followup-pill";

// Alto justo para el texto, entre los 2 renglones de `rows` y el max-height de la clase.
// Vacía se queda en 2 renglones: Chrome mide también el texto gris de ayuda, y
// la caja daría un brinco al escribir la primera letra. Vacía también regresa
// arriba (2-oct-2026): tras enviar un mensaje largo que se desplazaba por dentro,
// el texto gris quedaba recorrido medio renglón hacia arriba.
function fitToContent(el: HTMLTextAreaElement) {
  if (!el.value) {
    el.style.height = "";
    el.style.overflowY = "";
    el.scrollTop = 0;
    return;
  }
  const style = getComputedStyle(el);
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const max = parseFloat(style.maxHeight) || Number.POSITIVE_INFINITY;
  const scrollTop = el.scrollTop;
  el.style.height = "auto";
  const wanted = el.scrollHeight + borders;
  el.style.height = `${Math.min(wanted, max)}px`;
  el.style.overflowY = wanted > max ? "auto" : "hidden";
  el.scrollTop = scrollTop;
}

export function Composer({
  conversationId,
  windowOpen,
  windowExpiresAt,
  onSendText,
  onSendTemplate,
  onScheduled,
  attachments,
  onPickFiles,
  onSendAttachments,
  contactFirstName = "",
  contactTimePhrase = "",
  channelType = "whatsapp",
}: {
  conversationId: string;
  /** ¿Puede escribir el vendedor? WhatsApp: ventana de 24 h. Instagram: hasta 7 días. */
  windowOpen: boolean;
  /** Red de la conversación: Instagram no tiene plantillas (📄). */
  channelType?: "whatsapp" | "instagram";
  windowExpiresAt: Date | null;
  onSendText: (text: string) => void;
  onSendTemplate: (templateId: string, values: string[], preview: string) => void;
  /** Se programó un mensaje (A6): la franja de programados se recarga. */
  onScheduled: () => void;
  /** Adjuntos del chat (estado compartido con la capa de soltar del hilo). */
  attachments: ChatAttachments;
  /** Abre el selector de archivos (📎). */
  onPickFiles: () => void;
  onSendAttachments: (items: ChatSendItem[], caption: string, sendId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Primer nombre del contacto: llena solo el {{1}} de las plantillas (📄 y 🕒). */
  contactFirstName?: string;
  /** Cuándo nos escribió el cliente ("anoche"…): el {{1}} de las plantillas de seguimiento con tiempo. */
  contactTimePhrase?: string;
}) {
  // Móvil: placeholder corto (en el celular no hay Shift+Enter que explicar).
  const isMobile = useIsMobile();
  const { data: session } = useSession();
  const sellerName = session?.user.name?.trim() ?? "";

  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // ▶ Automatizaciones (solo móvil): lista de workflows para mandar con un toque.
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  // 📎: menú de dos opciones y, de ahí, Multimedia (la Biblioteca).
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [multimediaOpen, setMultimediaOpen] = useState(false);
  // 🤖 Seguimiento del Agente IA: la burbuja con sus opciones.
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const { followUp, reload: reloadFollowUp } = useFollowUp(conversationId);
  // «Se dio de baja» (131050): el aviso se abre solo la primera vez en esta computadora (6-oct-2026).
  const [bajaDismissed, setBajaDismissed] = useState<string | null>(null);
  const bajaAlert = followUp?.estado === "baja" && bajaDismissed !== followUp.contactId && !bajaAlreadySeen(followUp.contactId);
  const followUpPanelOpen = (followUpOpen || bajaAlert) && followUp !== null;
  const closeFollowUp = () => {
    setFollowUpOpen(false);
    if (followUp?.estado === "baja") {
      markBajaSeen(followUp.contactId);
      setBajaDismissed(followUp.contactId);
    }
  };
  const toggleFollowUp = () => {
    if (followUpPanelOpen) {
      closeFollowUp();
      return;
    }
    setFollowUpOpen(true);
    setSnippetOpen(false);
    setTemplateOpen(false);
    setWorkflowsOpen(false);
    setMultimediaOpen(false);
    setScheduleOpen(false);
    setAttachMenuOpen(false);
  };
  const followUpPanel = followUpPanelOpen && <FollowUpPanel followUp={followUp} onClose={closeFollowUp} onChanged={reloadFollowUp} />;
  const [snippets, setSnippets] = useState<SnippetView[] | null>(null);
  const [snippetsError, setSnippetsError] = useState(false);
  // Comandos de Automatización (Fase D): "/tabla", "/banco"… se listan bajo los
  // fragmentos y al elegir uno se ENVÍA el comando (dispara el workflow).
  const [commands, setCommands] = useState<{ id: string; name: string; command: string }[]>([]);
  const [active, setActive] = useState(0);
  // "/" que el vendedor cerró con Esc: no se vuelve a abrir mientras siga ahí.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [sendingFiles, setSendingFiles] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const hasFiles = attachments.items.length > 0;
  const captionTooLong = draft.trim().length > CHAT_CAPTION_MAX;
  const canSend = hasFiles ? attachments.allReady && !captionTooLong && !sendingFiles : Boolean(draft.trim());

  const found = windowOpen ? findSlashQuery(draft, caret) : null;
  const slash = found && found.start !== dismissedAt ? found : null;
  const slashOpen = slash !== null;
  const slashQuery = slash?.query ?? null;
  const matches = slashQuery !== null && snippets ? filterSnippets(snippets, slashQuery) : [];
  // Sin acentos ni ñ para buscar: "/taman" también encuentra /tamaños.
  const commandQuery = slashQuery !== null ? normalizeForSearch(slashQuery) : null;
  const commandMatches =
    commandQuery !== null
      ? commands.filter((c) => normalizeForSearch(c.command.slice(1)).startsWith(commandQuery) || normalizeForSearch(c.name).includes(commandQuery))
      : [];

  // Carga los fragmentos (y los comandos) la primera vez que se abre el buscador con
  // "/" o el selector ⚡ (en móvil ⚡ también lista los comandos de Automatización).
  useEffect(() => {
    if (!slashOpen || snippets !== null || snippetsError) return;
    let alive = true;
    listWorkflowCommands()
      .then((list) => {
        if (alive) setCommands(list);
      })
      .catch(() => undefined);
    listSnippets()
      .then((all) => {
        if (alive) setSnippets(all);
      })
      .catch(() => {
        if (alive) setSnippetsError(true);
      });
    return () => {
      alive = false;
    };
  }, [slashOpen, snippets, snippetsError]);

  // Coloca el cursor después de insertar (tras el render del nuevo borrador).
  useEffect(() => {
    const el = textareaRef.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [draft]);

  // Crece o encoge con cada cambio del texto (escribir, pegar, insertar, enviar).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) fitToContent(el);
  }, [draft, windowOpen]);

  // Y cuando cambia el ancho (abrir o cerrar la lista o el panel re-acomoda los renglones).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitToContent(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [windowOpen]);

  const closeAttachMenu = () => setAttachMenuOpen(false);
  // Lugar de cada archivo de la Biblioteca en la vista previa (el número que se ve en Multimedia).
  const selectedAssets = new Map<string, number>();
  attachments.items.forEach((it, i) => {
    if (it.assetId) selectedAssets.set(it.assetId, i + 1);
  });

  function fill(body: string): string {
    return sellerName ? renderSnippet(body, { vendedor: sellerName }) : body;
  }

  function updateDraft(value: string, nextCaret: number) {
    setDraft(value);
    setCaret(nextCaret);
    setActive(0);
    // Si el "/" cerrado ya no está en su lugar, se olvida el cierre.
    if (dismissedAt !== null && value[dismissedAt] !== "/") setDismissedAt(null);
  }

  // Fragmento desde el botón ⚡: se agrega al final del borrador.
  function appendFragment(body: string) {
    const text = fill(body);
    const next = draft.trim() ? `${draft.replace(/\s*$/, "")} ${text}` : text;
    pendingCaret.current = next.length;
    updateDraft(next, next.length);
  }

  // Fragmento desde "/": reemplaza "/búsqueda" en su lugar.
  function insertFromSlash(snippet: SnippetView) {
    if (!slash) return;
    const { text, caret: nextCaret } = applySlashInsert(draft, slash, fill(snippet.body));
    pendingCaret.current = nextCaret;
    updateDraft(text, nextCaret);
  }

  function submit() {
    if (!windowOpen) return;
    if (hasFiles) {
      void submitFiles();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    updateDraft("", 0);
    onSendText(text);
  }

  // Con archivos: salen uno por mensaje, en el orden de la vista previa; el texto va como pie del primero.
  async function submitFiles() {
    if (!canSend) return;
    const items = attachments.items.flatMap((it): ChatSendItem[] => (it.assetId ? [{ assetId: it.assetId }] : it.token ? [{ token: it.token }] : []));
    setSendingFiles(true);
    setSendError(null);
    try {
      const result = await onSendAttachments(items, draft, attachments.sendId());
      if (!result.ok) {
        setSendError(result.message);
        return;
      }
      attachments.clear();
      setMultimediaOpen(false);
      updateDraft("", 0);
    } catch {
      // Sesión vencida, red caída o un deploy a la mitad: el botón no se queda trabado.
      setSendError("No se pudieron enviar los archivos. Revisa tu conexión y vuelve a intentarlo.");
    } finally {
      setSendingFiles(false);
    }
  }

  // Elegir un comando en "/": se manda tal cual; el hilo lo dispara.
  function runCommand(command: string) {
    updateDraft("", 0);
    setDismissedAt(null);
    onSendText(command);
  }

  const scheduleForm = scheduleOpen && (
    <ScheduleForm
      firstName={contactFirstName}
      timePhrase={contactTimePhrase}
      mode={{ type: "new", initialText: draft, templateOnly: !windowOpen }}
      conversationId={conversationId}
      windowExpiresAt={windowExpiresAt}
      channelType={channelType}
      onDone={() => {
        setScheduleOpen(false);
        // Lo programado sale del borrador (si se programó texto desde aquí).
        if (windowOpen) updateDraft("", 0);
        onScheduled();
      }}
      onCancel={() => setScheduleOpen(false)}
    />
  );

  if (!windowOpen && channelType === "instagram") {
    return (
      <div className="border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="rounded-md border border-dashed px-3 py-2 text-center text-sm text-muted-foreground">
          Pasaron más de 7 días desde el último mensaje del cliente: Instagram no deja escribirle hasta que vuelva a escribir.
        </p>
      </div>
    );
  }

  if (!windowOpen) {
    return (
      <div className="border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {followUpPanel}
        {scheduleOpen ? (
          scheduleForm
        ) : templateOpen ? (
          <TemplatePicker
            firstName={contactFirstName}
            timePhrase={contactTimePhrase}
            onSubmit={(templateId, values, preview) => {
              setTemplateOpen(false);
              onSendTemplate(templateId, values, preview);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        ) : (
          <div className="flex gap-2">
            {followUp && <FollowUpPill followUp={followUp} open={followUpPanelOpen} onToggle={toggleFollowUp} className="flex max-w-[45%] self-center" />}
            <button
              type="button"
              onClick={() => {
                setTemplateOpen(true);
                setFollowUpOpen(false);
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark"
            >
              📄 Enviar plantilla
            </button>
            <button
              type="button"
              onClick={() => {
                setScheduleOpen(true);
                setFollowUpOpen(false);
              }}
              aria-label="Programar plantilla"
              title="Programar plantilla"
              className="rounded-md border px-3 py-2 text-brand-navy transition-colors hover:bg-brand-navy/10 dark:text-sky-300"
            >
              <Clock className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {scheduleForm}
      {followUpPanel}
      {snippetOpen && <SnippetPicker onInsert={appendFragment} onClose={() => setSnippetOpen(false)} />}
      {workflowsOpen && <WorkflowPicker onRun={runCommand} onClose={() => setWorkflowsOpen(false)} />}
      {multimediaOpen && <MultimediaPicker selected={selectedAssets} onToggle={attachments.toggleLibrary} onClose={() => setMultimediaOpen(false)} />}
      {templateOpen && (
        <div className="mb-2">
          <TemplatePicker
            firstName={contactFirstName}
            timePhrase={contactTimePhrase}
            onSubmit={(templateId, values, preview) => {
              setTemplateOpen(false);
              onSendTemplate(templateId, values, preview);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        </div>
      )}

      {(attachments.notices.length > 0 || sendError) && (
        <div role="alert" className="mb-2 flex items-start justify-between gap-3 rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 text-xs">
          <ul className="space-y-0.5">
            {attachments.notices.map((n, i) => (
              <li key={i}>⚠ {n}</li>
            ))}
            {sendError && <li>⚠ {sendError}</li>}
          </ul>
          <button
            type="button"
            onClick={() => {
              attachments.dismissNotices();
              setSendError(null);
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}
      <AttachmentTray items={attachments.items} onRemove={attachments.remove} />

      {slashOpen && (
        <div className="mb-2 overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
            <span className="font-semibold text-brand-orange">⚡ Mensajes rápidos</span>
            <span className="hidden text-muted-foreground md:inline">↑↓ elegir · Enter insertar · Esc cerrar</span>
            {/* Móvil: sin Esc; la ✕ roja cierra el buscador (el "/" se queda escrito). */}
            <CloseX
              size="sm"
              label="Cerrar mensajes rápidos"
              onClick={() => {
                if (slash) setDismissedAt(slash.start);
              }}
            />
          </div>
          {commandMatches.length > 0 && (
            <ul aria-label="Automatizaciones" className="border-b py-1">
              {commandMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      runCommand(c.command);
                    }}
                    onTouchEnd={(event) => {
                      event.preventDefault();
                      runCommand(c.command);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-orange/10"
                  >
                    <span className="rounded bg-brand-navy px-1.5 py-0.5 font-mono text-[11px] text-brand-white">{c.command}</span>
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">▶ ejecutar</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {snippetsError ? (
            <p className="px-3 py-3 text-sm text-brand-orange">No se pudieron cargar los mensajes rápidos.</p>
          ) : snippets === null ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Cargando mensajes rápidos…</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {snippets.length === 0 ? "No hay mensajes rápidos. Créalos en la sección “Mensajes rápidos”." : "Sin coincidencias."}
            </p>
          ) : (
            <ul role="listbox" aria-label="Mensajes rápidos" className="max-h-56 overflow-y-auto py-1">
              {matches.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    // mousedown: que el textarea no pierda el foco antes de insertar.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertFromSlash(s);
                    }}
                    onTouchEnd={(event) => {
                      event.preventDefault();
                      insertFromSlash(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-orange/10" : ""}`}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Móvil (< sm): dos renglones —⚡ 📄 📎 🕒 arriba; caja + Enviar abajo— con
          `order` y un corte de renglón (basis-full). Desde sm, el renglón único de
          siempre en el orden del DOM (sm:order-none). */}
      <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
        {/* ⚡ 📄 📎 en su columna: arriba, en el hueco que deja la caja de dos renglones, la
            píldora 🤖 del seguimiento (desde sm; en el celular va al final del renglón). */}
        <div className="order-1 flex min-w-0 flex-col gap-1 sm:order-none">
          {/* w-0 + min-w-full: la píldora mide lo mismo que ⚡ 📄 📎 y nunca ensancha la columna (si no, la caja
              de texto se encoge con la lista y el Detalle abiertos; decisión del dueño, 6-oct-2026). */}
          {followUp && <FollowUpPill followUp={followUp} open={followUpPanelOpen} onToggle={toggleFollowUp} className="hidden w-0 min-w-full sm:flex" />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSnippetOpen((open) => !open);
                setFollowUpOpen(false);
                setTemplateOpen(false);
                setWorkflowsOpen(false);
                setMultimediaOpen(false);
              }}
              aria-label="Insertar mensaje rápido"
              aria-expanded={snippetOpen}
              title="Mensajes rápidos"
              className={`order-1 rounded-md border px-2.5 py-2 transition-colors sm:order-none ${
                snippetOpen ? "border-brand-orange bg-brand-orange/10 text-brand-orange" : "text-brand-orange hover:bg-brand-orange/10"
              }`}
            >
              <Zap className="size-4" aria-hidden="true" />
            </button>
            {channelType === "whatsapp" && (
              <button
                type="button"
                onClick={() => {
                  setTemplateOpen((open) => !open);
                  setFollowUpOpen(false);
                  setSnippetOpen(false);
                  setWorkflowsOpen(false);
                  setMultimediaOpen(false);
                }}
                aria-label="Enviar plantilla"
                aria-expanded={templateOpen}
                title="Plantillas (aprobadas por Meta)"
                className={`order-1 rounded-md border px-2.5 py-2 text-sm leading-4 transition-colors sm:order-none ${
                  templateOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
                }`}
              >
                <span aria-hidden="true">📄</span>
              </button>
            )}
            <AttachMenu
              open={attachMenuOpen}
              onToggle={() => {
                // Al abrir el menú ya se pide la lista de Multimedia: cuando se toca, ya está.
                if (!attachMenuOpen) void prefetchMultimedia().catch(() => undefined);
                setAttachMenuOpen((open) => !open);
                setFollowUpOpen(false);
              }}
              onClose={closeAttachMenu}
              onPickFiles={onPickFiles}
              onMultimedia={() => {
                setMultimediaOpen(true);
                setSnippetOpen(false);
                setTemplateOpen(false);
                setWorkflowsOpen(false);
                setScheduleOpen(false);
              }}
              className="order-1 sm:order-none"
            />
          </div>
        </div>
        {/* ▶ Automatizaciones: SOLO móvil (md:hidden). Manda un workflow con un toque; en
            escritorio se escribe su comando con "/". */}
        <button
          type="button"
          onClick={() => {
            setWorkflowsOpen((open) => !open);
            setFollowUpOpen(false);
            setSnippetOpen(false);
            setTemplateOpen(false);
            setMultimediaOpen(false);
          }}
          aria-label="Automatizaciones"
          aria-expanded={workflowsOpen}
          title="Automatizaciones (mandar tabla, videos, datos bancarios…)"
          className={`order-1 rounded-md border px-2.5 py-2 text-brand-navy transition-colors md:hidden dark:text-sky-300 ${
            workflowsOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
          }`}
        >
          <Play className="size-4" aria-hidden="true" />
        </button>
        <div aria-hidden="true" className="order-2 h-0 basis-full sm:hidden" />
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          // Cmd+V con una foto o captura de pantalla: se adjunta (el texto se pega normal).
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            attachments.addFiles(files);
          }}
          onKeyDown={(event) => {
            // Móvil (decisión del dueño, 29-sep-2026): Enter SIEMPRE baja de renglón y el
            // texto conserva sus saltos; lo único que manda es el botón Enviar. Los
            // atajos de Enter (enviar, insertar del buscador "/") son de escritorio.
            if (isMobile && event.key === "Enter") return;
            // Con el buscador abierto, Enter NUNCA envía: inserta si hay
            // coincidencia; si no (cargando, sin resultados o error), no hace
            // nada. Para mandar un texto que empiece con "/", Esc y luego Enter.
            if (slash && event.key === "Enter" && !event.shiftKey && matches.length === 0) {
              event.preventDefault();
              // Solo si el texto es EXACTAMENTE el comando ("/tabla"), nunca por prefijo:
              // "/t" + Enter no debe mandar nada al cliente.
              const typed = parseCommand(draft);
              const exact = typed ? commands.find((c) => c.command === typed) : undefined;
              if (exact) runCommand(exact.command);
              return;
            }
            if (slash && matches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => (i + 1) % matches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => (i - 1 + matches.length) % matches.length);
                return;
              }
              if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                event.preventDefault();
                insertFromSlash(matches[Math.min(active, matches.length - 1)]);
                return;
              }
            }
            if (slash && event.key === "Escape") {
              event.preventDefault();
              setDismissedAt(slash.start);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          aria-autocomplete="list"
          placeholder={
            hasFiles
              ? "Agrega un mensaje (opcional)"
              : isMobile
                ? "Escribe un mensaje… (/ busca mensajes rápidos)"
                : "Escribe un mensaje… (/ busca mensajes rápidos · Enter envía · Shift+Enter salto de línea)"
          }
          className="order-3 max-h-[40vh] min-w-0 flex-1 resize-none overflow-y-hidden rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30 sm:order-none"
        />
        <button
          type="button"
          onClick={() => {
            setScheduleOpen((open) => !open);
            setFollowUpOpen(false);
            setSnippetOpen(false);
            setTemplateOpen(false);
            setWorkflowsOpen(false);
            setMultimediaOpen(false);
          }}
          // Programar no lleva adjuntos por ahora (28-sep-2026).
          disabled={hasFiles}
          aria-label="Programar mensaje"
          aria-expanded={scheduleOpen}
          title={hasFiles ? "Programar no lleva archivos por ahora" : "Programar mensaje"}
          className={`order-1 rounded-md border px-2.5 py-2 text-brand-navy transition-colors disabled:opacity-40 sm:order-none dark:text-sky-300 ${
            scheduleOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
          }`}
        >
          <Clock className="size-4" aria-hidden="true" />
        </button>
        {followUp && <FollowUpPill followUp={followUp} open={followUpPanelOpen} onToggle={toggleFollowUp} className="order-1 ml-auto flex max-w-[50%] self-center sm:hidden" />}
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          title={hasFiles && !attachments.allReady ? "Espera a que terminen de subir los archivos" : undefined}
          className="order-3 rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light disabled:opacity-50 sm:order-none"
        >
          {sendingFiles ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {hasFiles && (
        <p className={`mt-1 text-right text-[11px] ${captionTooLong ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
          {draft.trim().length.toLocaleString("es-MX")} / {CHAT_CAPTION_MAX.toLocaleString("es-MX")}
        </p>
      )}
    </div>
  );
}
