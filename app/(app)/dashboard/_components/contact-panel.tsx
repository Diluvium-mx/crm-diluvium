"use client";

// Panel derecho de la Bandeja: el MISMO "Detalle del contacto" que el pop-up
// del Embudo (B2). Aquí se maneja la etapa/temperatura con las mismas acciones
// del tablero (revalidatePath mantiene ambos en sync), optimista + revert. Sin
// "Ver ficha completa" (B1): todo el detalle ya está en este panel.
import { useState, useTransition } from "react";
import type { ConversationDetail } from "@/lib/inbox/types";
import { updateContactStage, updateContactTemperature } from "@/lib/actions/contacts";
import type { Stage, Temperature } from "../../contactos/_data/types";
import { ContactDetails } from "../../contactos/_components/contact-details";

export function ContactPanel({
  detail,
  onTemperatureChanged,
  action,
}: {
  detail: ConversationDetail;
  /** Botón del encabezado (ocultar el panel). */
  action?: React.ReactNode;
  /** La temperatura cambió aquí: la lista de la Bandeja la refleja (C1). */
  onTemperatureChanged?: (contactId: string, temperature: Temperature | null) => void;
}) {
  const contact = detail.contact;
  const [stage, setStage] = useState<Stage>(contact.stage as Stage);
  const [temperature, setTemperature] = useState<Temperature | null>((contact.temperature as Temperature | null) ?? null);
  // Si la etapa/temperatura cambian desde fuera (la lista, otra pestaña vía
  // SSE), el panel se pone al día. Reset en render al cambiar la prop.
  const [seen, setSeen] = useState({ stage: contact.stage, temperature: contact.temperature });
  if (seen.stage !== contact.stage || seen.temperature !== contact.temperature) {
    setSeen({ stage: contact.stage, temperature: contact.temperature });
    setStage(contact.stage as Stage);
    setTemperature((contact.temperature as Temperature | null) ?? null);
  }
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  function changeStage(next: Stage) {
    const previous = stage;
    setStage(next);
    setError(null);
    startTransition(async () => {
      try {
        await updateContactStage({ contactId: contact.id, stage: next });
      } catch {
        setStage(previous);
        setError("No se pudo cambiar la etapa.");
      }
    });
  }

  function changeTemperature(next: Temperature | null) {
    const previous = temperature;
    setTemperature(next);
    setError(null);
    onTemperatureChanged?.(contact.id, next);
    startTransition(async () => {
      try {
        await updateContactTemperature({ contactId: contact.id, temperature: next });
      } catch {
        setTemperature(previous);
        onTemperatureChanged?.(contact.id, previous);
        setError("No se pudo cambiar la temperatura.");
      }
    });
  }

  return (
    <ContactDetails
      key={contact.id}
      contactId={contact.id}
      name={contact.name}
      phone={contact.phone}
      stage={stage}
      temperature={temperature}
      onStageChange={changeStage}
      onTemperatureChange={changeTemperature}
      busy={isSaving}
      error={error}
      action={action}
    />
  );
}
