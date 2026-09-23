"use client";

// Anchos por entrada (A7/B2): una fila por entrada (las crea "¿cuántas
// entradas?"), con su línea y el tamaño de compuerta sugerido por los rangos de
// la organización. El tamaño manual, si lo hay, manda sobre el sugerido.
import { useState } from "react";
import { updateEntrada } from "@/lib/actions/contact-qualification";

export type Entrada = {
  posicion: number;
  anchoCm: number | null;
  linea: "mini" | "estandar";
  tamanoSugerido: string | null;
  tamanoManual: string | null;
};

const LINEA_LABELS: Record<Entrada["linea"], string> = { mini: "Mini", estandar: "Estándar" };

const field =
  "rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

function EntradaRow({
  contactId,
  entrada,
  onSaved,
  run,
}: {
  contactId: string;
  entrada: Entrada;
  onSaved: (next: Entrada) => void;
  run: (action: () => Promise<unknown>, errorMessage?: string) => Promise<boolean>;
}) {
  const [ancho, setAncho] = useState(entrada.anchoCm === null ? "" : String(entrada.anchoCm));
  const [manual, setManual] = useState(entrada.tamanoManual ?? "");

  async function save(patch: Parameters<typeof updateEntrada>[2]) {
    await run(async () => onSaved(await updateEntrada(contactId, entrada.posicion, patch)));
  }

  function saveAncho() {
    const text = ancho.trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000)) {
      setAncho(entrada.anchoCm === null ? "" : String(entrada.anchoCm));
      void run(() => Promise.reject(new Error("ancho")), "El ancho debe ser un entero de 1 a 1000 cm.");
      return;
    }
    if (value !== entrada.anchoCm) void save({ anchoCm: value });
  }

  const suggestion = entrada.tamanoSugerido ?? (entrada.anchoCm === null ? "—" : "Sin sugerencia");

  return (
    <li className="rounded-md border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">Entrada {entrada.posicion}</span>
        <input
          aria-label={`Ancho de la entrada ${entrada.posicion} (cm)`}
          inputMode="numeric"
          placeholder="cm"
          value={ancho}
          onChange={(e) => setAncho(e.target.value)}
          onBlur={saveAncho}
          className={`${field} w-16`}
        />
        <select
          aria-label={`Línea de la entrada ${entrada.posicion}`}
          value={entrada.linea}
          onChange={(e) => void save({ linea: e.target.value as Entrada["linea"] })}
          className={`${field} min-w-0 flex-1`}
        >
          {(Object.keys(LINEA_LABELS) as Entrada["linea"][]).map((l) => (
            <option key={l} value={l}>
              {LINEA_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="w-14 shrink-0 text-muted-foreground">Tamaño</span>
        <span className={`min-w-0 flex-1 truncate ${manual ? "text-muted-foreground line-through" : "font-medium"}`} title="Sugerido por los rangos de la línea">
          {suggestion}
        </span>
        <input
          aria-label={`Tamaño manual de la entrada ${entrada.posicion}`}
          placeholder="Manual"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onBlur={() => {
            if (manual.trim() !== (entrada.tamanoManual ?? "")) void save({ tamanoManual: manual.trim() || null });
          }}
          className={`${field} w-24`}
        />
      </div>
    </li>
  );
}

export function ContactEntradas({
  contactId,
  entradas,
  onSaved,
  run,
}: {
  contactId: string;
  entradas: Entrada[];
  onSaved: (next: Entrada) => void;
  run: (action: () => Promise<unknown>, errorMessage?: string) => Promise<boolean>;
}) {
  if (entradas.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {entradas.map((e) => (
        <EntradaRow key={e.posicion} contactId={contactId} entrada={e} onSaved={onSaved} run={run} />
      ))}
    </ul>
  );
}
