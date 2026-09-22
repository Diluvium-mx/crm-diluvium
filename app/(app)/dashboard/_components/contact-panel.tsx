"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ConversationDetail } from "@/lib/inbox/types";
import { updateContactStage, updateContactTemperature } from "@/lib/actions/contacts";
import {
  STAGES,
  STAGE_LABELS,
  TEMPERATURES,
  TEMPERATURE_EMOJI,
  TEMPERATURE_LABELS,
  type Stage,
  type Temperature,
} from "../../contactos/_data/types";
import { displayPhone } from "@/lib/phone-format";

export function ContactPanel({ detail }: { detail: ConversationDetail }) {
  const router = useRouter();
  const contact = detail.contact;
  const [stage, setStage] = useState<string>(contact.stage);
  const [temperature, setTemperature] = useState<string>(contact.temperature ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  // La etapa/temperatura se guardan con las MISMAS acciones del tablero de
  // Contactos (revalidatePath mantiene ambos en sync). Optimista + revert.
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
    setTemperature(next ?? "");
    setError(null);
    startTransition(async () => {
      try {
        await updateContactTemperature({ contactId: contact.id, temperature: next });
      } catch {
        setTemperature(previous);
        setError("No se pudo cambiar la temperatura.");
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-5">
      <div>
        <h2 className="text-sm font-semibold">Detalle del contacto</h2>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Nombre</dt>
          <dd className="mt-0.5 break-words">{contact.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Teléfono</dt>
          <dd className="mt-0.5 break-words">{displayPhone(contact.phone) || "—"}</dd>
        </div>
      </dl>

      <div className="space-y-1">
        <label htmlFor="panel-stage" className="text-xs text-muted-foreground">
          Etapa
        </label>
        <select
          id="panel-stage"
          value={stage}
          disabled={isSaving}
          onChange={(event) => changeStage(event.target.value as Stage)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30 disabled:opacity-60"
        >
          {STAGES.map((value) => (
            <option key={value} value={value}>
              {STAGE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="panel-temperature" className="text-xs text-muted-foreground">
          Temperatura
        </label>
        <select
          id="panel-temperature"
          value={temperature}
          disabled={isSaving}
          onChange={(event) =>
            changeTemperature(event.target.value === "" ? null : (event.target.value as Temperature))
          }
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30 disabled:opacity-60"
        >
          <option value="">Sin asignar</option>
          {TEMPERATURES.map((value) => (
            <option key={value} value={value}>
              {TEMPERATURE_EMOJI[value]} {TEMPERATURE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-brand-orange">{error}</p>}

      <button
        type="button"
        onClick={() => router.push("/contactos")}
        className="mt-auto rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
      >
        Ver ficha completa
      </button>
    </div>
  );
}
