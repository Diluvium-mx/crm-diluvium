"use client";

import { useMemo, useState } from "react";
import { STAGES, type Contact, type Stage } from "../_data/types";
import { generateFakeContacts } from "../_data/fake-contacts";
import { ContactCard } from "./contact-card";
import { ContactDetailPanel } from "./contact-detail-panel";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForSearch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

export function ContactsBoard() {
  const [contacts, setContacts] = useState<Contact[]>(() => generateFakeContacts());
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  const normalizedSearch = normalizeForSearch(search.trim());

  const filteredContacts = useMemo(() => {
    if (!normalizedSearch) {
      return contacts;
    }

    const digitsOnlySearch = normalizedSearch.replace(/\s+/g, "");

    return contacts.filter((contact) => {
      const nameMatches = normalizeForSearch(contact.name).includes(normalizedSearch);
      const phoneMatches = contact.phone.replace(/\s+/g, "").includes(digitsOnlySearch);
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
    setContacts((current) => {
      const target = current.find((contact) => contact.id === contactId);
      if (!target) {
        return current;
      }
      const rest = current.filter((contact) => contact.id !== contactId);
      return [{ ...target, stage: nextStage }, ...rest];
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Contactos</h1>
        <input
          type="search"
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-72 rounded border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const stageContacts = columns.get(stage) ?? [];

          return (
            <div
              key={stage}
              className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30"
            >
              <div className="flex items-center justify-between rounded-t-lg bg-brand-navy px-3 py-2 text-brand-white">
                <span className="text-sm font-semibold">{stage}</span>
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
          onClose={() => setSelectedContactId(null)}
          onStageChange={(nextStage) => handleStageChange(selectedContact.id, nextStage)}
        />
      )}
    </div>
  );
}
