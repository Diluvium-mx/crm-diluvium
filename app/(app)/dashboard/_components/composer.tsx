"use client";

// Composer del chat (Bandeja y pop-up del Embudo). Separado de chat-thread.tsx
// para que el hilo (burbujas) y el composer evolucionen por separado.
// - Ventana de 24 h ABIERTA: texto libre, ⚡ Fragmentos, 📄 Plantillas y "/"
//   para buscar fragmentos mientras se escribe (↑↓ elige, Enter inserta, Esc
//   cierra), como las respuestas rápidas de GHL.
// - Ventana CERRADA: solo plantilla (docs/investigacion/plantillas-zernio.md).
// Al insertar un fragmento, {{vendedor}} se rellena con el nombre del usuario
// logueado; las demás variables las completa el vendedor a mano.
// Adjuntos (28-sep-2026): 📎 abre el selector, Cmd+V pega una foto o captura y
// arriba de la caja va la vista previa; el texto, si hay, sale como pie del
// PRIMER archivo. Enviar espera a que todos terminen de subir.
import { useEffect, useRef, useState } from "react";
import { Clock, Paperclip, Zap } from "lucide-react";
import { CHAT_CAPTION_MAX } from "@/lib/chat-attachments/rules";
import { AttachmentTray } from "./attachment-tray";
import type { ChatAttachments } from "./use-chat-attachments";
import { useSession } from "@/lib/auth/client";
import { listSnippets } from "@/lib/actions/snippets";
import { listWorkflowCommands } from "@/lib/actions/workflows";
import { applySlashInsert, filterSnippets, findSlashQuery } from "@/lib/snippets/slash";
import type { SnippetView } from "@/lib/snippets/types";
import { renderSnippet } from "@/lib/snippets/variables";
import { ScheduleForm } from "./schedule-form";
import { SnippetPicker } from "./snippet-picker";
import { TemplatePicker } from "./template-picker";

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
}: {
  conversationId: string;
  windowOpen: boolean;
  windowExpiresAt: Date | null;
  onSendText: (text: string) => void;
  onSendTemplate: (templateId: string, values: string[], preview: string) => void;
  /** Se programó un mensaje (A6): la franja de programados se recarga. */
  onScheduled: () => void;
  /** Adjuntos del chat (estado compartido con la capa de soltar del hilo). */
  attachments: ChatAttachments;
  /** Abre el selector de archivos (📎). */
  onPickFiles: () => void;
  onSendAttachments: (tokens: string[], caption: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const { data: session } = useSession();
  const sellerName = session?.user.name?.trim() ?? "";

  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
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
  const commandMatches =
    slashQuery !== null
      ? commands.filter((c) => c.command.slice(1).startsWith(slashQuery.toLowerCase()) || c.name.toLowerCase().includes(slashQuery.toLowerCase()))
      : [];

  // Carga los fragmentos la primera vez que se abre el buscador con "/".
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
    const tokens = attachments.items.flatMap((it) => (it.token ? [it.token] : []));
    setSendingFiles(true);
    setSendError(null);
    const result = await onSendAttachments(tokens, draft);
    setSendingFiles(false);
    if (!result.ok) {
      setSendError(result.message);
      return;
    }
    attachments.clear();
    updateDraft("", 0);
  }

  // Elegir un comando en "/": se manda tal cual; el hilo lo dispara.
  function runCommand(command: string) {
    updateDraft("", 0);
    setDismissedAt(null);
    onSendText(command);
  }

  const scheduleForm = scheduleOpen && (
    <ScheduleForm
      mode={{ type: "new", initialText: draft, templateOnly: !windowOpen }}
      conversationId={conversationId}
      windowExpiresAt={windowExpiresAt}
      onDone={() => {
        setScheduleOpen(false);
        // Lo programado sale del borrador (si se programó texto desde aquí).
        if (windowOpen) updateDraft("", 0);
        onScheduled();
      }}
      onCancel={() => setScheduleOpen(false)}
    />
  );

  if (!windowOpen) {
    return (
      <div className="border-t bg-card p-3">
        {scheduleOpen ? (
          scheduleForm
        ) : templateOpen ? (
          <TemplatePicker
            onSubmit={(templateId, values, preview) => {
              setTemplateOpen(false);
              onSendTemplate(templateId, values, preview);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTemplateOpen(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark"
            >
              📄 Enviar plantilla
            </button>
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
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
    <div className="border-t bg-card p-3">
      {scheduleForm}
      {snippetOpen && <SnippetPicker onInsert={appendFragment} onClose={() => setSnippetOpen(false)} />}
      {templateOpen && (
        <div className="mb-2">
          <TemplatePicker
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
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <span className="font-semibold text-brand-orange">⚡ Mensajes rápidos</span>
            <span className="text-muted-foreground">↑↓ elegir · Enter insertar · Esc cerrar</span>
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

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => {
            setSnippetOpen((open) => !open);
            setTemplateOpen(false);
          }}
          aria-label="Insertar mensaje rápido"
          aria-expanded={snippetOpen}
          title="Mensajes rápidos"
          className={`rounded-md border px-2.5 py-2 transition-colors ${
            snippetOpen ? "border-brand-orange bg-brand-orange/10 text-brand-orange" : "text-brand-orange hover:bg-brand-orange/10"
          }`}
        >
          <Zap className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setTemplateOpen((open) => !open);
            setSnippetOpen(false);
          }}
          aria-label="Enviar plantilla"
          aria-expanded={templateOpen}
          title="Plantillas (aprobadas por Meta)"
          className={`rounded-md border px-2.5 py-2 text-sm leading-4 transition-colors ${
            templateOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
          }`}
        >
          <span aria-hidden="true">📄</span>
        </button>
        <button
          type="button"
          onClick={onPickFiles}
          aria-label="Adjuntar archivos"
          title="Adjuntar fotos, videos o documentos"
          className="rounded-md border px-2.5 py-2 text-brand-navy transition-colors hover:bg-brand-navy/10 dark:text-sky-300"
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </button>
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
            // Con el buscador abierto, Enter NUNCA envía: inserta si hay
            // coincidencia; si no (cargando, sin resultados o error), no hace
            // nada. Para mandar un texto que empiece con "/", Esc y luego Enter.
            if (slash && event.key === "Enter" && !event.shiftKey && matches.length === 0) {
              event.preventDefault();
              // Solo si el texto es EXACTAMENTE el comando ("/tabla"), nunca por prefijo:
              // "/t" + Enter no debe mandar nada al cliente.
              const exact = commands.find((c) => c.command === draft.trim().toLowerCase());
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
          rows={1}
          aria-autocomplete="list"
          placeholder={
            hasFiles ? "Agrega un mensaje (opcional)" : "Escribe un mensaje… (/ busca mensajes rápidos · Enter envía · Shift+Enter salto de línea)"
          }
          className="max-h-32 min-h-[40px] flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
        <button
          type="button"
          onClick={() => {
            setScheduleOpen((open) => !open);
            setSnippetOpen(false);
            setTemplateOpen(false);
          }}
          // Programar no lleva adjuntos por ahora (28-sep-2026).
          disabled={hasFiles}
          aria-label="Programar mensaje"
          aria-expanded={scheduleOpen}
          title={hasFiles ? "Programar no lleva archivos por ahora" : "Programar mensaje"}
          className={`rounded-md border px-2.5 py-2 text-brand-navy transition-colors disabled:opacity-40 dark:text-sky-300 ${
            scheduleOpen ? "border-brand-navy bg-brand-navy/10" : "hover:bg-brand-navy/10"
          }`}
        >
          <Clock className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          title={hasFiles && !attachments.allReady ? "Espera a que terminen de subir los archivos" : undefined}
          className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light disabled:opacity-50"
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
