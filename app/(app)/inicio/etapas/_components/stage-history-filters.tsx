"use client";

// Filtros del Historial de etapas que no son el periodo: etapa a la que pasó, quién lo movió y
// buscador de contacto. Viven en la URL junto con el periodo (`rangeQuery`), como el Dashboard.
import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { value: string; label: string };

export function StageHistoryFilters({
  basePath,
  rangeQuery,
  etapa,
  quien,
  q,
  stages,
  people,
}: {
  basePath: string;
  rangeQuery: string;
  etapa: string;
  quien: string;
  q: string;
  stages: Option[];
  people: Option[];
}) {
  const router = useRouter();
  const [text, setText] = useState(q);

  function go(next: { etapa?: string; quien?: string; q?: string }) {
    const params = new URLSearchParams(rangeQuery);
    const values = { etapa, quien, q, ...next };
    if (values.etapa) params.set("etapa", values.etapa);
    if (values.quien) params.set("quien", values.quien);
    if (values.q.trim()) params.set("q", values.q.trim());
    router.push(`${basePath}?${params.toString()}`);
  }

  const field = "rounded-md border bg-background px-2 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-end gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Pasó a</span>
        <select id="historial-etapa" value={etapa} onChange={(e) => go({ etapa: e.target.value })} className={field}>
          <option value="">Todas las etapas</option>
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Quién lo movió</span>
        <select id="historial-quien" value={quien} onChange={(e) => go({ quien: e.target.value })} className={field}>
          <option value="">Todos</option>
          <option value="agente">Agente IA</option>
          <option value="sistema">Automático</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <form
        role="search"
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: text });
        }}
      >
        <label htmlFor="historial-buscar" className="text-muted-foreground">
          Contacto
        </label>
        <div className="flex gap-1">
          <input
            id="historial-buscar"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nombre o teléfono"
            className={`${field} w-44`}
          />
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Buscar
          </button>
        </div>
      </form>
    </div>
  );
}
