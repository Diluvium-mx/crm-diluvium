"use client";

// Versiones guardadas del Goal o de las FAQs, con "Restaurar" (regresar a una
// anterior deja, a su vez, una versión nueva). Sin lógica de datos.
import { useState } from "react";
import type { AgentActionResult, VersionView } from "@/lib/agente-ia/types";

const when = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mazatlan", dateStyle: "medium", timeStyle: "short" });

export function VersionsList({
  versions,
  onRestore,
}: {
  versions: VersionView[];
  onRestore: (versionId: string) => Promise<AgentActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(v: VersionView) {
    if (!window.confirm(`¿Regresar a la versión del ${when.format(new Date(v.createdAt))}? Lo actual queda guardado como otra versión.`)) return;
    setBusy(v.id);
    setError(null);
    const r = await onRestore(v.id);
    setBusy(null);
    if (!r.ok) setError(r.message);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
              <li key={v.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-foreground">
                  {when.format(new Date(v.createdAt))} · {v.summary}
                  {v.author ? ` · ${v.author}` : ""}
                  {i === 0 && <span className="ml-1 text-muted-foreground">(actual)</span>}
                </span>
                {i > 0 && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(v)}
                    className="rounded px-1.5 py-0.5 font-medium text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 dark:text-sky-300"
                  >
                    {busy === v.id ? "Restaurando…" : "Restaurar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
      {error && <p className="border-l-2 border-brand-orange pl-2 text-xs text-foreground">{error}</p>}
    </div>
  );
}
