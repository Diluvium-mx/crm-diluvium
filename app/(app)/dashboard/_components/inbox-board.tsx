"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDetail, ConversationListItem, InboxEvent, InboxFilter } from "@/lib/inbox/types";
import {
  getConversation,
  listConversations,
  markConversationRead,
  setConversationStarred,
} from "@/lib/inbox/actions";
import { ChatThread } from "./chat-thread";
import { ContactPanel } from "./contact-panel";
import { ConversationList } from "./conversation-list";

function parseEvent(data: string): InboxEvent | null {
  try {
    return JSON.parse(data) as InboxEvent;
  } catch {
    return null;
  }
}

// ¿La pestaña está realmente a la vista? Solo entonces se marca leído por una
// llegada en vivo (una pestaña en segundo plano no debe limpiar el contador
// compartido del equipo y ocultar un lead nuevo).
function tabVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

export function InboxBoard() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [contactOpen, setContactOpen] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [revalToken, setRevalToken] = useState(0);

  // Refs para que los handlers del SSE (suscritos una sola vez) lean el estado
  // actual sin re-suscribirse en cada cambio.
  const selectedIdRef = useRef<string | null>(null);
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  // Sincroniza los refs DESPUÉS del render (no durante), para que los handlers
  // del SSE —suscritos una sola vez— lean siempre el estado actual.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    filterRef.current = filter;
    searchRef.current = search;
    nextCursorRef.current = nextCursor;
    loadingMoreRef.current = loadingMore;
  });

  const refreshList = useCallback(async () => {
    const page = await listConversations({
      filter: filterRef.current,
      search: searchRef.current.trim() || undefined,
    });
    setConversations(page.items);
    setNextCursor(page.nextCursor);
    setLoadingList(false);
  }, []);

  // Página siguiente: agrega al final sin duplicar. La dispara el usuario
  // ("Cargar más"); una recarga en vivo vuelve a la primera página.
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    setLoadingMore(true);
    try {
      const page = await listConversations({
        filter: filterRef.current,
        search: searchRef.current.trim() || undefined,
        cursor,
      });
      setConversations((current) => {
        const seen = new Set(current.map((c) => c.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const next = await getConversation(id);
    // Evita pisar el detalle si el usuario ya cambió de conversación.
    if (selectedIdRef.current === id) setDetail(next);
  }, []);

  // Lista: recarga al cambiar filtro; búsqueda con debounce.
  useEffect(() => {
    const t = setTimeout(() => void refreshList(), 250);
    return () => clearTimeout(t);
  }, [filter, search, refreshList]);

  // Reloj para semáforo y cuenta regresiva de la ventana.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // SSE: una sola conexión para todo el board. EventSource reconecta solo y
  // reenvía `reload` en cada reconexión.
  useEffect(() => {
    const source = new EventSource("/api/inbox/stream");

    // conversation.updated: refresca la lista y, si es la conversación abierta,
    // vuelve a pedir el detalle (ventana de 24 h, estrella, etapa) — sin esto,
    // una llegada nueva dejaría el composer bloqueado o con la ventana vieja.
    const onConversation = (event: MessageEvent) => {
      void refreshList();
      const payload = parseEvent(event.data);
      const id = selectedIdRef.current;
      if (id && payload && "conversationId" in payload && payload.conversationId === id) {
        void refreshDetail(id);
      }
    };
    const onReload = () => {
      void refreshList();
      const id = selectedIdRef.current;
      if (id) {
        void refreshDetail(id);
        setRevalToken((n) => n + 1);
      }
    };
    const onUpserted = (event: MessageEvent) => {
      void refreshList();
      const payload = parseEvent(event.data);
      const id = selectedIdRef.current;
      if (id && payload && "conversationId" in payload && payload.conversationId === id) {
        setRevalToken((n) => n + 1); // recarga el hilo abierto
        // Marcar leído SOLO si la pestaña está a la vista, y solo hasta el
        // mensaje que llegó (corte): una llegada posterior sigue sin leer.
        if (tabVisible()) {
          const upTo = "messageId" in payload ? payload.messageId : undefined;
          void markConversationRead(id, upTo).then(() => void refreshList());
        }
      }
    };
    const onDeleted = (event: MessageEvent) => {
      void refreshList();
      const payload = parseEvent(event.data);
      const id = selectedIdRef.current;
      if (id && payload && "conversationId" in payload && payload.conversationId === id) {
        setRevalToken((n) => n + 1);
      }
    };

    source.addEventListener("reload", onReload);
    source.addEventListener("conversation.updated", onConversation);
    source.addEventListener("message.upserted", onUpserted);
    source.addEventListener("message.deleted", onDeleted);
    return () => source.close();
  }, [refreshList, refreshDetail]);

  // Al volver a la pestaña con una conversación abierta, marcar leído lo que
  // haya llegado mientras estuvo en segundo plano (hasta el último entrante).
  useEffect(() => {
    const onVisible = () => {
      const id = selectedIdRef.current;
      if (id && tabVisible()) {
        void markConversationRead(id).then(() => void refreshList());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshList]);

  function selectConversation(id: string) {
    setSelectedId(id);
    setDetail(null);
    void refreshDetail(id);
    // Abrir la conversación la marca como leída; limpia el contador optimista.
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    void markConversationRead(id).then(() => void refreshList());
  }

  function toggleStar(id: string, starred: boolean) {
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, isStarred: starred } : c)));
    void setConversationStarred(id, starred).then(() => void refreshList());
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-1">
      {/* Columna: lista (colapsable) */}
      {listOpen ? (
        <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h1 className="text-sm font-semibold">Bandeja</h1>
            <button
              type="button"
              onClick={() => setListOpen(false)}
              aria-label="Ocultar lista"
              title="Ocultar lista"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ConversationList
              items={conversations}
              selectedId={selectedId}
              filter={filter}
              search={search}
              loading={loadingList}
              nowMs={nowMs}
              hasMore={nextCursor !== null}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
              onSelect={selectConversation}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
              onToggleStar={toggleStar}
            />
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-label="Mostrar lista"
          title="Mostrar lista"
          className="flex w-10 shrink-0 items-start justify-center border-r bg-card pt-3 text-muted-foreground hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        </button>
      )}

      {/* Columna: chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        {detail ? (
          <ChatThread detail={detail} revalToken={revalToken} nowMs={nowMs} />
        ) : selectedId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <span className="text-3xl" aria-hidden="true">💬</span>
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        )}
      </section>

      {/* Columna: panel de contacto (colapsable) */}
      {detail &&
        (contactOpen ? (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">Contacto</span>
              <button
                type="button"
                onClick={() => setContactOpen(false)}
                aria-label="Ocultar panel de contacto"
                title="Ocultar panel"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <PanelRightClose className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ContactPanel detail={detail} />
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            aria-label="Mostrar panel de contacto"
            title="Mostrar panel"
            className="flex w-10 shrink-0 items-start justify-center border-l bg-card pt-3 text-muted-foreground hover:text-foreground"
          >
            <PanelRightOpen className="size-4" aria-hidden="true" />
          </button>
        ))}
    </div>
  );
}
