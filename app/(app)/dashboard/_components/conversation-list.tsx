"use client";

import { Star } from "lucide-react";
import type { ConversationListItem, InboxFilter } from "@/lib/inbox/types";
import { ContactAvatar } from "../../contactos/_components/contact-avatar";
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
  onSelect,
  onToggleStar,
}: {
  item: ConversationListItem;
  selected: boolean;
  nowMs: number;
  onSelect: (id: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted ${
        selected ? "bg-muted" : ""
      }`}
    >
      <ContactAvatar contact={item.contact} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.contact.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {item.lastMessage ? shortTime(item.lastMessage.at) : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {rowPreview(item.lastMessage)}
          </span>
          <SemaforoDot since={item.awaitingReplySince} nowMs={nowMs} />
          {item.unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[11px] font-semibold text-brand-white">
              {item.unreadCount > 99 ? "99+" : item.unreadCount}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleStar(item.id, !item.isStarred);
        }}
        aria-label={item.isStarred ? "Quitar de destacados" : "Marcar como destacado"}
        aria-pressed={item.isStarred}
        title={item.isStarred ? "Quitar de destacados" : "Destacar"}
        className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-brand-orange"
      >
        <Star className={`size-4 ${item.isStarred ? "fill-brand-orange text-brand-orange" : ""}`} aria-hidden="true" />
      </button>
    </button>
  );
}

export function ConversationList({
  items,
  selectedId,
  filter,
  search,
  loading,
  nowMs,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onFilterChange,
  onSearchChange,
  onToggleStar,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  filter: InboxFilter;
  search: string;
  loading: boolean;
  nowMs: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (value: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
        />
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {search ? "Sin resultados." : "No hay conversaciones."}
          </p>
        ) : (
          <>
            {items.map((item) => (
              <ConversationRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                nowMs={nowMs}
                onSelect={onSelect}
                onToggleStar={onToggleStar}
              />
            ))}
            {hasMore && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full rounded-md border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {loadingMore ? "Cargando…" : "Cargar más conversaciones"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
