"use client";

import { useDraggable } from "@dnd-kit/core";
import { Mail, MailOpen } from "lucide-react";
import type { BoardContact } from "../_data/types";
import { DESTACADO_EMOJI, TEMPERATURES, TEMPERATURE_EMOJI, TEMPERATURE_LABELS, getContactFullName } from "../_data/types";
import { ContactAvatar } from "./contact-avatar";
import { formatPhone } from "@/lib/phone-format";
import { canMarkRead, funnelTone, unreadBadge, type FunnelSignal } from "@/lib/contacts/funnel-tone";
import { PhoneLocation } from "@/components/ui/phone-location";
import { PruebaBadge } from "@/components/ui/prueba-badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";

// Para lector de pantalla: el fondo de color solo se ve.
const TONE_LABEL = {
  urgent: "El agente necesita al vendedor",
  pending: "Mensajes por contestar",
} as const;

// Contenido puro de la tarjeta, sin lógica de arrastre. Se reutiliza tal
// cual dentro del DragOverlay del board (la "copia" que sigue al cursor
// mientras arrastras), para que la tarjeta arrastrada se vea idéntica.
// El fondo de color (señal) lo pone quien la envuelve con data-funnel
// (app/globals.css); aquí solo va el círculo de no vistos. Al pasar el cursor el
// borde y la luz son GRISES: el azul queda solo para "por contestar".
export function ContactCardContent({ contact, signal }: { contact: BoardContact; signal?: FunnelSignal }) {
  const unread = unreadBadge(signal?.unread);
  const tone = funnelTone(signal);
  // ⭐ ya no es temperatura (0048): un valor viejo no se pinta; Destacado va aparte, al lado.
  const temperature = contact.temperature && TEMPERATURES.includes(contact.temperature) ? contact.temperature : null;
  return (
    <div className="flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left text-sm shadow-sm transition-colors hover:border-foreground/30">
      <ContactAvatar contact={contact} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{getContactFullName(contact)}</span>
          {contact.esPrueba && <PruebaBadge />}
        </span>
        <span className="truncate text-muted-foreground">{formatPhone(contact.phoneE164) || "Sin teléfono"}</span>
        <PhoneLocation phone={contact.phoneE164} />
        {tone && <span className="sr-only">{TONE_LABEL[tone]}</span>}
      </div>
      {(unread || temperature || contact.destacado) && (
        <div className="flex shrink-0 items-center gap-2">
          {unread && (
            <span
              aria-label={`${unread} ${unread === "1" ? "mensaje sin ver" : "mensajes sin ver"}`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[11px] font-semibold text-brand-white"
            >
              {unread}
            </span>
          )}
          {temperature && (
            <span
              role="img"
              aria-label={TEMPERATURE_LABELS[temperature]}
              title={TEMPERATURE_LABELS[temperature]}
              className="text-xl leading-none"
            >
              {TEMPERATURE_EMOJI[temperature]}
            </span>
          )}
          {/* Destacado: marca aparte, al lado de la temperatura y del mismo tamaño. */}
          {contact.destacado && (
            <span role="img" aria-label="Destacado" title="Destacado" className="text-xl leading-none">
              {DESTACADO_EMOJI}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ContactCard({
  contact,
  signal,
  onClick,
  onSetUnread,
}: {
  contact: BoardContact;
  signal?: FunnelSignal;
  onClick: () => void;
  onSetUnread: (unread: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: contact.id,
  });

  // El MouseSensor del board tiene una distancia de activación (6px): un
  // clic sin desplazar sigue disparando onClick y abre el panel; solo al
  // arrastrar toma el control dnd-kit. Mientras se arrastra, la tarjeta
  // original se atenúa y el DragOverlay muestra la copia que sigue al cursor.
  // El fondo lo lleva el botón y el contenido va transparente: así el "fondo
  // iluminado" (app/globals.css) se ve DETRÁS del contenido y ENCIMA del color
  // de la señal (data-funnel). La copia del DragOverlay hace lo mismo en el board.
  // Clic derecho: menú de la tarjeta (el clic derecho no arrastra: dnd-kit solo
  // toma el botón izquierdo). En táctil NO abre con pulsación larga: ahí la
  // pulsación larga es arrastrar (TouchSensor del board).
  // "Marcar como leído" si hay círculo o azul; si no, "Marcar como no leído".
  const markable = canMarkRead(signal);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        onTouchStart={(event) => event.preventBaseUIHandler()}
        className="data-popup-open:[&>button>div]:border-foreground/30"
      >
        <button
          ref={setNodeRef}
          type="button"
          onClick={onClick}
          {...attributes}
          {...listeners}
          data-funnel={funnelTone(signal)}
          data-funnel-card
          className={`w-full cursor-grab rounded-md bg-card text-left active:cursor-grabbing [&>div]:bg-transparent ${
            isDragging ? "opacity-40" : ""
          }`}
        >
          <ContactCardContent contact={contact} signal={signal} />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSetUnread(!markable)}>
          {markable ? <MailOpen aria-hidden="true" /> : <Mail aria-hidden="true" />}
          {markable ? "Marcar como leído" : "Marcar como no leído"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
