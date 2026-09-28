"use client";

// «Marcar como leído» del pop-up del Embudo (28-sep-2026, pedido del dueño): a la
// derecha del nombre y el teléfono, en el encabezado del chat. Apaga el círculo naranja
// y el fondo azul de la tarjeta aunque nadie le haya contestado al cliente (p. ej. un
// "gracias"); el amarillo no (ese se apaga contestando). Sin nada que apagar muestra
// "Leído". Sin lógica de datos: la acción la pone el tablero.
import { Check, MailOpen } from "lucide-react";
import { canMarkRead, type FunnelSignal } from "@/lib/contacts/funnel-tone";

export function MarkReadButton({ signal, onMarkRead }: { signal: FunnelSignal | undefined; onMarkRead: () => void }) {
  if (!canMarkRead(signal)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Nada pendiente en este chat">
        <Check className="size-3.5" aria-hidden="true" />
        Leído
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onMarkRead}
      aria-label="Marcar como leído"
      title="Quita el fondo azul de la tarjeta sin contestar"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-navy/40 px-2.5 py-1 text-xs font-medium text-brand-navy hover:bg-brand-navy/10 dark:border-sky-300/40 dark:text-sky-300"
    >
      <MailOpen className="size-3.5" aria-hidden="true" />
      {/* En celular solo el ícono: el nombre del cliente necesita el espacio. */}
      <span className="hidden sm:inline">Marcar como leído</span>
    </button>
  );
}
