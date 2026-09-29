// Círculo AMARILLO de la búsqueda en los chats (29-sep-2026): cuántos mensajes del chat
// tienen la palabra buscada. Va junto al círculo naranja de no leídos (fila de la Bandeja y
// tarjeta del Embudo), mismo tamaño y tope 99+; sólido con borde para no confundirse con el
// fondo amarillo claro de la tarjeta "el Agente IA necesita al vendedor".
export function ChatSearchBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <span
      aria-label={`${count} ${count === 1 ? "mensaje tiene" : "mensajes tienen"} la palabra buscada`}
      title="Mensajes con la palabra buscada"
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-busqueda-borde bg-busqueda px-1.5 text-[11px] font-semibold text-busqueda-tinta"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
