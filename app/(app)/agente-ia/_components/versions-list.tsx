"use client";

// Versiones guardadas del Goal o de las FAQs. Cada una (también la actual) se puede
// NOMBRAR con el lápiz ✎ (edición en línea: Guardar/Cancelar, Enter/Esc; máx. 80
// caracteres; vacío = sin nombre) y las anteriores se pueden «Restaurar» (regresar a
// una deja, a su vez, una versión nueva). Todo pide confirmación arriba antes de
// guardar (regla del dueño, 27-sep-2026; use-confirm.tsx). Se ve así:
// **Nombre** · 26 sep 2026, 10:15 p.m. · 3,226 palabras · Admin (actual).
// Sin lógica de datos: solo llama a Server Actions.
import { useState } from "react";
import { renameAgentVersion } from "@/lib/actions/agente-ia-editor";
import { MAX_VERSION_NAME, restoreVersionQuestion, versionNameSchema } from "@/lib/agente-ia/editor";
import type { AgentActionResult, VersionView } from "@/lib/agente-ia/types";
import { useConfirm } from "./use-confirm";

const when = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", dateStyle: "medium", timeStyle: "short" });
const whenOf = (v: VersionView) => when.format(new Date(v.createdAt));

function NameEditor({
  version,
  pending,
  error,
  onSave,
  onCancel,
}: {
  version: VersionView;
  pending: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(version.name ?? "");
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={MAX_VERSION_NAME}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Nombre de la versión (p. ej. Antes de la promo)"
        aria-label={`Nombre de la versión del ${whenOf(version)}`}
        className="min-w-48 flex-1 rounded border border-black/15 bg-background px-2 py-1 text-xs text-foreground dark:border-white/15"
      />
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {value.trim().length}/{MAX_VERSION_NAME}
      </span>
      <button type="submit" disabled={pending} className="rounded bg-brand-orange px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
        Guardar
      </button>
      <button type="button" disabled={pending} onClick={onCancel} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">
        Cancelar
      </button>
      {error && <span className="basis-full border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</span>}
    </form>
  );
}

export function VersionsList({
  versions,
  onRestore,
  restoreWarning,
}: {
  versions: VersionView[];
  onRestore: (versionId: string) => Promise<AgentActionResult>;
  // Se agrega al pop-up de «Restaurar» (p. ej. si el editor tiene cambios sin guardar).
  restoreWarning?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const confirm = useConfirm();

  function rename(v: VersionView, raw: string) {
    const parsed = versionNameSchema.safeParse(raw);
    if (!parsed.success) return; // maxLength ya lo impide; el servidor valida de nuevo.
    const name = parsed.data;
    if (name === (v.name ?? null)) {
      setEditing(null);
      return;
    }
    confirm.ask({
      title: name ? `¿Llamar «${name}» a la versión del ${whenOf(v)}?` : `¿Quitar el nombre «${v.name}» de la versión del ${whenOf(v)}?`,
      body: "Solo cambia cómo se ve en esta lista; el agente no cambia.",
      confirmLabel: name ? "Sí, guardar nombre" : "Sí, quitar nombre",
      pendingLabel: "Guardando…",
      done: name ? `Listo: la versión se llama «${name}»` : "Listo: la versión quedó sin nombre",
      scope: `nombre:${v.id}`,
      run: () => renameAgentVersion({ versionId: v.id, name: raw }),
      onDone: () => setEditing(null),
    });
  }

  function restore(v: VersionView) {
    confirm.ask({
      title: restoreVersionQuestion(v.name, whenOf(v)),
      body: (
        <>
          Lo actual queda guardado como otra versión. El agente usa la versión restaurada desde el siguiente mensaje.
          {restoreWarning && <span className="mt-1 block font-medium text-foreground">{restoreWarning}</span>}
        </>
      ),
      confirmLabel: "Sí, restaurar",
      pendingLabel: "Restaurando…",
      done: v.name ? `Listo: se restauró «${v.name}»` : `Listo: se restauró la versión del ${whenOf(v)}`,
      scope: "restaurar",
      run: () => onRestore(v.id),
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="self-start text-xs font-medium text-brand-navy hover:underline dark:text-sky-300"
      >
        {open ? "Ocultar versiones" : `Versiones (${versions.length})`}
      </button>
      {open &&
        (versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay versiones guardadas.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded border text-xs">
            {versions.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
                {editing === v.id ? (
                  <NameEditor
                    version={v}
                    pending={confirm.pending}
                    error={confirm.errorFor(`nombre:${v.id}`)}
                    onSave={(name) => rename(v, name)}
                    onCancel={() => {
                      setEditing(null);
                      confirm.clearError();
                    }}
                  />
                ) : (
                  <>
                    <span className="min-w-0 text-foreground">
                      {v.name && <strong className="font-semibold">{v.name} · </strong>}
                      {whenOf(v)} · {v.summary}
                      {v.author ? ` · ${v.author}` : ""}
                      {i === 0 && <span className="ml-1 text-muted-foreground">(actual)</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          confirm.clearError();
                          setEditing(v.id);
                        }}
                        aria-label={v.name ? `Cambiar el nombre «${v.name}»` : `Ponerle nombre a la versión del ${whenOf(v)}`}
                        title={v.name ? "Cambiar el nombre" : "Ponerle nombre"}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        ✎
                      </button>
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() => restore(v)}
                          className="rounded px-1.5 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300"
                        >
                          Restaurar
                        </button>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ))}
      {confirm.errorFor("restaurar") && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{confirm.errorFor("restaurar")}</p>}
      {confirm.ui}
    </div>
  );
}
