"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Mail, MailOpen, Star } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ConversationListItem, InboxFilter } from "@/lib/inbox/types";
import type { TemperatureFilter } from "@/lib/contacts/filters";
import { CardFilterButton } from "../../_components/card-filter-button";
import { ChatSearchBadge } from "../../_components/chat-search-badge";
import { CHAT_SEARCH_INPUT_ACTIVE, CHAT_SEARCH_PLACEHOLDER, ChatSearchButton } from "../../_components/chat-search-button";
import { SearchHighlight } from "@/components/ui/search-highlight";
import { snippetAround } from "@/lib/text/highlight";
import { chatSearchTerm } from "@/lib/text/search";
import { ContactAvatar } from "../../contactos/_components/contact-avatar";
import type { Temperature } from "../../contactos/_data/types";
import { TemperaturePicker } from "./temperature-picker";
import { PruebaBadge } from "@/components/ui/prueba-badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  SEMAFORO_CLASS,
  SEMAFORO_LABEL,
  rowPreview,
  semaforo,
  shortTime,
} from "./format";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "unread", label: "No leído" },
  { value: "all", label: "Todo" },
  { value: "starred", label: "Destacado" },
];

function SemaforoDot({ since, nowMs }: { since: Date | null; nowMs: number }) {
  const level = semaforo(since, nowMs);
  if (!level) return null;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${SEMAFORO_CLASS[level]}`}
      title={SEMAFORO_LABEL[level]}
      aria-label={SEMAFORO_LABEL[level]}
    />
  );
}

function ConversationRow({
  item,
  selected,
  nowMs,
  chatTerm,
  onSelect,
  onToggleStar,
  onChangeTemperature,
  onSetUnread,
}: {
  item: ConversationListItem;
  selected: boolean;
  nowMs: number;
  /** Búsqueda en los chats (lupa amarilla) ya normalizada; null = apagada o sin 3 letras. */
  chatTerm: string | null;
  onSelect: (id: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  onChangeTemperature: (item: ConversationListItem, temperature: Temperature | null) => void;
  onSetUnread: (item: ConversationListItem, unread: boolean) => void;
}) {
  // La fila NO es un solo <button>: la estrella y la temperatura son botones
  // hermanos del área que abre la conversación (un botón dentro de otro es HTML
  // inválido y rompía la hidratación). Por eso la luz del cursor es de la FILA
  // (data-glow) y no del área que abre el chat (data-no-glow): así ilumina de
  // lado a lado, también detrás de la estrella y la temperatura.
  // Clic derecho (o pulsación larga en táctil): menú de la conversación; la fila
  // se queda resaltada mientras está abierto.
  const unread = item.unreadCount > 0;
  // Con la lupa: la vista previa es el pedazo donde aparece la palabra (resaltada).
  const match = chatTerm ? item.chatMatch : null;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        data-glow
        className={`flex w-full items-start gap-2 border-b border-border/60 pr-2 transition-colors hover:bg-muted data-popup-open:bg-muted ${
          selected ? "bg-muted" : ""
        }`}
      >
        <button
          type="button"
          data-no-glow
          onClick={() => onSelect(item.id)}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 text-left"
        >
          <ContactAvatar contact={item.contact} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.contact.name}</span>
              {item.isTestChannel && <PruebaBadge />}
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.lastMessage ? shortTime(item.lastMessage.at) : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {match && chatTerm ? (
                  <SearchHighlight text={snippetAround(match.text, chatTerm)} term={chatTerm} />
                ) : (
                  rowPreview(item.lastMessage)
                )}
              </span>
              <SemaforoDot since={item.awaitingReplySince} nowMs={nowMs} />
              {unread && (
                <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[11px] font-semibold text-brand-white">
                  {item.unreadCount > 99 ? "99+" : item.unreadCount}
                </span>
              )}
              {match && <ChatSearchBadge count={match.count} />}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-2.5">
          <button
            type="button"
            onClick={() => onToggleStar(item.id, !item.isStarred)}
            aria-label={item.isStarred ? "Quitar de destacados" : "Marcar como destacado"}
            aria-pressed={item.isStarred}
            title={item.isStarred ? "Quitar de destacados" : "Destacar"}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-brand-orange"
          >
            <Star className={`size-4 ${item.isStarred ? "fill-brand-orange text-brand-orange" : ""}`} aria-hidden="true" />
          </button>
          <TemperaturePicker value={item.temperature} onChange={(t) => onChangeTemperature(item, t)} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSetUnread(item, !unread)}>
          {unread ? <MailOpen aria-hidden="true" /> : <Mail aria-hidden="true" />}
          {unread ? "Marcar como leído" : "Marcar como no leído"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ConversationList({
  items,
  selectedId,
  filter,
  temperature,
  search,
  searchChats,
  chatTerm,
  loading,
  nowMs,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onFilterChange,
  onTemperatureFilterChange,
  onSearchChange,
  onSearchChatsChange,
  onToggleStar,
  onChangeTemperature,
  onSetUnread,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  filter: InboxFilter;
  /** Filtro por temperatura (una a la vez; null = todas). Se suma a la pestaña. */
  temperature: TemperatureFilter | null;
  search: string;
  /** Lupa amarilla: el buscador busca DENTRO de los chats. */
  searchChats: boolean;
  /** Término con el que se pidió la lista (normalizado), para resaltar la vista previa. */
  chatTerm: string | null;
  loading: boolean;
  nowMs: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onFilterChange: (filter: InboxFilter) => void;
  onTemperatureFilterChange: (temperature: TemperatureFilter | null) => void;
  onSearchChange: (value: string) => void;
  onSearchChatsChange: (value: boolean) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  onChangeTemperature: (item: ConversationListItem, temperature: Temperature | null) => void;
  onSetUnread: (item: ConversationListItem, unread: boolean) => void;
}) {
  // Lista virtualizada (misma técnica que el kanban de Contactos): solo se
  // montan las filas visibles aunque haya cientos cargadas. El contenedor
  // scrolleable tiene altura acotada (min-h-0 + flex-1 dentro de un h-full).
  const scrollRef = useRef<HTMLDivElement>(null);
  // Igual que el kanban: useVirtualizer devuelve funciones que el React
  // Compiler no puede memoizar; es esperado (el compiler no está activo).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: (index) => items[index]?.id ?? index,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  // Scroll infinito: al acercarse al final se pide la página siguiente.
  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= items.length - 5) onLoadMore();
  }, [hasMore, loadingMore, lastIndex, items.length, onLoadMore]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        {/* Buscador + lupa (buscar DENTRO de los chats) + filtro por temperatura (Destacado
            ya es la pestaña de abajo). */}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchChats ? CHAT_SEARCH_PLACEHOLDER : "Buscar por nombre o teléfono…"}
            className={`min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 ${
              searchChats ? CHAT_SEARCH_INPUT_ACTIVE : "focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
            }`}
          />
          <ChatSearchButton active={searchChats} onChange={onSearchChatsChange} />
          <CardFilterButton temperature={temperature} onTemperatureChange={onTemperatureFilterChange} />
        </div>
        {searchChats && search.trim() !== "" && !chatSearchTerm(search) && (
          <p className="mt-1.5 text-xs text-muted-foreground">Escribe al menos 3 letras</p>
        )}
        <div className="mt-3 flex gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onFilterChange(tab.value)}
              aria-pressed={filter === tab.value}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                filter === tab.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading && items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {search ? "Sin resultados." : "No hay conversaciones."}
          </p>
        ) : (
          <>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((row) => {
                const item = items[row.index];
                return (
                  <div
                    key={row.key}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <ConversationRow
                      item={item}
                      selected={item.id === selectedId}
                      nowMs={nowMs}
                      chatTerm={chatTerm}
                      onSelect={onSelect}
                      onToggleStar={onToggleStar}
                      onChangeTemperature={onChangeTemperature}
                      onSetUnread={onSetUnread}
                    />
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <p className="p-3 text-center text-xs text-muted-foreground">
                {loadingMore ? "Cargando…" : "Desliza para cargar más"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
