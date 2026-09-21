// Resalta los tokens {{…}} dentro de un cuerpo de texto. Fragmentos usan el
// naranja de acción; Plantillas el azul estructural (se pasa por className).
export function HighlightBody({ body, tokenClassName }: { body: string; tokenClassName: string }) {
  const parts = body.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\{\{[^{}]+\}\}$/.test(part) ? (
          <span key={index} className={tokenClassName}>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
