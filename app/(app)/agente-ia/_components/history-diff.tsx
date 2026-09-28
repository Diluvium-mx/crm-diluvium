// "Ver cambios" de una fila del Historial (Bloque E, 28-sep-2026): pinta los bloques que
// arma lib/historial/diff.ts. Lo quitado va tachado en rojo (<del>) y lo agregado en verde
// (<ins>). Sin lógica de datos.
import type { ChangeDiff, DiffBlock, DiffSegment, DiffTag } from "@/lib/historial/diff";

const TAG: Record<DiffTag, { label: string; className: string }> = {
  agregado: { label: "Agregado", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  quitado: { label: "Quitado", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
  editado: { label: "Editado", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

function Segment({ segment }: { segment: DiffSegment }) {
  if (segment.op === "removed") {
    return <del className="rounded-sm bg-red-500/15 text-red-800 decoration-red-600/70 dark:text-red-200">{segment.text}</del>;
  }
  if (segment.op === "added") {
    return <ins className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-200">{segment.text}</ins>;
  }
  return <span>{segment.text}</span>;
}

function Block({ block }: { block: DiffBlock }) {
  const tag = TAG[block.tag];
  return (
    <li className="flex flex-col gap-1 rounded border border-black/10 p-2 dark:border-white/10">
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
        <span className="break-words">{block.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-normal ${tag.className}`}>{tag.label}</span>
      </p>
      {block.lines.map((line, i) => (
        <p key={i} className="text-xs break-words whitespace-pre-wrap text-foreground/90">
          {line.label && <span className="mr-1 text-foreground/60">{line.label}:</span>}
          {line.segments.map((s, j) => (
            <Segment key={j} segment={s} />
          ))}
        </p>
      ))}
    </li>
  );
}

export function HistoryDiff({ diff }: { diff: ChangeDiff }) {
  if (diff.blocks.length === 0) return <p className="text-xs text-foreground/70">No hay diferencias que mostrar.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-foreground/60">
        <del className="rounded-sm bg-red-500/15 text-red-800 dark:text-red-200">tachado en rojo</del> = quitado ·{" "}
        <ins className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-200">en verde</ins> = agregado
        {diff.unchanged ? ` · ${diff.unchanged}` : ""}
      </p>
      <ul className="flex flex-col gap-2">
        {diff.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </ul>
    </div>
  );
}
