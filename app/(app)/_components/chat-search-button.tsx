"use client";

// La lupa entre el buscador y el filtro (Bandeja y Embudo, 29-sep-2026, decisión del dueño).
// Prendida (amarilla), el MISMO campo de búsqueda busca una palabra DENTRO de los chats de
// todos los contactos; apagada, por nombre o teléfono como siempre. No se recuerda al recargar.
import { Search } from "lucide-react";

export function ChatSearchButton({ active, onChange }: { active: boolean; onChange: (active: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      aria-label="Buscar dentro de los chats"
      title={active ? "Buscando dentro de los chats (clic para buscar por nombre o teléfono)" : "Buscar dentro de los chats"}
      className={`flex h-9 shrink-0 items-center rounded-md border px-2 transition-colors ${
        active ? "border-busqueda-borde bg-busqueda text-busqueda-tinta" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      <Search className="size-4" aria-hidden="true" />
    </button>
  );
}

// Clases del campo de búsqueda con la lupa prendida: borde y foco amarillos.
export const CHAT_SEARCH_INPUT_ACTIVE = "border-busqueda-borde focus:border-busqueda-borde focus:ring-2 focus:ring-busqueda/40";

export const CHAT_SEARCH_PLACEHOLDER = "Buscar en los chats…";
