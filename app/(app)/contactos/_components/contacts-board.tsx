"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { STAGES, STAGE_LABELS, getContactFullName, type Contact, type Stage, type Temperature } from "../_data/types";
import { updateContactStage, updateContactTemperature } from "@/lib/actions/contacts";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ContactCard, ContactCardContent } from "./contact-card";
import { ContactDetailPanel } from "./contact-detail-panel";
import { ImportContactsButton } from "./import-contacts-button";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForSearch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

// Type guard: el id del droppable siempre es una etapa (solo las columnas
// son zonas de destino), pero esto lo deja explícito para TypeScript.
function isStage(value: string): value is Stage {
  return (STAGES as string[]).includes(value);
}

// Una columna = una zona de destino (droppable). Se extrae a su propio
// componente porque useDroppable es un hook y no puede llamarse dentro del
// .map() de las etapas.
function StageColumn({
  stage,
  contacts,
  onCardClick,
}: {
  stage: Stage;
  contacts: Contact[];
  onCardClick: (contactId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const scrollRef = useRef<HTMLDivElement>(null);

  // El contenedor scrolleable ES el droppable (ref combinada): así el
  // auto-scroll de dnd-kit —que recorre ancestros scrolleables— puede
  // desplazar la lista al arrastrar cerca del borde, y la colisión encuentra
  // la columna aunque la tarjeta origen se recicle fuera de vista.
  const setColumnRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  // Virtualización: solo se montan las tarjetas visibles (~15) + overscan,
  // reciclando el resto. Es lo que evita el React #441 con miles de contactos.
  // TanStack Virtual devuelve funciones que el React Compiler no puede
  // memoizar; es esperado y no afecta el funcionamiento (además el compiler no
  // está activo en este proyecto).
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: contacts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 74, // alto aprox. de una tarjeta + separación (pb-2)
    overscan: 6,
    getItemKey: (index) => contacts[index]?.id ?? index,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      className={`flex min-h-0 w-72 shrink-0 flex-col rounded-lg border bg-muted transition-colors ${
        isOver ? "ring-2 ring-brand-orange" : ""
      }`}
    >
      <div className="flex items-center justify-between rounded-t-lg bg-brand-navy px-3 py-2 text-brand-white">
        <span className="text-sm font-semibold">{STAGE_LABELS[stage]}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{contacts.length}</span>
      </div>

      <div ref={setColumnRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {contacts.length === 0 ? (
          <p className="p-2 text-center text-xs text-muted-foreground">Sin contactos</p>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualRow) => {
              const contact = contacts[virtualRow.index];
              if (!contact) {
                return null;
              }
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="pb-2"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ContactCard contact={contact} onClick={() => onCardClick(contact.id)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactsBoard({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [syncedInitialContacts, setSyncedInitialContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Distingue un clic (abre el panel) de un arrastre:
  // - MouseSensor con 6px de umbral en escritorio.
  // - TouchSensor con long-press (200ms) en táctil, para que un swipe corto
  //   siga haciendo scroll de la columna (por eso la tarjeta ya no usa
  //   touch-none) y solo el mantener-presionado inicie el arrastre.
  // Sin KeyboardSensor a propósito: la tarjeta es un <button> y Enter/Espacio
  // ya abren el panel de detalle, que es la vía accesible para cambiar etapa.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // Tras un arrastre, el navegador sintetiza un `click` en el pointerup sobre
  // la tarjeta. Sin esto, cada drop abriría además el panel de detalle. La
  // marca se pone al iniciar el arrastre y se limpia en un macrotask posterior
  // al click sintético; si no llega ningún click, igual se limpia y el
  // siguiente clic real funciona.
  const justDraggedRef = useRef(false);

  // La importación CSV llama router.refresh() y pasa una nueva referencia de
  // initialContacts: re-sincroniza el estado local con lo que acaba de
  // confirmar el servidor. Ajuste de estado durante el render (patrón
  // recomendado por React para "resetear estado cuando cambia una prop",
  // https://react.dev/learn/you-might-not-need-an-effect) en vez de un
  // useEffect, que aquí dispara un render en cascada
  // (react-hooks/set-state-in-effect).
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
  const activeContact = activeContactId
    ? contacts.find((contact) => contact.id === activeContactId) ?? null
    : null;

  function handleStageChange(contactId: string, nextStage: Stage) {
    const target = contacts.find((contact) => contact.id === contactId);
    if (!target || target.stage === nextStage) {
      return;
    }
    const previousStage = target.stage;
    setError(null);

    // Optimista: el contacto se refleja de inmediato hasta arriba de la nueva
    // columna. El revert toca SOLO esta tarjeta (no un snapshot de toda la
    // lista): así, si hay otro drag en vuelo que sí persistió, no se pierde.
    setContacts((current) => {
      const found = current.find((contact) => contact.id === contactId);
      if (!found) {
        return current;
      }
      const rest = current.filter((contact) => contact.id !== contactId);
      return [{ ...found, stage: nextStage }, ...rest];
    });

    startTransition(async () => {
      try {
        await updateContactStage({ contactId, stage: nextStage });
      } catch {
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId ? { ...contact, stage: previousStage } : contact,
          ),
        );
        setError("No se pudo actualizar la etapa. Intenta de nuevo.");
      }
    });
  }

  function handleTemperatureChange(contactId: string, nextTemperature: Temperature | null) {
    const target = contacts.find((contact) => contact.id === contactId);
    if (!target || target.temperature === nextTemperature) {
      return;
    }
    const previousTemperature = target.temperature;
    setError(null);

    // Optimista y SIN reordenar: la temperatura no cambia de columna ni de
    // posición, solo el emoji. Revierte solo esta tarjeta si la acción falla.
    setContacts((current) =>
      current.map((contact) =>
        contact.id === contactId ? { ...contact, temperature: nextTemperature } : contact,
      ),
    );

    startTransition(async () => {
      try {
        await updateContactTemperature({ contactId, temperature: nextTemperature });
      } catch {
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId ? { ...contact, temperature: previousTemperature } : contact,
          ),
        );
        setError("No se pudo actualizar la temperatura. Intenta de nuevo.");
      }
    });
  }

  function handleCardClick(contactId: string) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setSelectedContactId(contactId);
  }

  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    setActiveContactId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveContactId(null);
    // Limpia la marca tras el click sintético que dispara el pointerup.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    if (!over) {
      return;
    }
    const overId = String(over.id);
    if (isStage(overId)) {
      handleStageChange(String(active.id), overId);
    }
  }

  function handleDragCancel() {
    setActiveContactId(null);
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
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

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
          {STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              contacts={columns.get(stage) ?? []}
              onCardClick={handleCardClick}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeContact ? (
            <div className="w-72 scale-[1.02] cursor-grabbing shadow-2xl">
              <ContactCardContent contact={activeContact} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedContact && (
        <ContactDetailPanel
          contact={selectedContact}
          isSaving={isPending}
          onClose={() => setSelectedContactId(null)}
          onStageChange={(nextStage) => handleStageChange(selectedContact.id, nextStage)}
          onTemperatureChange={(nextTemperature) =>
            handleTemperatureChange(selectedContact.id, nextTemperature)
          }
        />
      )}
    </div>
  );
}
