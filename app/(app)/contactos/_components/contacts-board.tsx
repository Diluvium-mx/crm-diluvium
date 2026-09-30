"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  type Modifier,
} from "@dnd-kit/core";
import { Mail, Pencil, Plus, X } from "lucide-react";
import { getContactFullName, type BoardContact, type Stage, type Temperature } from "../_data/types";
import { useFunnelStages } from "../../_components/funnel-stages-provider";
import { StagesEditor } from "../../_components/stages-editor";
import { NewContactDialog } from "./new-contact-dialog";
import type { FunnelStage } from "@/lib/contacts/stages";
import {
  getContactsByIds,
  getContactsChangedSince,
  getFunnelSignals,
  setContactDestacado,
  updateContactStage,
  updateContactTemperature,
} from "@/lib/actions/contacts";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ContactCard, ContactCardContent } from "./contact-card";
import { ContactDetailPanel } from "./contact-detail-panel";
import { phoneMatchesSearch } from "@/lib/phone-format";
import { chatSearchTerm, normalizeSearch } from "@/lib/text/search";
import { hasCardFilter, matchesCardFilter, type TemperatureFilter } from "@/lib/contacts/filters";
import { CardFilterButton } from "../../_components/card-filter-button";
import { CHAT_SEARCH_INPUT_ACTIVE, CHAT_SEARCH_PLACEHOLDER, ChatSearchButton } from "../../_components/chat-search-button";
import { funnelTone, needsAttention, type FunnelSignal } from "@/lib/contacts/funnel-tone";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";
import { searchChatsByContact, setContactUnread } from "@/lib/inbox/actions";
import { applyMarks, columnsByStage, mergeLiveContacts } from "./board-live";
import { CloseX } from "@/components/ui/close-x";

// Una columna = una zona de destino (droppable). Se extrae a su propio
// componente porque useDroppable es un hook y no puede llamarse dentro del
// .map() de las etapas.
type Signals = Record<string, FunnelSignal>;

// Tope de conversaciones por petición (el mismo que valida getFunnelSignals); con
// más, se piden las señales de toda la organización de una vez.
const MAX_SIGNAL_IDS = 200;
// Tope de contactos por petición (el mismo que valida getContactsByIds).
const MAX_LIVE_IDS = 200;
// Durante la importación del historial del celular, el tablero se relee a lo más así.
const HISTORY_REFRESH_MS = 30_000;
const CHAT_SEARCH_ERROR = "No se pudo buscar en los chats. Intenta de nuevo.";

function StageColumn({
  stage,
  contacts,
  signals,
  chatHits,
  emptyText,
  onlyUnread,
  hasUnread,
  onToggleUnread,
  onCardClick,
  onSetUnread,
}: {
  stage: FunnelStage;
  contacts: BoardContact[];
  signals: Signals;
  /** Lupa amarilla: por contacto, cuántos mensajes tienen la palabra (círculo amarillo). */
  chatHits: Map<string, number> | null;
  /** Qué dice la columna vacía ("Sin contactos", "Ninguno con este filtro"…). */
  emptyText: string;
  /** Botón «No leído» prendido en esta columna: solo quedan las tarjetas con algo pendiente. */
  onlyUnread: boolean;
  /** ¿La columna tiene alguna tarjeta con algo pendiente? (apagado, el sobre sale tenue si no). */
  hasUnread: boolean;
  onToggleUnread: () => void;
  onCardClick: (contactId: string) => void;
  onSetUnread: (contactId: string, unread: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
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
    // Alto medido de una tarjeta con la línea "📍 ciudad por lada" + separación
    // (pb-2): 94 px (76 sin teléfono o sin dato de lada; measureElement corrige).
    estimateSize: () => 94,
    overscan: 6,
    getItemKey: (index) => contacts[index]?.id ?? index,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      // Móvil (< sm): cada columna ocupa la pantalla (menos el margen) y el tablero
      // se desliza de lado columna por columna (snap); desde sm, el ancho fijo de siempre.
      className={`flex min-h-0 w-[calc(100vw-2.5rem)] shrink-0 snap-center flex-col rounded-lg border bg-muted transition-all duration-150 sm:w-72 sm:snap-align-none ${
        isOver ? "scale-[1.01] shadow-lg ring-2 ring-brand-orange ring-offset-2 ring-offset-background" : ""
      }`}
    >
      <div className="flex items-center justify-between rounded-t-lg bg-brand-navy px-3 py-2 text-brand-white">
        <span className="truncate text-sm font-semibold">{stage.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* «No leído» (30-sep-2026): píldora del mismo alto que el contador, solo el sobre.
              Naranja = prendido; tenue = la columna no tiene nada pendiente. */}
          <button
            type="button"
            onClick={onToggleUnread}
            aria-pressed={onlyUnread}
            aria-label="Solo no leídos y sin contestar"
            title={onlyUnread ? "Mostrar todas" : hasUnread ? "Solo no leídos y sin contestar" : "Nada sin leer ni sin contestar"}
            className={`flex h-5 items-center justify-center rounded-full px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              onlyUnread
                ? "bg-brand-orange text-brand-white hover:bg-brand-orange-light"
                : hasUnread
                  ? "bg-white/20 text-brand-white hover:bg-white/30"
                  : "bg-white/10 text-white/40 hover:bg-white/20 hover:text-white/70"
            }`}
          >
            <Mail className="size-3.5" aria-hidden="true" />
          </button>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{contacts.length}</span>
        </div>
      </div>

      <div ref={setColumnRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {contacts.length === 0 ? (
          <p className="p-2 text-center text-xs text-muted-foreground">{emptyText}</p>
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
                  <ContactCard
                    contact={contact}
                    signal={signals[contact.id]}
                    chatHits={chatHits?.get(contact.id)}
                    onClick={() => onCardClick(contact.id)}
                    onSetUnread={(unread) => onSetUnread(contact.id, unread)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactsBoard({
  initialContacts,
  initialSignals,
  loadedAt,
  openContactId = null,
}: {
  initialContacts: BoardContact[];
  initialSignals: Signals;
  /** Hora del servidor (ISO) ANTES de leer initialContacts: desde ahí se ponen al día. */
  loadedAt: string;
  /** /embudo?contacto=<id>: abre ese contacto al entrar (desde la Bandeja, si aún no tiene chat). */
  openContactId?: string | null;
}) {
  const [contacts, setContacts] = useState<BoardContact[]>(initialContacts);
  // Columnas del Embudo (editables; llegan en vivo por el contexto).
  const { stages, lastEvent: stagesEvent, refresh: refreshStages } = useFunnelStages();
  const stageKeys = useMemo(() => new Set(stages.map((s) => s.key)), [stages]);
  const [editingStages, setEditingStages] = useState(false);
  // Señales de cada tarjeta (no vistos, por contestar, urgente y hora del último
  // mensaje del cliente) por contacto. Van aparte de los contactos: el SSE las cambia
  // seguido; solo la hora del último mensaje reordena (sube la tarjeta en su columna).
  const [signals, setSignals] = useState<Signals>(initialSignals);
  const [syncedInitialSignals, setSyncedInitialSignals] = useState(initialSignals);
  const router = useRouter();
  // Contactos agregados por el SSE que el servidor aún no ha devuelto en una
  // recarga (ver la sincronización con initialContacts más abajo).
  const [liveAdded, setLiveAdded] = useState<BoardContact[]>([]);
  const [syncedInitialContacts, setSyncedInitialContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  // Filtro por temperatura (una a la vez) y ⭐ Destacado (la marca del contacto),
  // combinables; se suman al buscador. Las columnas no cambian: mismas etapas, orden y
  // colores; solo quedan las tarjetas que cumplen. No se recuerda entre recargas.
  const [temperatureFilter, setTemperatureFilter] = useState<TemperatureFilter | null>(null);
  const [destacadoOnly, setDestacadoOnly] = useState(false);
  // Botón «No leído» de cada columna (30-sep-2026): etapas con el sobre prendido. Cada
  // columna va por su lado y se suma al buscador, la lupa y el filtro. No se recuerda al
  // recargar. Qué cuenta como pendiente: `needsAttention` (naranja, azul o amarilla).
  const [unreadStages, setUnreadStages] = useState<ReadonlySet<string>>(() => new Set());
  // Tarjeta abierta desde el tablero: aunque abrirla la marque leída, no se va de su
  // columna con «No leído» mientras el pop-up siga abierto (se va al cerrarlo).
  const [keptContactId, setKeptContactId] = useState<string | null>(null);
  // Lupa amarilla (29-sep-2026): el mismo buscador busca una palabra DENTRO de los chats;
  // solo quedan las tarjetas con la palabra, con su círculo amarillo. No se recuerda al
  // recargar. `chatHits` = el último resultado (contacto → cuántos mensajes) y su palabra.
  const [searchChats, setSearchChats] = useState(false);
  const [chatHits, setChatHits] = useState<{ term: string; counts: Map<string, number> } | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(() =>
    openContactId && initialContacts.some((contact) => contact.id === openContactId) ? openContactId : null,
  );
  // El ?contacto= ya se usó: se quita de la dirección sin recargar (así recargar
  // la página no lo vuelve a abrir).
  useEffect(() => {
    if (openContactId) window.history.replaceState(null, "", "/embudo");
  }, [openContactId]);
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

  // El DragOverlay es position:fixed; sin limites la tarjeta levantada se
  // monta sobre el sidebar, sube arriba de las columnas y se sale por el
  // borde derecho. Este modifier la mantiene dentro del recuadro visible de
  // las columnas (el highlight vive por columna; el pop-up se contiene aqui).
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const restrictOverlayToBoard = useCallback<Modifier>(
    ({ transform, draggingNodeRect, overlayNodeRect }) => {
      const rect = overlayNodeRect ?? draggingNodeRect;
      const bounds = boardScrollRef.current?.getBoundingClientRect();
      if (!rect || !bounds) {
        return transform;
      }
      const next = { ...transform };
      if (rect.left + next.x < bounds.left) {
        next.x = bounds.left - rect.left;
      }
      if (rect.top + next.y < bounds.top) {
        next.y = bounds.top - rect.top;
      }
      if (rect.left + next.x + rect.width > bounds.right) {
        next.x = bounds.right - rect.width - rect.left;
      }
      if (rect.top + next.y + rect.height > bounds.bottom) {
        next.y = bounds.bottom - rect.height - rect.top;
      }
      return next;
    },
    [],
  );

  // La importación CSV llama router.refresh() y pasa una nueva referencia de
  // initialContacts: re-sincroniza el estado local con lo que acaba de
  // confirmar el servidor. Ajuste de estado durante el render (patrón
  // recomendado por React para "resetear estado cuando cambia una prop",
  // https://react.dev/learn/you-might-not-need-an-effect) en vez de un
  // useEffect, que aquí dispara un render en cascada
  // (react-hooks/set-state-in-effect).
  // Los contactos que el SSE agregó en vivo se CONSERVAN al sincronizar: una
  // recarga (p. ej. por contacts.bulk) pudo leer la base ANTES de que se
  // crearan y, si reemplazara todo, los borraría de la vista sin aviso.
  if (initialContacts !== syncedInitialContacts) {
    setSyncedInitialContacts(initialContacts);
    const fromServer = new Set(initialContacts.map((c) => c.id));
    const stillMissing = liveAdded.filter((c) => !fromServer.has(c.id));
    setContacts(stillMissing.length ? [...stillMissing, ...initialContacts] : initialContacts);
    if (stillMissing.length !== liveAdded.length) setLiveAdded(stillMissing);
  }
  if (initialSignals !== syncedInitialSignals) {
    setSyncedInitialSignals(initialSignals);
    setSignals(initialSignals);
  }

  // Tiempo real: un contacto NUEVO (p. ej. el primer WhatsApp de un número
  // desconocido) aparece arriba de su columna sin recargar. Se agrupan los
  // avisos (una importación manda miles): hasta 200 se piden por id; más que
  // eso, se recarga la página completa una vez.
  // Si la petición falla, los ids vuelven a la espera y se reintenta sola (5 s …
  // 60 s): un lead nuevo no se queda fuera del Embudo por un fallo de red.
  // ¿Sigue montado el Embudo? (ningún reintento sobrevive a salir de él).
  const aliveRef = useRef(true);
  const pendingNewRef = useRef(new Set<string>());
  const newTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newRetryMsRef = useRef(0);
  useEffect(() => () => clearTimeout(newTimerRef.current), []);
  const bulkRef = useRef(false);
  const flushNewRef = useRef<() => Promise<void>>(async () => undefined);
  const flushNew = useCallback(async () => {
    newTimerRef.current = undefined;
    const ids = [...pendingNewRef.current];
    pendingNewRef.current.clear();
    if (bulkRef.current || ids.length > 200) {
      bulkRef.current = false;
      router.refresh();
      return;
    }
    let fresh: BoardContact[];
    try {
      fresh = await getContactsByIds(ids);
    } catch {
      for (const id of ids) pendingNewRef.current.add(id);
      if (aliveRef.current && !newTimerRef.current) {
        newRetryMsRef.current = Math.min(newRetryMsRef.current ? newRetryMsRef.current * 2 : 5_000, 60_000);
        newTimerRef.current = setTimeout(() => void flushNewRef.current(), newRetryMsRef.current);
      }
      return;
    }
    newRetryMsRef.current = 0;
    if (!aliveRef.current || fresh.length === 0) return;
    setContacts((current) => {
      const known = new Set(current.map((c) => c.id));
      const added = fresh.filter((c) => !known.has(c.id));
      return added.length ? [...added, ...current] : current;
    });
    setLiveAdded((current) => {
      const known = new Set(current.map((c) => c.id));
      return [...fresh.filter((c) => !known.has(c.id)), ...current];
    });
  }, [router]);
  useEffect(() => {
    flushNewRef.current = flushNew;
  }, [flushNew]);
  // Lote del historial del celular con contactos nuevos (`inbox.bulk`): el tablero se
  // relee a lo más cada 30 s mientras dura la importación (con 10,000+ contactos,
  // releerlo cada 5 s estorbaría al vendedor). El historial no cambia las señales de
  // las tarjetas (no leídos, pendiente, aviso): no se piden.
  const historyRefreshRef = useRef<{ last: number; timer?: ReturnType<typeof setTimeout> }>({ last: 0 });
  useEffect(() => () => clearTimeout(historyRefreshRef.current.timer), []);
  const scheduleHistoryRefresh = useCallback(() => {
    const h = historyRefreshRef.current;
    if (h.timer) return;
    h.timer = setTimeout(() => {
      h.timer = undefined;
      h.last = Date.now();
      bulkRef.current = true;
      void flushNewRef.current();
    }, Math.max(0, h.last + HISTORY_REFRESH_MS - Date.now()));
  }, []);
  // Señales en tiempo real: cada cambio de mensaje o conversación (entrante,
  // respuesta, leído, aviso del agente) marca su conversación; se piden en lote
  // (ventana de 500 ms) y UNA petición a la vez: lo que llega mientras tanto sale
  // en la siguiente vuelta, así una respuesta vieja nunca pisa a una nueva.
  // `reload` (reconexión del SSE) o más de 200 conversaciones → toda la
  // organización. Si una petición falla, se reintenta sola con espera creciente
  // (5 s … 60 s): un aviso urgente no se pierde aunque la conversación quede quieta.
  const signalQueueRef = useRef({ ids: new Set<string>(), full: false, running: false, retryMs: 0, retryPending: false });
  const signalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Al salir del Embudo: nada queda pidiendo señales (ni un reintento programado
  // por una petición que falle DESPUÉS de desmontar).
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(signalTimerRef.current);
      signalTimerRef.current = undefined;
    };
  }, []);
  // El reintento llama a la versión vigente sin que el callback se refiera a sí mismo.
  const flushSignalsRef = useRef<() => Promise<void>>(async () => undefined);
  const flushSignals = useCallback(async () => {
    signalTimerRef.current = undefined;
    const queue = signalQueueRef.current;
    queue.retryPending = false;
    queue.running = true;
    let failed = false;
    try {
      while (queue.full || queue.ids.size > 0) {
        const full = queue.full || queue.ids.size > MAX_SIGNAL_IDS;
        const ids = full ? undefined : [...queue.ids];
        queue.full = false;
        queue.ids.clear();
        try {
          const fresh = await getFunnelSignals(ids);
          if (!aliveRef.current) return;
          setSignals((current) => (full ? fresh : { ...current, ...fresh }));
          queue.retryMs = 0;
        } catch {
          if (full) queue.full = true;
          else for (const id of ids ?? []) queue.ids.add(id);
          failed = true;
          break;
        }
      }
    } finally {
      queue.running = false;
    }
    if (failed && aliveRef.current && !signalTimerRef.current) {
      queue.retryMs = Math.min(queue.retryMs ? queue.retryMs * 2 : 5_000, 60_000);
      queue.retryPending = true;
      signalTimerRef.current = setTimeout(() => void flushSignalsRef.current(), queue.retryMs);
    }
  }, []);
  useEffect(() => {
    flushSignalsRef.current = flushSignals;
  }, [flushSignals]);

  // Cambios de contacto en vivo (contact.updated): la etapa o la temperatura que
  // cambió el Agente IA, una automatización (/banco) u otro vendedor. Mismo patrón
  // que las señales: lote de 500 ms (ventana fija), UNA petición a la vez (una
  // respuesta vieja nunca pisa a una nueva) y reintento a los 5 s si falla.
  // - La tarjeta que el vendedor está arrastrando no se le mueve de las manos: su
  //   cambio espera a que la suelte; si la soltó en otra columna, manda la etapa
  //   que puso el vendedor (regla de siempre) y lo demás del cambio sí entra.
  // - Mientras una escritura del propio vendedor sobre ese contacto está en curso,
  //   no se aplica una lectura (pudo salir antes de su escritura): al terminar se
  //   vuelve a leer.
  // - Cada `reload` del SSE (al conectarse y en cada reconexión) pide, en la MISMA
  //   fila, los contactos que cambiaron de etapa desde la última vez (`sinceRef`,
  //   hora del servidor): lo movido entre que cargó la página y que empezó a
  //   escuchar, o con la conexión caída, no se pierde.
  const liveQueueRef = useRef({ ids: new Set<string>(), catchUp: false, running: false, retryPending: false });
  const sinceRef = useRef(loadedAt);
  // Contactos aplicados en vivo hace poco: si después llega una recarga completa
  // (contacts.bulk, importación) con una foto leída antes, se releen.
  const recentLiveRef = useRef(new Map<string, number>());
  // Tarjeta en arrastre a la que la puesta al día no le tocó la temperatura: se
  // relee al soltarla.
  const dragMissedRef = useRef(new Set<string>());
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingIdRef = useRef<string | null>(null);
  const heldRef = useRef(new Map<string, BoardContact>());
  const writesRef = useRef(new Map<string, number>());
  const staleRef = useRef(new Set<string>());
  useEffect(() => () => clearTimeout(liveTimerRef.current), []);
  const flushLiveRef = useRef<() => Promise<void>>(async () => undefined);
  const flushLive = useCallback(async () => {
    liveTimerRef.current = undefined;
    const queue = liveQueueRef.current;
    queue.retryPending = false;
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.catchUp || queue.ids.size > 0) {
        const catchUp = queue.catchUp;
        const ids = catchUp ? [] : [...queue.ids].slice(0, MAX_LIVE_IDS);
        queue.catchUp = false;
        for (const id of ids) queue.ids.delete(id);
        let fresh: BoardContact[];
        try {
          if (catchUp) {
            const changed = await getContactsChangedSince(sinceRef.current);
            if (!aliveRef.current) return;
            sinceRef.current = changed.now;
            // Demasiados (un cambio masivo): el tablero completo, una vez.
            if (changed.tooMany) {
              router.refresh();
              continue;
            }
            // La temperatura no lleva hora: se compara completa. Sin tocar las que el
            // vendedor está escribiendo o arrastrando (se releen al terminar).
            const skip = new Set(writesRef.current.keys());
            for (const id of skip) staleRef.current.add(id);
            if (draggingIdRef.current) {
              skip.add(draggingIdRef.current);
              dragMissedRef.current.add(draggingIdRef.current);
            }
            setContacts((current) => applyMarks(current, changed.temperatures, changed.destacados, skip));
            fresh = changed.contacts;
          } else {
            fresh = await getContactsByIds(ids);
          }
        } catch {
          if (catchUp) queue.catchUp = true;
          for (const id of ids) queue.ids.add(id);
          if (aliveRef.current && !liveTimerRef.current) {
            queue.retryPending = true;
            liveTimerRef.current = setTimeout(() => void flushLiveRef.current(), 5_000);
          }
          return;
        }
        if (!aliveRef.current) return;
        const apply: BoardContact[] = [];
        for (const contact of fresh) {
          if (draggingIdRef.current === contact.id) {
            heldRef.current.set(contact.id, contact);
            // Si una recarga completa llega después de soltarla, se relee.
            recentLiveRef.current.set(contact.id, Date.now());
          } else if (writesRef.current.has(contact.id)) staleRef.current.add(contact.id);
          else apply.push(contact);
        }
        if (apply.length > 0) {
          const at = Date.now();
          for (const contact of apply) recentLiveRef.current.set(contact.id, at);
          setContacts((current) => mergeLiveContacts(current, apply));
          const byId = new Map(apply.map((contact) => [contact.id, contact]));
          setLiveAdded((current) => current.map((contact) => byId.get(contact.id) ?? contact));
        }
      }
    } finally {
      queue.running = false;
    }
  }, [router]);
  useEffect(() => {
    flushLiveRef.current = flushLive;
  }, [flushLive]);
  // `null` = ponerse al día (reload del SSE); un id = releer ese contacto.
  const scheduleLive = useCallback(
    (contactId: string | null) => {
      const queue = liveQueueRef.current;
      if (contactId === null) queue.catchUp = true;
      else queue.ids.add(contactId);
      if (queue.running) return;
      // En espera de un reintento: un cambio nuevo lo adelanta.
      if (queue.retryPending) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = undefined;
        queue.retryPending = false;
      }
      if (!liveTimerRef.current) liveTimerRef.current = setTimeout(() => void flushLive(), 500);
    },
    [flushLive],
  );
  // Escrituras del vendedor (etapa o temperatura) en curso, por contacto.
  function beginWrite(contactId: string) {
    writesRef.current.set(contactId, (writesRef.current.get(contactId) ?? 0) + 1);
  }
  function endWrite(contactId: string, failed: boolean) {
    const left = (writesRef.current.get(contactId) ?? 1) - 1;
    if (left > 0) {
      writesRef.current.set(contactId, left);
      return;
    }
    writesRef.current.delete(contactId);
    // Se saltó una lectura mientras escribía, o falló (el revert pudo quedar
    // viejo): se relee lo que el servidor tiene.
    if (staleRef.current.delete(contactId) || failed) scheduleLive(contactId);
  }
  // Llegó una recarga completa (contacts.bulk, importación): su foto pudo leerse
  // ANTES de un cambio que ya se aplicó en vivo; esos contactos se releen.
  useEffect(() => {
    const cutoff = Date.now() - 120_000;
    for (const [id, at] of recentLiveRef.current) {
      recentLiveRef.current.delete(id);
      if (at >= cutoff) scheduleLive(id);
    }
  }, [syncedInitialContacts, scheduleLive]);

  // Cambió el juego de columnas (otra sesión renombró, reordenó o borró una): al
  // borrar, sus contactos se movieron en un solo UPDATE; se ponen al día por
  // stage_changed_at (≤200; más, recarga completa), sin un evento por contacto.
  const lastStagesEventRef = useRef(stagesEvent);
  useEffect(() => {
    if (stagesEvent === lastStagesEventRef.current) return;
    lastStagesEventRef.current = stagesEvent;
    if (stagesEvent?.reason === "deleted") scheduleLive(null);
  }, [stagesEvent, scheduleLive]);

  // Búsqueda en los chats: la pide el servidor (el tablero no tiene los mensajes). Una
  // respuesta vieja nunca pisa a una nueva (seq). Con la lupa prendida, lo que llega por el
  // SSE (mensajes nuevos o borrados) vuelve a buscar, a lo más cada 1.5 s.
  const chatTerm = searchChats ? chatSearchTerm(search) : null;
  const chatTermRef = useRef(chatTerm);
  useEffect(() => {
    chatTermRef.current = chatTerm;
  });
  const chatSeqRef = useRef(0);
  const runChatSearch = useCallback(async (term: string) => {
    const seq = ++chatSeqRef.current;
    try {
      const rows = await searchChatsByContact(term);
      if (!aliveRef.current || seq !== chatSeqRef.current) return;
      setChatHits({ term, counts: new Map(rows) });
      setError((current) => (current === CHAT_SEARCH_ERROR ? null : current));
    } catch {
      if (aliveRef.current && seq === chatSeqRef.current) setError(CHAT_SEARCH_ERROR);
    }
  }, []);
  useEffect(() => {
    if (!chatTerm) return;
    const t = setTimeout(() => void runChatSearch(chatTerm), 300);
    return () => clearTimeout(t);
  }, [chatTerm, runChatSearch]);
  const chatRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(chatRefreshTimerRef.current), []);
  function scheduleChatRefresh() {
    if (!chatTermRef.current || chatRefreshTimerRef.current) return;
    chatRefreshTimerRef.current = setTimeout(() => {
      chatRefreshTimerRef.current = undefined;
      const term = chatTermRef.current;
      if (term) void runChatSearch(term);
    }, 1_500);
  }

  useInboxStream((event) => {
    if (event.type === "reload" || event.type === "inbox.bulk" || event.type === "message.upserted" || event.type === "message.deleted") {
      scheduleChatRefresh();
    }
    if (event.type === "inbox.bulk") {
      if (event.contactos > 0) scheduleHistoryRefresh();
      return;
    }
    if (event.type === "contact.updated") {
      // La cotización y el Detalle no se ven en la tarjeta (decisión del dueño):
      // esos los pone al día el Detalle abierto.
      if (event.changes.includes("etapa") || event.changes.includes("temperatura")) scheduleLive(event.contactId);
      return;
    }
    if (event.type === "reload") scheduleLive(null);
    if (event.type === "reload" || event.type === "conversation.updated" || event.type === "message.upserted" || event.type === "message.deleted") {
      const queue = signalQueueRef.current;
      if (event.type === "reload") queue.full = true;
      else queue.ids.add(event.conversationId);
      if (queue.running) return;
      // En espera de un reintento: un evento nuevo lo adelanta (no espera hasta 60 s).
      if (queue.retryPending) {
        clearTimeout(signalTimerRef.current);
        signalTimerRef.current = undefined;
        queue.retryPending = false;
      }
      if (!signalTimerRef.current) {
        signalTimerRef.current = setTimeout(() => void flushSignals(), 500);
      }
      return;
    }
    if (event.type === "contacts.bulk") bulkRef.current = true;
    else if (event.type === "contact.created") pendingNewRef.current.add(event.contactId);
    else return;
    // Ventana fija (no se reinicia con cada aviso): con tráfico sostenido el
    // kanban igual se actualiza cada 500 ms.
    if (newTimerRef.current) return;
    newTimerRef.current = setTimeout(() => void flushNew(), 500);
  }, { reloadIfOpen: true });

  // Sin acentos ni mayúsculas (regla de todo buscador: lib/text/search.ts).
  const normalizedSearch = normalizeSearch(search);

  const cardFilter = useMemo(
    () => ({ temperature: temperatureFilter, destacado: destacadoOnly }),
    [temperatureFilter, destacadoOnly],
  );
  const filtering = hasCardFilter(cardFilter);
  // Con la lupa el buscador ya no busca por nombre: busca en los chats (con menos de 3
  // letras aún no filtra). Mientras llega un resultado nuevo se ve el anterior.
  const nameSearch = searchChats ? "" : normalizedSearch;
  const chatCounts = chatTerm ? (chatHits?.counts ?? null) : null;
  const chatSearching = chatTerm !== null && chatHits?.term !== chatTerm;

  const filteredContacts = useMemo(() => {
    if (!nameSearch && !filtering && !chatTerm) {
      return contacts;
    }

    return contacts.filter((contact) => {
      if (filtering && !matchesCardFilter(contact, cardFilter)) return false;
      if (chatTerm) return (chatCounts?.get(contact.id) ?? 0) > 0;
      if (!nameSearch) return true;
      const nameMatches = normalizeSearch(getContactFullName(contact)).includes(nameSearch);
      const phoneMatches = phoneMatchesSearch(contact.phoneE164, nameSearch);
      return nameMatches || phoneMatches;
    });
  }, [contacts, nameSearch, filtering, cardFilter, chatTerm, chatCounts]);
  const emptyText =
    chatTerm && !chatCounts
      ? "Buscando…"
      : chatTerm
        ? "Ninguno con esta búsqueda"
        : filtering
          ? "Ninguno con este filtro"
          : "Sin contactos";

  // Cada columna, de más reciente a más viejo: el que escribió al último (o entró a la
  // etapa al último) va arriba, también en vivo con la hora que trae la señal del SSE.
  const columns = useMemo(
    () => columnsByStage(filteredContacts, stages.map((stage) => stage.key), (id) => signals[id]?.lastInboundAt),
    [filteredContacts, stages, signals],
  );
  // «No leído»: lo que muestra cada columna y si le queda algo pendiente (el sobre tenue
  // avisa que no). En vivo: una tarjeta que se vuelve pendiente aparece sola.
  const unreadColumns = useMemo(() => {
    const pending = (contact: BoardContact) => needsAttention(signals[contact.id]);
    const out = new Map<string, { contacts: BoardContact[]; hasUnread: boolean }>();
    for (const [key, list] of columns) {
      const shown = unreadStages.has(key) ? list.filter((c) => c.id === keptContactId || pending(c)) : list;
      out.set(key, { contacts: shown, hasUnread: shown.some(pending) });
    }
    return out;
  }, [columns, signals, unreadStages, keptContactId]);
  const unreadEmptyText = chatTerm && !chatCounts ? "Buscando…" : "Nada sin leer ni sin contestar";
  function toggleUnreadStage(stageKey: string) {
    setUnreadStages((current) => {
      const next = new Set(current);
      if (!next.delete(stageKey)) next.add(stageKey);
      return next;
    });
  }
  // Un contacto en una etapa que esta pantalla aún no conoce (la crearon en otra sesión
  // y el aviso se perdió): se releen las etapas en vez de esconder la tarjeta.
  const unknownStage = useMemo(() => contacts.some((c) => !stageKeys.has(c.stage)), [contacts, stageKeys]);
  useEffect(() => {
    if (unknownStage) void refreshStages();
  }, [unknownStage, refreshStages]);

  // "＋ Nuevo contacto" (28-sep-2026): el alta se pone arriba de su columna y se abre
  // su pop-up para escribirle primero. Mismo camino que un contacto que llega en vivo
  // (liveAdded), para que una recarga del servidor no lo quite antes de tiempo.
  const [creatingContact, setCreatingContact] = useState(false);
  const addAndOpen = useCallback((contact: BoardContact) => {
    setContacts((current) => (current.some((c) => c.id === contact.id) ? current : [contact, ...current]));
    setLiveAdded((current) => (current.some((c) => c.id === contact.id) ? current : [contact, ...current]));
    setSelectedContactId(contact.id);
  }, []);
  // Abrir otro contacto por id (el que ya tiene ese teléfono): si no está en el tablero, se trae.
  const openContactById = useCallback(
    async (contactId: string) => {
      if (contacts.some((c) => c.id === contactId)) {
        setSelectedContactId(contactId);
        return;
      }
      try {
        const [found] = await getContactsByIds([contactId]);
        if (found) addAndOpen(found);
      } catch {
        setError("No se pudo abrir ese contacto; búscalo por su teléfono.");
      }
    },
    [contacts, addAndOpen],
  );

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
      // La hora local ordena contra los cambios en vivo (board-live.ts) hasta que
      // llegue la del servidor.
      return [{ ...found, stage: nextStage, stageChangedAt: new Date() }, ...rest];
    });

    beginWrite(contactId);
    startTransition(async () => {
      let failed = false;
      try {
        await updateContactStage({ contactId, stage: nextStage });
      } catch {
        failed = true;
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId ? { ...contact, stage: previousStage } : contact,
          ),
        );
        setError("No se pudo actualizar la etapa. Intenta de nuevo.");
      } finally {
        endWrite(contactId, failed);
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

    beginWrite(contactId);
    startTransition(async () => {
      let failed = false;
      try {
        await updateContactTemperature({ contactId, temperature: nextTemperature });
      } catch {
        failed = true;
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId ? { ...contact, temperature: previousTemperature } : contact,
          ),
        );
        setError("No se pudo actualizar la temperatura. Intenta de nuevo.");
      } finally {
        endWrite(contactId, failed);
      }
    });
  }
  // ⭐ Destacado desde el pop-up (misma marca que la estrella de la Bandeja). Optimista y
  // sin reordenar, como la temperatura; revierte solo esta tarjeta si falla.
  function handleDestacadoChange(contactId: string, next: boolean) {
    const target = contacts.find((contact) => contact.id === contactId);
    if (!target || target.destacado === next) {
      return;
    }
    setError(null);
    setContacts((current) => current.map((contact) => (contact.id === contactId ? { ...contact, destacado: next } : contact)));

    beginWrite(contactId);
    startTransition(async () => {
      let failed = false;
      try {
        await setContactDestacado({ contactId, destacado: next });
      } catch {
        failed = true;
        setContacts((current) => current.map((contact) => (contact.id === contactId ? { ...contact, destacado: !next } : contact)));
        setError("No se pudo actualizar Destacado. Intenta de nuevo.");
      } finally {
        endWrite(contactId, failed);
      }
    });
  }


  // Clic derecho → "Marcar como no leído / leído", y el botón «Marcar como leído» del
  // pop-up. Optimista: leído apaga el círculo y el azul (no el amarillo); no leído pone
  // el círculo y el azul lo decide el servidor (regresa si el último es del cliente).
  // El SSE (conversation.updated) trae después la señal del servidor. Si falla, vuelve
  // al valor anterior (solo si nadie lo cambió mientras).
  function handleSetUnread(contactId: string, unread: boolean) {
    const previous: FunnelSignal | undefined = signals[contactId];
    const next: FunnelSignal = {
      unread: unread ? Math.max(1, previous?.unread ?? 0) : 0,
      pending: unread ? (previous?.pending ?? false) : false,
      urgent: previous?.urgent ?? false,
      lastInboundAt: previous?.lastInboundAt ?? null,
    };
    setError(null);
    setSignals((current) => ({ ...current, [contactId]: next }));
    const revert = (message: string) => {
      setSignals((current) => {
        if (current[contactId] !== next) return current;
        const rest = { ...current };
        if (previous) rest[contactId] = previous;
        else delete rest[contactId];
        return rest;
      });
      setError(message);
    };
    setContactUnread(contactId, unread).then(
      (found) => {
        if (!found) revert("Este contacto todavía no tiene chat.");
      },
      () => revert("No se pudo cambiar a leído/no leído. Intenta de nuevo."),
    );
  }

  function handleCardClick(contactId: string) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setSelectedContactId(contactId);
    setKeptContactId(contactId);
  }

  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    draggingIdRef.current = String(event.active.id);
    setActiveContactId(String(event.active.id));
  }

  // Cambio en vivo que llegó mientras se arrastraba esta tarjeta (o nada).
  function takeHeld(contactId: string): BoardContact | undefined {
    draggingIdRef.current = null;
    const held = heldRef.current.get(contactId);
    heldRef.current.delete(contactId);
    if (held) recentLiveRef.current.set(contactId, Date.now());
    if (dragMissedRef.current.delete(contactId)) scheduleLive(contactId);
    return held;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const contactId = String(active.id);
    const held = takeHeld(contactId);
    setActiveContactId(null);
    // Limpia la marca tras el click sintético que dispara el pointerup.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    const overId = over ? String(over.id) : null;
    const local = contacts.find((contact) => contact.id === contactId);
    if (overId && stageKeys.has(overId) && local && local.stage !== overId) {
      // La soltó en otra columna: manda la etapa que puso el vendedor; lo demás
      // del cambio en espera (temperatura…) sí se aplica.
      if (held) {
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId
              ? { ...held, stage: contact.stage, stageChangedAt: contact.stageChangedAt, stageChangedBy: contact.stageChangedBy }
              : contact,
          ),
        );
      }
      handleStageChange(contactId, overId);
      return;
    }
    // Sin columna nueva (la regresó o la soltó fuera): entra el cambio en espera.
    if (held) setContacts((current) => mergeLiveContacts(current, [held]));
  }

  function handleDragCancel() {
    const contactId = draggingIdRef.current;
    const held = contactId ? takeHeld(contactId) : undefined;
    setActiveContactId(null);
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    if (held) setContacts((current) => mergeLiveContacts(current, [held]));
  }

  return (
    // Altura DEFINIDA (viewport − header de 4rem). Sin esto, la cadena flex del
    // layout es todo min-h-* y la columna scrolleable crece al alto del
    // contenido (clientHeight === scrollHeight): @tanstack/react-virtual mide
    // el scroll element y, al verlo "infinitamente alto", monta las ~11k
    // tarjetas en vez de virtualizar. Es una altura DURA (sin flex-1): en un
    // flex-col, flex-1 fija flex-basis:0 y anularía esta height, dejando que el
    // board vuelva a crecer con su contenido. min-h-0 permite que el
    // contenedor de columnas (flex-1) encoja por debajo de su contenido y su
    // hijo overflow-y-auto acote de verdad el viewport del virtualizador.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Embudo</h1>
          {/* Lápiz: abre el editor de columnas (el mismo de Agente IA → Etapas del embudo). */}
          <button
            type="button"
            onClick={() => setEditingStages(true)}
            aria-label="Editar las columnas del Embudo"
            title="Editar columnas"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-4" />
          </button>
          {/* Lupa amarilla: avisos cortos, junto al título (no mueven el tablero). */}
          {searchChats && search.trim() !== "" && !chatTerm && (
            <span className="text-xs text-muted-foreground">Escribe al menos 3 letras</span>
          )}
          {chatSearching && <span className="text-xs text-muted-foreground">Buscando en los chats…</span>}
        </div>
        {/* Móvil: la barra va en su propio renglón (w-full) y el buscador toma el ancho que
            queda. Con la lupa son cuatro piezas: el buscador nace en ancho 0 (w-0) y se
            estira, así nunca empuja la barra fuera de la pantalla. */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
          <button
            type="button"
            onClick={() => setCreatingContact(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light"
          >
            <Plus className="size-4" aria-hidden="true" /> Nuevo contacto
          </button>
          <input
            type="search"
            placeholder={searchChats ? CHAT_SEARCH_PLACEHOLDER : "Buscar por nombre o teléfono..."}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`w-0 min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none sm:w-72 sm:flex-none ${searchChats ? CHAT_SEARCH_INPUT_ACTIVE : ""}`}
          />
          {/* La lupa va entre el buscador y el filtro (decisión del dueño, 29-sep-2026). */}
          <ChatSearchButton active={searchChats} onChange={setSearchChats} />
          <CardFilterButton
            temperature={temperatureFilter}
            onTemperatureChange={setTemperatureFilter}
            destacado={destacadoOnly}
            onDestacadoChange={setDestacadoOnly}
          />
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
        {/* -m-3 p-3: margen interno para el resaltado de la columna bajo la tarjeta que se
            arrastra (crece 1 % + marco naranja de 4 px por fuera). Un contenedor con scroll
            horizontal recorta TODO lo que sale de su caja (también arriba): sin este margen se
            comía el borde de arriba del marco. El -m-3 deja las columnas en el mismo lugar. */}
        <div
          ref={boardScrollRef}
          // El snap de móvil se apaga mientras se arrastra una tarjeta: el auto-scroll de
          // dnd-kit y el snap se pelearían por la posición.
          className={`-m-3 flex min-h-0 flex-1 gap-4 overflow-x-auto p-3 ${activeContact ? "" : "max-sm:snap-x max-sm:snap-mandatory"}`}
        >
          {stages.map((stage) => {
            const column = unreadColumns.get(stage.key);
            const onlyUnread = unreadStages.has(stage.key);
            return (
              <StageColumn
                key={stage.key}
                stage={stage}
                contacts={column?.contacts ?? []}
                signals={signals}
                chatHits={chatCounts}
                emptyText={onlyUnread ? unreadEmptyText : emptyText}
                onlyUnread={onlyUnread}
                hasUnread={column?.hasUnread ?? false}
                onToggleUnread={() => toggleUnreadStage(stage.key)}
                onCardClick={handleCardClick}
                onSetUnread={handleSetUnread}
              />
            );
          })}
        </div>

        <DragOverlay
          dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }}
          modifiers={[restrictOverlayToBoard]}
        >
          {activeContact ? (
            <div
              data-funnel={funnelTone(signals[activeContact.id])}
              className="card-pickup w-[calc(100vw-2.5rem)] cursor-grabbing rounded-md bg-card shadow-2xl sm:w-72 [&>div]:bg-transparent"
            >
              <ContactCardContent
                contact={activeContact}
                signal={signals[activeContact.id]}
                chatHits={chatCounts?.get(activeContact.id)}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {editingStages && (
        <div role="dialog" aria-modal="true" aria-labelledby="editar-columnas-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditingStages(false)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="editar-columnas-titulo" className="text-sm font-semibold">Columnas del Embudo</h2>
              <button type="button" onClick={() => setEditingStages(false)} aria-label="Cerrar" className="hidden rounded p-1 text-muted-foreground hover:bg-muted md:block">
                <X className="size-4" />
              </button>
              <CloseX size="sm" onClick={() => setEditingStages(false)} />
            </div>
            <StagesEditor />
          </div>
        </div>
      )}

      {selectedContact && (
        <ContactDetailPanel
          contact={selectedContact}
          signal={signals[selectedContact.id]}
          onMarkRead={() => handleSetUnread(selectedContact.id, false)}
          isSaving={isPending}
          onClose={() => {
            setSelectedContactId(null);
            setKeptContactId(null);
          }}
          onStageChange={(nextStage) => handleStageChange(selectedContact.id, nextStage)}
          onTemperatureChange={(nextTemperature) =>
            handleTemperatureChange(selectedContact.id, nextTemperature)
          }
          onDestacadoChange={(next) => handleDestacadoChange(selectedContact.id, next)}
          onOpenContact={(contactId) => void openContactById(contactId)}
          searchTerm={chatTerm}
        />
      )}

      <NewContactDialog
        open={creatingContact}
        stages={stages}
        onClose={() => setCreatingContact(false)}
        onCreated={(contact) => {
          setCreatingContact(false);
          addAndOpen(contact);
        }}
        onOpenExisting={(contactId) => {
          setCreatingContact(false);
          void openContactById(contactId);
        }}
      />
    </div>
  );
}
