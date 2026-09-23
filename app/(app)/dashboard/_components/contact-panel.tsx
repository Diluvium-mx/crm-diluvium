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
  onStageChanged,
  action,
}: {
  detail: ConversationDetail;
  /** Botón del encabezado (ocultar el panel). */
  action?: React.ReactNode;
  /** La temperatura cambió aquí: la lista de la Bandeja la refleja (C1). */
  onTemperatureChanged?: (contactId: string, temperature: Temperature | null) => void;
  /** La etapa cambió aquí: el detalle abierto la refleja (no se regresa a la vieja). */
  onStageChanged?: (contactId: string, stage: Stage) => void;
}) {
  const contact = detail.contact;
  const [stage, setStage] = useState<Stage>(contact.stage as Stage);
  const [temperature, setTemperature] = useState<Temperature | null>((contact.temperature as Temperature | null) ?? null);
  // Si la etapa o la temperatura cambian desde fuera (p. ej. la temperatura
  // desde la lista), el panel se pone al día CAMPO POR CAMPO: un cambio de
  // temperatura no debe regresar la etapa. Reset en render al cambiar la prop.
  const [seenStage, setSeenStage] = useState(contact.stage);
  if (seenStage !== contact.stage) {
    setSeenStage(contact.stage);
    setStage(contact.stage as Stage);
  }
  const [seenTemperature, setSeenTemperature] = useState(contact.temperature);
  if (seenTemperature !== contact.temperature) {
    setSeenTemperature(contact.temperature);
    setTemperature((contact.temperature as Temperature | null) ?? null);
  }
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  function changeStage(next: Stage) {
    const previous = stage;
    setStage(next);
    setError(null);
    onStageChanged?.(contact.id, next);
    startTransition(async () => {
      try {
        await updateContactStage({ contactId: contact.id, stage: next });
      } catch {
        setStage(previous);
        onStageChanged?.(contact.id, previous);
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
