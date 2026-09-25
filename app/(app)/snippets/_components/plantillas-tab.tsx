"use client";

// Plantillas 📄: aprobadas por Meta, para responder FUERA de la ventana de 24 h.
// Aquí solo se LISTAN y SINCRONIZAN (son inmutables: la edición vive en Meta).
// El alta por API es opcional y queda en revisión de Meta (PENDING) hasta que la
// aprueben. El ENVÍO se hace desde el chat. Ver docs/investigacion/plantillas-zernio.md.
import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { createTemplate, listTemplates, syncTemplates } from "@/lib/actions/templates";
import { templateMaxIndex } from "@/lib/messaging/template-format";
import type { TemplateView } from "@/lib/templates/types";
import { HighlightBody } from "./highlight";

const TOKEN_CLASS = "rounded bg-brand-navy/15 px-1 font-medium text-brand-navy";

const CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
type Category = (typeof CATEGORIES)[number];

function statusStyle(status: string): { label: string; className: string } {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { label: "Aprobada", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (s === "PENDING" || s === "IN_APPEAL") return { label: s === "PENDING" ? "En revisión" : "En apelación", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  if (s === "REJECTED") return { label: "Rechazada", className: "bg-red-500/10 text-red-700 dark:text-red-300" };
  if (s === "REMOVED") return { label: "Eliminada en Meta", className: "bg-muted text-muted-foreground line-through" };
  return { label: status, className: "bg-muted text-muted-foreground" };
}

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
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setItems(await listTemplates());
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setNote(null);
    try {
      const { synced, removed } = await syncTemplates();
      await refresh();
      setNote(
        `Sincronizado: ${synced} plantilla(s) desde WhatsApp` +
          (removed > 0 ? `; ${removed} marcada(s) como eliminada(s) en Meta.` : "."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Aprobadas por Meta, con variables <code className="text-brand-navy">{"{{1}}"}</code>. Para escribir
          fuera de las 24 h. Se envían desde el chat.
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
                setError(null);
                setNote(null);
                setCreating((c) => !c);
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
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {note}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {creating && (
        <CreateTemplateForm
          onClose={() => setCreating(false)}
          onCreated={async (msg) => {
            setCreating(false);
            setNote(msg);
            await refresh();
          }}
          onError={setError}
        />
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {canManage ? (
            <>
              No hay plantillas todavía. Pulsa <strong>Crear plantilla</strong> para darlas de alta desde aquí, o{" "}
              <strong>Sincronizar</strong> para traer las que ya existan en WhatsApp.
            </>
          ) : (
            "No hay plantillas todavía. Un administrador las sincroniza; tú las enviarás desde el chat."
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => {
            const badge = statusStyle(t.status);
            return (
              <li key={t.id} className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                  <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[11px] font-medium text-brand-navy">{t.language}</span>
                  {t.category && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t.category}</span>
                  )}
                  {!t.sendable && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {t.unsupported
                        ? "Encabezado/botón con variables: no enviable desde el CRM aún"
                        : "No enviable hasta que Meta la apruebe"}
                    </span>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreateTemplateForm({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<Category>("UTILITY");
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const varCount = useMemo(() => templateMaxIndex(body), [body]);
  // Ajusta la cantidad de ejemplos a las variables del cuerpo.
  const exampleValues = useMemo(() => Array.from({ length: varCount }, (_, i) => examples[i] ?? ""), [varCount, examples]);

  async function submit() {
    const cleanName = name.trim();
    const cleanBody = body.trim();
    if (!cleanName || !cleanBody) {
      onError("El nombre y el cuerpo son obligatorios.");
      return;
    }
    if (exampleValues.some((v) => !v.trim())) {
      onError("Da un ejemplo para cada variable del cuerpo.");
      return;
    }
    setBusy(true);
    try {
      const { status } = await createTemplate({
        name: cleanName,
        language: language.trim(),
        category,
        bodyText: cleanBody,
        bodyExample: exampleValues.map((v) => v.trim()),
      });
      await onCreated(`Plantilla "${cleanName}" enviada a Meta (estado: ${status}).`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo crear la plantilla.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">
        La plantilla se envía a Meta para revisión y queda <strong>PENDING</strong> hasta que la aprueben.
        Variables posicionales <code className="text-brand-navy">{"{{1}}"}</code>, <code className="text-brand-navy">{"{{2}}"}</code>…
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-1">
          <label htmlFor="tpl-name" className="text-xs font-medium text-muted-foreground">Nombre</label>
          <input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="confirmacion_pedido"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-lang" className="text-xs font-medium text-muted-foreground">Idioma</label>
          <input
            id="tpl-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="es_MX"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-cat" className="text-xs font-medium text-muted-foreground">Categoría</label>
          <select
            id="tpl-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="tpl-body" className="text-xs font-medium text-muted-foreground">Cuerpo</label>
        <textarea
          id="tpl-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hola {{1}}, tu pedido {{2}} está confirmado."
          rows={3}
          maxLength={1024}
          className="min-h-[80px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
      </div>
      {varCount > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Ejemplo de cada variable (para la revisión de Meta):</p>
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
                placeholder={`Ejemplo para {{${i + 1}}}`}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !body.trim()}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {busy ? "Enviando a Meta…" : "Crear y enviar a revisión"}
        </button>
      </div>
    </div>
  );
}
