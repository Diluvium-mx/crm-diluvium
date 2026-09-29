// Texto con la palabra buscada resaltada en amarillo (búsqueda en los chats, 29-sep-2026):
// fondo amarillo sólido, subrayado ámbar y el texto del CRM encima, igual en claro y oscuro
// y también dentro de las burbujas navy. Sin término, el texto tal cual.
import { Fragment } from "react";
import { highlightParts } from "@/lib/text/highlight";

export function SearchHighlight({ text, term }: { text: string; term: string | null }) {
  if (!term) return <>{text}</>;
  return (
    <>
      {highlightParts(text, term).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-[2px] border-b-2 border-busqueda-borde bg-busqueda px-px text-busqueda-tinta">
            {part.text}
          </mark>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
