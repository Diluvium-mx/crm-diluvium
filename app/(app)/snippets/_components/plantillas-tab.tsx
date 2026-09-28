"use client";

// Plantillas 📄: aprobadas por Meta, para escribir FUERA de la ventana de 24 h.
// Aquí se SINCRONIZAN, se CREAN (van a revisión de Meta), se EDITAN (solo el
// texto; vuelven a revisión) y se BORRAN (el nombre queda bloqueado 30 días en
// Meta). El ENVÍO se hace desde el chat. Ver docs/investigacion/plantillas-zernio.md.
import { useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { createTemplate, deleteTemplate, listTemplates, syncTemplates, updateTemplate } from "@/lib/actions/templates";
import {
  isTemplateEditable,
  TEMPLATE_BODY_MAX,
  templateBodyProblem,
  templateMaxIndex,
  templateNameFromLabel,
} from "@/lib/messaging/template-format";
import type { TemplateView } from "@/lib/templates/types";
import { HighlightBody } from "./highlight";

const TOKEN_CLASS = "rounded bg-brand-navy/15 px-1 font-medium text-brand-navy";
const INPUT_CLASS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

// Autenticación (códigos) no se ofrece: tiene una forma propia que este formulario no arma.
const CATEGORIES = [
  { value: "MARKETING", label: "Marketing: saludos, seguimientos y promociones" },
  { value: "UTILITY", label: "Utilidad: avisos de un pedido ya hecho" },
] as const;
type Category = (typeof CATEGORIES)[number]["value"];

const LANGUAGES = [
  { value: "es_MX", label: "Español (México)" },
  { value: "es", label: "Español" },
  { value: "en_US", label: "Inglés (EE. UU.)" },
] as const;

// Borradas (por el CRM, por Meta o en camino de borrarse): no se muestran.
const HIDDEN_STATUSES = new Set(["REMOVED", "PENDING_DELETION"]);

function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  const c = category.toUpperCase();
  if (c === "MARKETING") return "Marketing";
  if (c === "UTILITY") return "Utilidad";
  if (c === "AUTHENTICATION") return "Autenticación";
  return category;
}

function statusStyle(status: string): { label: string; className: string } {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { label: "Aprobada", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (s === "PENDING" || s === "IN_APPEAL") return { label: s === "PENDING" ? "En revisión" : "En apelación", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  if (s === "REJECTED") return { label: "Rechazada", className: "bg-red-500/10 text-red-700 dark:text-red-300" };
  if (s === "PAUSED") return { label: "Pausada por Meta", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  if (s === "DISABLED") return { label: "Desactivada por Meta", className: "bg-red-500/10 text-red-700 dark:text-red-300" };
  return { label: status, className: "bg-muted text-muted-foreground" };
}

type FormMode = { type: "new" } | { type: "edit"; template: TemplateView };

export function PlantillasTab({
  initial,
  canManage,
  sandboxChannel = false,
}: {
  initial: TemplateView[];
  canManage: boolean;
  /** Canal activo = sandbox de Zernio: sus plantillas son ajenas (ocultas); no se sincroniza ni se crea. */
  sandboxChannel?: boolean;
}) {
  const [items, setItems] = useState<TemplateView[]>(initial);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);

  const visible = useMemo(() => items.filter((t) => !HIDDEN_STATUSES.has(t.status.toUpperCase())), [items]);

  function clearMessages() {
    setError(null);
    setNote(null);
  }

  async function refresh() {
    try {
      setItems(await listTemplates());
    } catch {
      setError("No se pudo recargar la lista; recarga la página.");
    }
  }

  async function sync() {
    setSyncing(true);
    clearMessages();
    const result = await syncTemplates().catch(() => null);
    if (!result) setError("No se pudo sincronizar. Revisa tu conexión y vuelve a intentarlo.");
    else if (!result.ok) setError(result.message);
    else {
      await refresh();
      setNote(
        `Sincronizado: ${result.synced} plantilla(s) desde WhatsApp` +
          (result.removed > 0 ? `; ${result.removed} ya no existe(n) en Meta.` : "."),
      );
    }
    setSyncing(false);
  }

  async function remove(template: TemplateView) {
    if (
      !window.confirm(
        `¿Borrar la plantilla "${template.name}" (${template.language}) en Meta?\n\n` +
          `Ya no se podrá mandar, y Meta no deja volver a usar el nombre "${template.name}" durante 30 días.`,
      )
    ) {
      return;
    }
    setDeletingId(template.id);
    clearMessages();
    const result = await deleteTemplate({ id: template.id }).catch(() => null);
    if (!result) setError("No se pudo borrar. Revisa tu conexión y vuelve a intentarlo.");
    else if (!result.ok) setError(result.message);
    else {
      setItems((current) => current.filter((t) => t.id !== template.id));
      setNote(`Plantilla "${template.name}" borrada.`);
    }
    setDeletingId(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Aprobadas por Meta, para escribir fuera de las 24 h. Se envían desde el chat (📄).
        </p>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing || sandboxChannel}
              className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {syncing ? "Sincronizando…" : "Sincronizar"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearMessages();
                setForm((current) => (current?.type === "new" ? null : { type: "new" }));
              }}
              disabled={sandboxChannel}
              className="flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-navy-dark disabled:opacity-50"
            >
              <Plus className="size-4" aria-hidden="true" /> Crear plantilla
            </button>
          </div>
        )}
      </div>

      {sandboxChannel && canManage && (
        <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          El número conectado es el <strong>sandbox de Zernio</strong>: sus plantillas son de otros clientes de Zernio,
          no de Diluvium, y no se muestran. Sincronizar y crear se habilitan al conectar el número de Diluvium.
        </div>
      )}
      {note && (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {note}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {form && (
        <TemplateForm
          key={form.type === "edit" ? form.template.id : "new"}
          mode={form}
          onClose={() => setForm(null)}
          onDone={async (msg) => {
            setForm(null);
            setError(null);
            setNote(msg);
            await refresh();
          }}
        />
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {canManage ? (
            <>
              No hay plantillas todavía. Pulsa <strong>Crear plantilla</strong> para darlas de alta desde aquí, o{" "}
              <strong>Sincronizar</strong> para traer las que ya existan en WhatsApp.
            </>
          ) : (
            "No hay plantillas todavía."
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((t) => {
            const badge = statusStyle(t.status);
            const category = categoryLabel(t.category);
            const pending = t.status.toUpperCase() === "PENDING";
            return (
              <li key={t.id} className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                  <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[11px] font-medium text-brand-navy">{t.language}</span>
                  {category && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{category}</span>
                  )}
                  {canManage && !sandboxChannel && (
                    <div className="ml-auto flex gap-1">
                      {isTemplateEditable(t.status) && (
                        <button
                          type="button"
                          onClick={() => {
                            clearMessages();
                            setForm({ type: "edit", template: t });
                          }}
                          aria-label={`Editar ${t.name}`}
                          title="Editar el texto"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void remove(t)}
                        disabled={deletingId !== null}
                        aria-label={`Borrar ${t.name}`}
                        title="Borrar en Meta"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className={`size-4 ${deletingId === t.id ? "animate-pulse" : ""}`} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
                {t.bodyText && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">
                    <HighlightBody body={t.bodyText} tokenClassName={TOKEN_CLASS} />
                  </p>
                )}
                {t.variables.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {t.variables.map((v) => (
                      <span key={v.index} className={TOKEN_CLASS}>
                        {`{{${v.index}}}`}
                        {v.example ? ` · ${v.example}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {!t.sendable && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t.unsupported
                      ? "Encabezado o botón con variables: todavía no se puede mandar desde el CRM."
                      : pending
                        ? "Meta la está revisando (de minutos a 24 h). Pulsa Sincronizar para ver si ya la aprobó."
                        : "No se puede mandar hasta que Meta la apruebe."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TemplateForm({
  mode,
  onClose,
  onDone,
}: {
  mode: FormMode;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const editing = mode.type === "edit" ? mode.template : null;
  const [label, setLabel] = useState("");
  const [language, setLanguage] = useState<string>("es_MX");
  const [category, setCategory] = useState<Category>("MARKETING");
  const [body, setBody] = useState(editing?.bodyText ?? "");
  const [examples, setExamples] = useState<string[]>(editing ? editing.variables.map((v) => v.example ?? "") : []);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const name = editing ? editing.name : templateNameFromLabel(label);
  const varCount = useMemo(() => templateMaxIndex(body), [body]);
  // Ajusta la cantidad de ejemplos a las variables del cuerpo.
  const exampleValues = useMemo(() => Array.from({ length: varCount }, (_, i) => examples[i] ?? ""), [varCount, examples]);
  const problem = body.trim() ? templateBodyProblem(body, exampleValues) : null;
  const unchanged = editing !== null && body.trim() === (editing.bodyText ?? "").trim();
  const canSubmit = !busy && Boolean(name) && Boolean(body.trim()) && !problem && !unchanged;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    const clean = exampleValues.map((v) => v.trim());
    const result = editing
      ? await updateTemplate({ id: editing.id, bodyText: body.trim(), bodyExample: clean }).catch(() => null)
      : await createTemplate({ name, language, category, bodyText: body.trim(), bodyExample: clean }).catch(() => null);
    setBusy(false);
    if (!result) {
      setFormError("No se pudo mandar a Meta. Revisa tu conexión y vuelve a intentarlo.");
      return;
    }
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    await onDone(
      editing
        ? `Plantilla "${name}" editada: Meta la vuelve a revisar (de minutos a 24 h). Mientras tanto no se puede mandar.`
        : `Plantilla "${name}" enviada a Meta. Queda "En revisión" (de minutos a 24 h); pulsa Sincronizar para ver si ya la aprobó.`,
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      {editing ? (
        <p className="text-xs text-muted-foreground">
          Editando <strong className="text-foreground">{editing.name}</strong> · {editing.language}
          {categoryLabel(editing.category) ? ` · ${categoryLabel(editing.category)}` : ""}. Meta solo deja cambiar el texto
          (el nombre, el idioma y la categoría quedan igual). Al guardar vuelve a revisión y mientras tanto no se puede
          mandar. Una plantilla aprobada se puede editar <strong>1 vez al día</strong> y <strong>10 veces al mes</strong>.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          La plantilla se manda a Meta para revisión y queda <strong>En revisión</strong> hasta que la aprueben. Si quieres
          huecos que se llenan en cada envío, usa <code className="text-brand-navy">{"{{1}}"}</code>,{" "}
          <code className="text-brand-navy">{"{{2}}"}</code>… (nunca al inicio ni al final del texto).
        </p>
      )}

      {!editing && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-3">
            <label htmlFor="tpl-name" className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input
              id="tpl-name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Hola buenas tardes"
              className={INPUT_CLASS}
            />
            <p className="text-[11px] text-muted-foreground">
              {name ? (
                <>
                  Así se guarda en Meta: <code className="font-medium text-brand-navy">{name}</code>
                </>
              ) : (
                "Escríbelo como quieras: el CRM lo pasa a minúsculas, sin acentos y con guion bajo."
              )}
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-lang" className="text-xs font-medium text-muted-foreground">Idioma</label>
            <select id="tpl-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={INPUT_CLASS}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="tpl-cat" className="text-xs font-medium text-muted-foreground">Categoría</label>
            <select id="tpl-cat" value={category} onChange={(e) => setCategory(e.target.value as Category)} className={INPUT_CLASS}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="tpl-body" className="text-xs font-medium text-muted-foreground">Texto</label>
        <textarea
          id="tpl-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hola, buenas tardes."
          rows={3}
          maxLength={TEMPLATE_BODY_MAX}
          className={`min-h-[80px] resize-y ${INPUT_CLASS}`}
        />
        <p className="text-right text-[11px] text-muted-foreground">
          {body.trim().length.toLocaleString("es-MX")} / {TEMPLATE_BODY_MAX.toLocaleString("es-MX")}
        </p>
      </div>
      {varCount > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Ejemplo de cada hueco (Meta lo pide para revisarla):</p>
          {exampleValues.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`${TOKEN_CLASS} shrink-0`}>{`{{${i + 1}}}`}</span>
              <input
                value={value}
                onChange={(e) => {
                  const next = [...exampleValues];
                  next[i] = e.target.value;
                  setExamples(next);
                }}
                placeholder={i === 0 ? "Ana" : `Ejemplo para {{${i + 1}}}`}
                className={`py-1.5 ${INPUT_CLASS}`}
              />
            </div>
          ))}
        </div>
      )}

      {(problem || formError) && (
        <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 text-xs">
          ⚠ {formError ?? problem}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {busy ? "Enviando a Meta…" : editing ? "Guardar y mandar a revisión" : "Crear y mandar a revisión"}
        </button>
      </div>
    </div>
  );
}
