"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDetail, ConversationListItem, InboxFilter } from "@/lib/inbox/types";
import {
  getConversation,
  getConversationItems,
  listConversations,
  markConversationRead,
  setConversationStarred,
} from "@/lib/inbox/actions";
import { updateContactTemperature } from "@/lib/actions/contacts";
import type { Temperature } from "../../contactos/_data/types";
import { ChatThread } from "./chat-thread";
import { ContactPanel } from "./contact-panel";
import { ConversationList } from "./conversation-list";
import { useInboxStream } from "./use-inbox-stream";
import { mergeItems } from "@/lib/inbox/list-merge";

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
  const loadedCountRef = useRef(0);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    filterRef.current = filter;
    searchRef.current = search;
    nextCursorRef.current = nextCursor;
    loadingMoreRef.current = loadingMore;
    loadedCountRef.current = conversations.length;
  });

  // Generación de la lista: cambia con filtro/búsqueda y con cada recarga
  // completa. Una respuesta de una generación vieja se descarta (llegó tarde).
  const generationRef = useRef(0);
  // Último pedido por conversación: una respuesta más vieja que el último
  // pedido de ESA conversación no pisa a una más nueva.
  const requestSeqRef = useRef(0);
  const latestRequestRef = useRef(new Map<string, number>());
  const pendingIdsRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Conversaciones que cambiaron durante una recarga completa en curso.
  const touchedDuringRefreshRef = useRef<Set<string> | null>(null);
  const scheduleUpdateRef = useRef<(id: string) => void>(() => {});

  const params = () => ({ filter: filterRef.current, search: searchRef.current.trim() || undefined });

  /**
   * Recarga completa (al cambiar filtro/búsqueda, o `reload` del SSE tras una
   * reconexión). Con `keepLoaded` vuelve a pedir tantas páginas como ya había
   * cargadas: una reconexión no regresa al usuario a la página 1.
   */
  const refreshList = useCallback(async (keepLoaded = false) => {
    const generation = ++generationRef.current;
    // Lo que cambie MIENTRAS esta recarga lee (puede tardar varias páginas) se
    // vuelve a pedir al terminar: la foto completa, más vieja, no lo pisa.
    touchedDuringRefreshRef.current = new Set();
    const want = keepLoaded ? loadedCountRef.current : 0;
    let page = await listConversations(params());
    let items = page.items;
    while (page.nextCursor && items.length < want && generation === generationRef.current) {
      page = await listConversations({ ...params(), cursor: page.nextCursor });
      const seen = new Set(items.map((c) => c.id));
      items = [...items, ...page.items.filter((c) => !seen.has(c.id))];
    }
    if (generation !== generationRef.current) return;
    setConversations(items);
    setNextCursor(page.nextCursor);
    setLoadingList(false);
    const touched = touchedDuringRefreshRef.current;
    touchedDuringRefreshRef.current = null;
    for (const id of touched ?? []) scheduleUpdateRef.current(id);
  }, []);

  // Página siguiente: agrega al final sin duplicar.
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await listConversations({ ...params(), cursor });
      if (generation !== generationRef.current) return;
      setConversations((current) => {
        const seen = new Set(current.map((c) => c.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  /**
   * Actualiza SOLO las conversaciones indicadas (llegó un mensaje, cambió un
   * contador…). Agrupa con debounce: una ráfaga de eventos = un pedido.
   */
  const flushUpdates = useCallback(async () => {
    flushTimerRef.current = undefined;
    const all = [...pendingIdsRef.current];
    pendingIdsRef.current.clear();
    // Lotes de 100 (el máximo que acepta getConversationItems): una ráfaga
    // grande no deja fuera ninguna conversación.
    for (let i = 0; i < all.length; i += 100) {
      const ids = all.slice(i, i + 100);
      const generation = generationRef.current;
      const seq = ++requestSeqRef.current;
      for (const id of ids) latestRequestRef.current.set(id, seq);
      let items: ConversationListItem[];
      try {
        items = await getConversationItems(ids, params());
      } catch {
        // Fallo transitorio (red, deploy): nada se descarta. Este lote y los
        // que faltaban vuelven a la cola y se reintentan en 2 s.
        const failed = all.slice(i);
        setTimeout(() => {
          for (const id of failed) scheduleUpdateRef.current(id);
        }, 2_000);
        return;
      }
      if (generation !== generationRef.current) continue;
      // Solo se aplican las conversaciones cuyo pedido más reciente es este.
      const current = ids.filter((id) => latestRequestRef.current.get(id) === seq);
      if (current.length === 0) continue;
      const fresh = new Map(items.map((item) => [item.id, item]));
      const hasMore = nextCursorRef.current !== null;
      setConversations((list) => mergeItems(list, current, fresh, hasMore));
    }
  }, []);
  // Ventana FIJA de 250 ms: el primer evento programa el envío y los demás se
  // suman al lote sin reiniciar el reloj. Con tráfico sostenido la lista igual
  // se actualiza 4 veces por segundo (un debounce que se reinicia no llegaría nunca).
  const scheduleUpdate = useCallback(
    (conversationId: string) => {
      pendingIdsRef.current.add(conversationId);
      touchedDuringRefreshRef.current?.add(conversationId);
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => void flushUpdates(), 250);
    },
    [flushUpdates],
  );
  useEffect(() => {
    scheduleUpdateRef.current = scheduleUpdate;
  }, [scheduleUpdate]);

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

  useEffect(() => () => clearTimeout(flushTimerRef.current), []);

  // Reloj para semáforo y cuenta regresiva de la ventana.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tiempo real (el mismo hook que el chat del pop-up de Contactos).
  useInboxStream((event) => {
    if (event.type === "reload") {
      void refreshList(true);
      const id = selectedIdRef.current;
      if (id) {
        void refreshDetail(id);
        setRevalToken((n) => n + 1);
      }
      return;
    }
    if (event.type === "contact.created" || event.type === "contacts.bulk") return; // sin conversación aún
    scheduleUpdate(event.conversationId);
    const id = selectedIdRef.current;
    if (!id || event.conversationId !== id) return;
    if (event.type === "conversation.updated") {
      // Ventana de 24 h, estrella, etapa: sin esto una llegada nueva dejaría
      // el composer bloqueado o con la ventana vieja.
      void refreshDetail(id);
    } else {
      setRevalToken((n) => n + 1); // recarga el hilo abierto
      // Marcar leído SOLO si la pestaña está a la vista, y solo hasta el
      // mensaje que llegó (corte): una llegada posterior sigue sin leer.
      if (event.type === "message.upserted" && tabVisible()) {
        void markConversationRead(id, event.messageId).then(() => scheduleUpdate(id));
      }
    }
  });

  // Al volver a la pestaña con una conversación abierta, marcar leído lo que
  // haya llegado mientras estuvo en segundo plano (hasta el último entrante).
  useEffect(() => {
    const onVisible = () => {
      const id = selectedIdRef.current;
      if (id && tabVisible()) {
        void markConversationRead(id).then(() => scheduleUpdate(id));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [scheduleUpdate]);

  function selectConversation(id: string) {
    setSelectedId(id);
    setDetail(null);
    void refreshDetail(id);
    // Abrir la conversación la marca como leída; limpia el contador optimista.
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    void markConversationRead(id).then(() => scheduleUpdate(id));
  }

  // Temperatura del contacto desde la lista (C1) o desde el panel: se refleja en
  // TODAS las filas de ese contacto y en el panel abierto; optimista + revert.
  function applyTemperature(contactId: string, temperature: string | null) {
    setConversations((current) => current.map((c) => (c.contact.id === contactId ? { ...c, temperature } : c)));
    setDetail((d) => (d && d.contact.id === contactId ? { ...d, contact: { ...d.contact, temperature } } : d));
  }

  function changeTemperature(item: ConversationListItem, temperature: Temperature | null) {
    const previous = item.temperature;
    applyTemperature(item.contact.id, temperature);
    updateContactTemperature({ contactId: item.contact.id, temperature }).catch(() => {
      // Revertir SOLO si nadie la cambió después (un fallo tardío no debe
      // pisar un cambio más nuevo).
      setConversations((current) =>
        current.map((c) => (c.contact.id === item.contact.id && c.temperature === temperature ? { ...c, temperature: previous } : c)),
      );
      setDetail((d) =>
        d && d.contact.id === item.contact.id && d.contact.temperature === temperature
          ? { ...d, contact: { ...d.contact, temperature: previous } }
          : d,
      );
    });
  }

  // La etapa cambió en el panel: el detalle abierto la guarda (así un cambio
  // posterior de temperatura no la regresa).
  function applyStage(contactId: string, stage: string) {
    setDetail((d) => (d && d.contact.id === contactId ? { ...d, contact: { ...d.contact, stage } } : d));
  }

  function toggleStar(id: string, starred: boolean) {
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, isStarred: starred } : c)));
    void setConversationStarred(id, starred).then(() => scheduleUpdate(id));
  }

  return (
    // Alto FIJO (pantalla − encabezado de 4rem) y nada se sale: la página no se
    // desliza; cada columna desliza lo suyo (lista, historial del chat, detalle).
    // Sin flex-1: dentro del <main> en columna, flex-1 (base 0%) hacía que el alto
    // saliera del contenido e ignorara este h-[…], y la página crecía con el chat.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 shrink-0 overflow-hidden">
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
              onChangeTemperature={changeTemperature}
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
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            {/* Un solo encabezado: el del "Detalle del contacto", con el botón
                para ocultar el panel (B2: compacto). */}
            <ContactPanel
              detail={detail}
              onTemperatureChanged={applyTemperature}
              onStageChanged={applyStage}
              action={
                <button
                  type="button"
                  onClick={() => setContactOpen(false)}
                  aria-label="Ocultar panel de contacto"
                  title="Ocultar panel"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <PanelRightClose className="size-4" aria-hidden="true" />
                </button>
              }
            />
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
