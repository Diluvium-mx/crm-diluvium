"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Contact } from "../_data/types";
import { STAGE_LABELS, TEMPERATURE_EMOJI, TEMPERATURE_LABELS, getContactFullName } from "../_data/types";

// Contenido puro de la tarjeta, sin lógica de arrastre. Se reutiliza tal
// cual dentro del DragOverlay del board (la "copia" que sigue al cursor
// mientras arrastras), para que la tarjeta arrastrada se vea idéntica.
export function ContactCardContent({ contact }: { contact: Contact }) {
  return (
    <div className="flex w-full flex-col gap-1 rounded-md border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:border-brand-navy">
      <span className="flex items-center gap-1 font-medium">
        {getContactFullName(contact)}
        {contact.temperature && (
          <span
            role="img"
            aria-label={TEMPERATURE_LABELS[contact.temperature]}
            title={TEMPERATURE_LABELS[contact.temperature]}
            className="text-xs"
          >
            {TEMPERATURE_EMOJI[contact.temperature]}
          </span>
        )}
      </span>
      <span className="text-muted-foreground">{contact.phoneE164 ?? "Sin teléfono"}</span>
      <span className="text-xs text-muted-foreground">{STAGE_LABELS[contact.stage]}</span>
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
