"use client";

import { useMemo, useState, useTransition } from "react";
import { STAGES, STAGE_LABELS, getContactFullName, type Contact, type Stage } from "../_data/types";
import { updateContactStage } from "@/lib/actions/contacts";
import { ContactCard } from "./contact-card";
import { ContactDetailPanel } from "./contact-detail-panel";
import { ImportContactsButton } from "./import-contacts-button";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForSearch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

export function ContactsBoard({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [syncedInitialContacts, setSyncedInitialContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // La importación CSV llama router.refresh() y pasa una nueva referencia de
  // initialContacts: re-sincroniza el estado local con lo que acaba de
  // confirmar el servidor. Ajuste de estado durante el render (patrón
  // recomendado por React para "resetear estado cuando cambia una prop",
  // https://react.dev/learn/you-might-not-need-an-effect) en vez de un
  // useEffect, que aquí dispara un render en cascada
  // (react-hooks/set-state-in-effect). No afecta a handleStageChange (esa
  // Server Action no dispara un refresh), así que el update optimista de
  // abajo sigue funcionando igual.
  if (initialContacts !== syncedInitialContacts) {
    setSyncedInitialContacts(initialContacts);
    setContacts(initialContacts);
  }

  const normalizedSearch = normalizeForSearch(search.trim());

  const filteredContacts = useMemo(() => {
    if (!normalizedSearch) {
      return contacts;
    }

    const digitsOnlySearch = normalizedSearch.replace(/\s+/g, "");

    return contacts.filter((contact) => {
      const nameMatches = normalizeForSearch(getContactFullName(contact)).includes(normalizedSearch);
      const phoneMatches = (contact.phoneE164 ?? "").replace(/\s+/g, "").includes(digitsOnlySearch);
      return nameMatches || phoneMatches;
    });
  }, [contacts, normalizedSearch]);

  const columns = useMemo(() => {
    const map = new Map<Stage, Contact[]>(STAGES.map((stage) => [stage, []]));
    for (const contact of filteredContacts) {
      map.get(contact.stage)?.push(contact);
    }
    return map;
  }, [filteredContacts]);

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) ?? null;

  function handleStageChange(contactId: string, nextStage: Stage) {
    const previousContacts = contacts;
    setError(null);

    // Optimista: el contacto se refleja de inmediato hasta arriba de la
    // nueva columna; si la Server Action falla, se revierte.
    setContacts((current) => {
      const target = current.find((contact) => contact.id === contactId);
      if (!target || target.stage === nextStage) {
        return current;
      }
      const rest = current.filter((contact) => contact.id !== contactId);
      return [{ ...target, stage: nextStage }, ...rest];
    });

    startTransition(async () => {
      try {
        await updateContactStage({ contactId, stage: nextStage });
      } catch {
        setContacts(previousContacts);
        setError("No se pudo actualizar la etapa. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Contactos</h1>
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-72 rounded border px-3 py-2 text-sm"
          />
          <ImportContactsButton />
        </div>
      </div>

      {error && <p className="text-sm text-brand-orange">{error}</p>}

      <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const stageContacts = columns.get(stage) ?? [];

          return (
            <div
              key={stage}
              className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30"
            >
              <div className="flex items-center justify-between rounded-t-lg bg-brand-navy px-3 py-2 text-brand-white">
                <span className="text-sm font-semibold">{STAGE_LABELS[stage]}</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                  {stageContacts.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {stageContacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    onClick={() => setSelectedContactId(contact.id)}
                  />
                ))}
                {stageContacts.length === 0 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">Sin contactos</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedContact && (
        <ContactDetailPanel
          contact={selectedContact}
          isSaving={isPending}
          onClose={() => setSelectedContactId(null)}
          onStageChange={(nextStage) => handleStageChange(selectedContact.id, nextStage)}
        />
      )}
    </div>
  );
}
