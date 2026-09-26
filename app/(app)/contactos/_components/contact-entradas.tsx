"use client";

// Anchos por entrada (A7/B2): una fila por entrada (las crea "¿cuántas
// entradas?"), con su línea y el tamaño de compuerta sugerido por los rangos de
// la organización. El tamaño manual, si lo hay, manda sobre el sugerido.
import { useEffect, useRef, useState } from "react";
import { updateEntrada } from "@/lib/actions/contact-qualification";
import type { SerialSaves } from "@/lib/autosave/serial-saves";
import { IaMark } from "./ia-mark";

export type Entrada = {
  /** Cambia si la fila se borra y se vuelve a crear: la fila se remonta limpia. */
  id: string;
  posicion: number;
  anchoCm: number | null;
  linea: "mini" | "estandar";
  tamanoSugerido: string | null;
  tamanoManual: string | null;
};

type Values = Pick<Entrada, "anchoCm" | "linea" | "tamanoManual">;

function without<K extends keyof Values>(pending: Partial<Values>, field: K): Partial<Values> {
  const next = { ...pending };
  delete next[field];
  return next;
}

const LINEA_LABELS: Record<Entrada["linea"], string> = { mini: "Mini", estandar: "Estándar" };

const field =
  "rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

function EntradaRow({
  contactId,
  entrada,
  iaAncho,
  onSaved,
  run,
  saves,
}: {
  contactId: string;
  entrada: Entrada;
  /** El ancho lo llenó el Agente IA (marca "IA" hasta que un vendedor lo edite). */
  iaAncho: boolean;
  onSaved: (next: Entrada) => void;
  run: (action: () => Promise<unknown>, errorMessage?: string) => Promise<boolean>;
  saves: SerialSaves;
}) {
  const [ancho, setAncho] = useState(entrada.anchoCm === null ? "" : String(entrada.anchoCm));
  const [manual, setManual] = useState(entrada.tamanoManual ?? "");
  // Hallazgo 4: los campos de TODAS las filas y "¿Cuántas entradas?" salen en
  // UN carril del panel ("entradas"): updateEntrada reescribe ancho y línea
  // juntos, y una relectura del número nunca pisa un guardado posterior de una
  // fila. Solo la última respuesta de cada campo decide. `pending` = lo pedido
  // que aún no termina: se muestra (la línea) y se compara contra eso (para no
  // saltarse ni repetir un guardado). Sin nada pendiente manda `entrada`: lo
  // que el padre sabe del servidor, que se actualiza con cada respuesta y al
  // releer las entradas. La fila va con key por id: si se borra y se vuelve a
  // crear, se remonta limpia (sin anchos viejos en pantalla).
  const [pending, setPending] = useState<Partial<Values>>({});
  const [editedAncho, setEditedAncho] = useState(false);
  const latest = useRef(entrada);
  useEffect(() => {
    latest.current = entrada;
  }, [entrada]);
  const requested = <K extends keyof Values>(field: K): Values[K] =>
    field in pending ? (pending[field] as Values[K]) : entrada[field];
  // En vivo: si la entrada cambia desde fuera (Agente IA, otro vendedor o la
  // respuesta de un guardado), el borrador se pone al día, salvo el que el
  // vendedor está tecleando o tiene su guardado pendiente.
  const [typing, setTyping] = useState({ ancho: false, manual: false });
  const [seen, setSeen] = useState(entrada);
  if (seen !== entrada) {
    setSeen(entrada);
    if (!typing.ancho && !("anchoCm" in pending)) setAncho(entrada.anchoCm === null ? "" : String(entrada.anchoCm));
    if (!typing.manual && !("tamanoManual" in pending)) setManual(entrada.tamanoManual ?? "");
  }
  const showDraft: { [K in keyof Values]: (value: Values[K]) => void } = {
    anchoCm: (v) => setAncho(v === null ? "" : String(v)),
    linea: () => {},
    tamanoManual: (v) => setManual(v ?? ""),
  };

  function save<K extends keyof Values>(field: K, value: Values[K]) {
    setPending((p) => ({ ...p, [field]: value }));
    void run(async () => {
      const patch = { [field]: value } as Pick<Values, K>;
      const outcome = await saves.save(`entrada:${entrada.id}:${field}`, () => updateEntrada(contactId, entrada.posicion, patch), {
        lane: "entradas",
      });
      // Un solo carril: las respuestas llegan en el orden en que se guardaron.
      if (outcome.status === "saved") onSaved(outcome.result);
      if (outcome.status === "superseded" || !outcome.latest) return;
      setPending((p) => without(p, field));
      if (outcome.status === "saved") return;
      // Falló el último: el campo vuelve a lo último que el servidor guardó.
      showDraft[field](latest.current[field]);
      throw outcome.error;
    });
  }

  function saveAncho() {
    const text = ancho.trim();
    const value = text === "" ? null : /^\d+$/.test(text) ? Number(text) : NaN;
    if (value !== null && (Number.isNaN(value) || value < 1 || value > 1000)) {
      showDraft.anchoCm(requested("anchoCm"));
      void run(() => Promise.reject(new Error("ancho")), "El ancho debe ser un entero de 1 a 1000 cm.");
      return;
    }
    if (value !== requested("anchoCm")) {
      setEditedAncho(true);
      save("anchoCm", value);
    }
  }

  const suggestion = entrada.tamanoSugerido ?? (entrada.anchoCm === null ? "—" : "Sin sugerencia");

  return (
    <li className="rounded-md border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">
          Entrada {entrada.posicion}
          {iaAncho && !editedAncho && <IaMark />}
        </span>
        <input
          aria-label={`Ancho de la entrada ${entrada.posicion} (cm)`}
          inputMode="numeric"
          placeholder="cm"
          value={ancho}
          onChange={(e) => {
            setTyping((t) => (t.ancho ? t : { ...t, ancho: true }));
            setAncho(e.target.value);
          }}
          onBlur={() => {
            setTyping((t) => ({ ...t, ancho: false }));
            saveAncho();
          }}
          className={`${field} w-16`}
        />
        <select
          aria-label={`Línea de la entrada ${entrada.posicion}`}
          value={requested("linea")}
          onChange={(e) => save("linea", e.target.value as Entrada["linea"])}
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
          maxLength={50}
          onChange={(e) => {
            setTyping((t) => (t.manual ? t : { ...t, manual: true }));
            setManual(e.target.value);
          }}
          onBlur={() => {
            setTyping((t) => ({ ...t, manual: false }));
            const next = manual.trim() || null;
            if (next !== requested("tamanoManual")) save("tamanoManual", next);
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
  iaFields = [],
  onSaved,
  run,
  saves,
}: {
  contactId: string;
  entradas: Entrada[];
  iaFields?: readonly string[];
  onSaved: (next: Entrada) => void;
  run: (action: () => Promise<unknown>, errorMessage?: string) => Promise<boolean>;
  saves: SerialSaves;
}) {
  if (entradas.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {entradas.map((e) => (
        <EntradaRow
          key={e.id}
          contactId={contactId}
          entrada={e}
          iaAncho={iaFields.includes(`entrada_${e.posicion}_ancho`)}
          onSaved={onSaved}
          run={run}
          saves={saves}
        />
      ))}
    </ul>
  );
}
