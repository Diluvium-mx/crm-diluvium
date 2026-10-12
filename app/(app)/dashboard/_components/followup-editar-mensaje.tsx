"use client";

// «Editar mensaje» en la ventana del seguimiento (decisión del dueño, 12-oct-2026; docs/seguimientos.md §23). Sale
// junto a «Ocultar mensaje» (solo con el mensaje a la vista). Con la ventana abierta se cambia el texto completo (sale
// tal cual, sin saludo del CRM); con la ventana cerrada se elige otra plantilla, ya llena como le llegaría al cliente
// (el texto de una plantilla no se puede cambiar: Meta no lo deja). Sin lógica de datos: guarda con lo que le pasan.
import { useEffect, useRef, useState } from "react";
import type { FollowUpTemplateOption } from "@/lib/followups/editar";

type Props = {
  door: "texto" | "plantilla";
  /** Lo que saldría ahora (el texto con saludo o la plantilla ya llena). */
  current: string;
  /** Lo que eligió un vendedor (texto o nombre de plantilla), o null si va lo del Agente IA. */
  edited: string | null;
  busy: boolean;
  loadOptions: () => Promise<FollowUpTemplateOption[] | null>;
  onSaveText: (texto: string | null) => Promise<boolean>;
  onSaveTemplate: (name: string | null) => Promise<boolean>;
  onDone: () => void;
};

const button = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-brand-navy/10 disabled:opacity-50";

export function FollowUpEditarMensaje(props: Props) {
  // La ventana del seguimiento es baja: al abrir el editor se recorre hasta él.
  const ref = useRef<HTMLDivElement>(null);
  // Con llaves: en Chrome nuevo scrollIntoView devuelve una promesa y un efecto solo puede devolver su limpieza.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return <div ref={ref}>{props.door === "texto" ? <EditarTexto {...props} /> : <ElegirPlantilla {...props} />}</div>;
}

function EditarTexto({ current, edited, busy, onSaveText, onDone }: Props) {
  const [texto, setTexto] = useState(current);
  return (
    <div data-testid="followup-editar-texto" className="space-y-1.5">
      <textarea
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        aria-label="Mensaje que sale"
        rows={4}
        data-sin-escritura
        className="w-full resize-y rounded-md border bg-background p-2 text-[13px] leading-snug select-text"
      />
      <p className="text-xs text-muted-foreground">Sale exactamente así (el CRM ya no le agrega el saludo).</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy || !texto.trim()} onClick={() => void onSaveText(texto).then((ok) => ok && onDone())} className={`${button} border-brand-navy`}>
          Guardar
        </button>
        {edited !== null && (
          <button type="button" disabled={busy} onClick={() => void onSaveText(null).then((ok) => ok && onDone())} className={button}>
            Volver al del Agente IA
          </button>
        )}
      </div>
    </div>
  );
}

function ElegirPlantilla({ edited, busy, loadOptions, onSaveTemplate, onDone }: Props) {
  const [options, setOptions] = useState<FollowUpTemplateOption[] | null | undefined>(undefined);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOptions().then((list) => {
      if (!alive) return;
      setOptions(list);
      setChosen(edited ?? list?.find((o) => o.delAgente)?.name ?? null);
    });
    return () => {
      alive = false;
    };
  }, [loadOptions, edited]);

  if (options === undefined) return <p className="text-xs text-muted-foreground">Cargando plantillas…</p>;
  if (!options?.length) return <p className="text-xs text-muted-foreground">No hay plantillas aprobadas que el seguimiento pueda mandar.</p>;
  const agente = options.find((o) => o.delAgente)?.name ?? null;
  return (
    <div data-testid="followup-elegir-plantilla" className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Elige la plantilla que sale (ya llena, así le llega):</p>
      <div role="radiogroup" aria-label="Plantilla que sale" className="space-y-1.5">
        {options.map((o) => (
          <label
            key={o.name}
            className={`flex cursor-pointer gap-2 rounded-md border p-2 ${chosen === o.name ? "border-brand-navy ring-1 ring-brand-navy" : ""}`}
          >
            <input type="radio" name="followup-plantilla" aria-label={o.title} checked={chosen === o.name} onChange={() => setChosen(o.name)} className="mt-0.5 accent-brand-navy" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">
                {o.title}
                {o.delAgente && <span className="font-normal text-muted-foreground"> · la que eligió el Agente IA</span>}
              </span>
              {/* En producción hay unas 20: las demás en 2 renglones; la elegida, completa. */}
              <span className={`block text-xs whitespace-pre-wrap text-muted-foreground select-text ${chosen === o.name ? "" : "line-clamp-2"}`}>{o.text}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy || !chosen}
          // Elegir la misma del Agente IA es lo mismo que no elegir: no queda como «editado a mano».
          onClick={() => void onSaveTemplate(chosen === agente ? null : chosen).then((ok) => ok && onDone())}
          className={`${button} border-brand-navy`}
        >
          Guardar
        </button>
        {edited !== null && (
          <button type="button" disabled={busy} onClick={() => void onSaveTemplate(null).then((ok) => ok && onDone())} className={button}>
            Volver a la del Agente IA
          </button>
        )}
      </div>
    </div>
  );
}
