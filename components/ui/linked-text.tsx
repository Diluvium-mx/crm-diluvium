// Texto libre con los links convertidos en hipervínculo azul (data-link="inline",
// app/globals.css): chat de la Bandeja y del Embudo, comentarios, mensajes
// rápidos… Abren en otra pestaña. La detección vive en lib/text/links.ts.
import { Fragment } from "react";
import { splitLinks } from "@/lib/text/links";

export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" data-link="inline">
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
