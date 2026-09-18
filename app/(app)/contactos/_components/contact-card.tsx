"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Contact } from "../_data/types";
import { TEMPERATURE_EMOJI, TEMPERATURE_LABELS, getContactFullName } from "../_data/types";
import { ContactAvatar } from "./contact-avatar";

// Contenido puro de la tarjeta, sin lógica de arrastre. Se reutiliza tal
// cual dentro del DragOverlay del board (la "copia" que sigue al cursor
// mientras arrastras), para que la tarjeta arrastrada se vea idéntica.
export function ContactCardContent({ contact }: { contact: Contact }) {
  return (
    <div className="flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left text-sm shadow-sm transition-colors hover:border-brand-navy">
      <ContactAvatar contact={contact} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{getContactFullName(contact)}</span>
        <span className="truncate text-muted-foreground">{contact.phoneE164 ?? "Sin teléfono"}</span>
      </div>
      {contact.temperature && (
        <span
          role="img"
          aria-label={TEMPERATURE_LABELS[contact.temperature]}
          title={TEMPERATURE_LABELS[contact.temperature]}
          className="shrink-0 text-xl leading-none"
        >
          {TEMPERATURE_EMOJI[contact.temperature]}
        </span>
      )}
    </div>
  );
}

export function ContactCard({
  contact,
  onClick,
}: {
  contact: Contact;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: contact.id,
  });

  // El MouseSensor del board tiene una distancia de activación (6px): un
  // clic sin desplazar sigue disparando onClick y abre el panel; solo al
  // arrastrar toma el control dnd-kit. Mientras se arrastra, la tarjeta
  // original se atenúa y el DragOverlay muestra la copia que sigue al cursor.
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...attributes}
      {...listeners}
      className={`w-full cursor-grab rounded-md text-left active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <ContactCardContent contact={contact} />
    </button>
  );
}
