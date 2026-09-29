// Texto libre con los links convertidos en hipervínculo azul (data-link="inline",
// app/globals.css): chat de la Bandeja y del Embudo, comentarios, mensajes
// rápidos… Abren en otra pestaña. La detección vive en lib/text/links.ts.
// `searchTerm` (búsqueda en los chats, lupa amarilla): la palabra se resalta en
// amarillo, también dentro de un link.
import { Fragment } from "react";
import { splitLinks } from "@/lib/text/links";
import { SearchHighlight } from "./search-highlight";

export function LinkedText({ text, searchTerm = null }: { text: string; searchTerm?: string | null }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" data-link="inline">
            <SearchHighlight text={part.text} term={searchTerm} />
          </a>
        ) : (
          <Fragment key={i}>
            <SearchHighlight text={part.text} term={searchTerm} />
          </Fragment>
        ),
      )}
    </>
  );
}
