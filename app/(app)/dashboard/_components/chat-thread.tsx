"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Search } from "lucide-react";
import type { AdReferral, AttachmentView, ConversationDetail, MessageView } from "@/lib/inbox/types";
import { useFunnelStages } from "../../_components/funnel-stages-provider";
import { listChatMatches, listMessages, retryMessage, sendMessage, sendTemplate } from "@/lib/inbox/actions";
import { runWorkflowCommand } from "@/lib/actions/workflows";
import { parseCommand } from "@/lib/workflows/steps";
import { sendAttachments } from "@/lib/inbox/attachment-actions";
import { attachmentAcceptAttr } from "@/lib/chat-attachments/rules";
import { Composer } from "./composer";
import { ChatDropZone } from "./chat-drop-zone";
import { useChatAttachments } from "./use-chat-attachments";
import { ArchivedComposer } from "./archived-composer";
import { PruebaBadge } from "@/components/ui/prueba-badge";
import { DocumentCard } from "./document-card";
import { MediaViewer } from "./media-viewer";
import { VideoAttachment } from "./video-attachment";
import { ScheduledInThread } from "./scheduled-in-thread";
import { AgentNoticeLine, AgentPausedBanner, useConversationAgent } from "./agent-in-thread";
import { AgentErrorCard } from "./agent-error-card";
import { AgentActivityPill } from "./agent-activity-pill";
import { interleaveNotices } from "@/lib/agente-ia/timeline";
import { AdFreeWindowNote, AdReferralCard } from "./ad-referral-card";
import {
  bubbleTime,
  dayLabel,
  isWindowOpen,
  statusMark,
  windowHoursLeft,
} from "./format";
import { formatPhone } from "@/lib/phone-format";
import { PhoneLocation } from "@/components/ui/phone-location";
import { LinkedText } from "@/components/ui/linked-text";

const PAGE_LIMIT = 30;
// Distancia al tope (px) a la que se cargan solos los mensajes anteriores, y al
// fondo para considerar que el vendedor "está abajo" (los nuevos lo siguen).
const LOAD_OLDER_AT_PX = 120;
const NEAR_BOTTOM_PX = 120;
// Para llegar a una coincidencia vieja de la búsqueda se cargan páginas grandes (el tope
// del servidor) y a lo más estas vueltas.
const JUMP_PAGE_LIMIT = 100;
const JUMP_MAX_PAGES = 50;

// Mensaje pintado de forma optimista (aún sin id del servidor). Se reconcilia
// con el `message.upserted` del SSE: al re-pedir el hilo, se descarta el
// optimista cuyo texto ya aparece como mensaje saliente real.
type OptimisticMessage = {
  clientId: string;
  optimistic: true;
  direction: "out";
  kind: "text" | "template";
  body: string;
  status: "queued" | "failed";
  errorMessage: string | null;
  sentAt: Date;
};

type Row = (MessageView & { optimistic?: false }) | OptimisticMessage;

function isOptimistic(row: Row): row is OptimisticMessage {
  return "optimistic" in row && row.optimistic === true;
}

function Attachment({ attachment, onOpen }: { attachment: AttachmentView; onOpen: () => void }) {
  // Agotó sus intentos de descarga (o llegó vacío; Bloque B): nunca un archivo en blanco.
  if (attachment.state === "failed") {
    return (
      <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">
        {attachment.kind === "document" && attachment.fileName ? `📄 ${attachment.fileName} · ` : ""}No se pudo descargar
      </div>
    );
  }
  // Mientras se copia al bucket el mensaje ya se ve: "Procesando…" y el SSE lo
  // rellena al terminar (message.upserted).
  if (attachment.state === "processing") {
    return attachment.kind === "document" ? (
      <div className="w-64 max-w-full rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        📄 {attachment.fileName ?? "Documento"} · Procesando…
      </div>
    ) : (
      <div className="rounded-md bg-black/5 px-3 py-2 text-xs text-muted-foreground">Procesando…</div>
    );
  }
  switch (attachment.kind) {
    case "image":
    case "sticker":
      return (
        <button type="button" onClick={onOpen} className="block cursor-zoom-in" aria-label="Ver imagen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.fileName ?? "Imagen"} className="max-h-64 rounded-md object-cover" />
        </button>
      );
    case "audio":
      return <audio controls src={attachment.url} className="w-56" />;
    case "video":
      return <VideoAttachment src={attachment.url} />;
    default:
      return <DocumentCard attachment={attachment} onOpen={onOpen} />;
  }
}

// "Transcripción" debajo de una nota de voz del cliente (Agente IA parte 1): el
// texto que lee el agente; "Transcribiendo…" mientras tanto (el SSE lo rellena).
function TranscriptionNote({
  transcription,
  out,
  searchTerm,
}: {
  transcription: NonNullable<MessageView["transcription"]>;
  out: boolean;
  searchTerm: string | null;
}) {
  const muted = out ? "text-brand-white/70" : "text-muted-foreground";
  if (transcription.state === "pendiente") return <p className={`mb-1 text-[11px] italic ${muted}`}>Transcribiendo…</p>;
  if (transcription.state === "sin") return <p className={`mb-1 text-[11px] italic ${muted}`}>Sin transcripción: {transcription.reason}.</p>;
  return (
    <div className={`mb-1 rounded-md border-l-4 px-2 py-1 text-xs ${out ? "border-brand-white/60 bg-brand-white/10" : "border-brand-navy/60 bg-muted"}`}>
      <span className="font-medium">Transcripción</span>
      <p className="whitespace-pre-wrap break-words opacity-90">
        <LinkedText text={transcription.text} searchTerm={searchTerm} />
      </p>
    </div>
  );
}

function Bubble({
  row,
  searchTerm,
  currentMatch,
  onRetry,
  onOpenAttachment,
}: {
  row: Row;
  /** Búsqueda en los chats (lupa amarilla): la palabra se resalta en amarillo. */
  searchTerm: string | null;
  /** Es la coincidencia que se está viendo («1 de N»): borde amarillo. */
  currentMatch: boolean;
  onRetry: (row: Row) => void;
  onOpenAttachment: (attachment: AttachmentView) => void;
}) {
  const out = row.direction === "out";
  const opt = isOptimistic(row);
  // Aviso interno (Fase D): nota para el vendedor, centrada y en ámbar. No es
  // una burbuja de WhatsApp (nunca salió al cliente).
  if (!opt && row.kind === "system_note") {
    return (
      <div className="my-2 flex justify-center">
        <div
          role="note"
          className="max-w-[85%] rounded-lg border border-brand-orange/50 bg-brand-orange/10 px-3 py-2 text-xs text-foreground shadow-sm"
        >
          <span className="font-semibold text-brand-orange">📝 Aviso interno · </span>
          <span className="whitespace-pre-wrap break-words">{row.body && <LinkedText text={row.body} />}</span>
          <span className="ml-2 text-[10px] text-muted-foreground">{bubbleTime(row.sentAt)}</span>
        </div>
      </div>
    );
  }
  const mark = out ? statusMark(row.status) : null;
  // Una plantilla optimista fallida NO se reintenta como texto (fuera de la
  // ventana de 24 h el texto se rechaza): el vendedor vuelve a elegir plantilla.
  const canRetry = opt
    ? row.status === "failed" && row.kind !== "template"
    : row.status === "failed" && (row as MessageView).canRetry;
  const errorMessage = opt ? row.errorMessage : (row as MessageView).errorMessage;
  const attachments = opt ? [] : (row as MessageView).attachments;
  const adReferral: AdReferral | null = opt ? null : (row as MessageView).adReferral;
  const view = opt ? null : (row as MessageView);
  const reactions = view ? [view.reactions.contact, view.reactions.business].filter(Boolean) : [];
  // Primer mensaje que WhatsApp no pasó al CRM (Meta 131060, caso SDA): tarjeta de
  // aviso en lugar de "[Unsupported message]"; mientras se verifica, "Recibiendo mensaje…".
  const notice = view?.noDisponible ?? null;

  // Los avisos internos no entran en la búsqueda (decisión del dueño): arriba ya salieron.
  const term = opt ? null : searchTerm;

  return (
    <div
      data-message-id={opt ? undefined : row.id}
      className={`flex ${out ? "justify-end" : "justify-start"} ${reactions.length ? "mb-3" : ""}`}
    >
      <div
        className={`relative max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${currentMatch ? "outline-2 outline-offset-2 outline-busqueda " : ""}${
          out
            ? "bg-brand-navy text-brand-white"
            : notice === "sin_contenido"
              ? "border border-dashed border-brand-orange/60 bg-brand-orange/5 text-foreground"
              : notice === "verificando"
                ? "border border-dashed bg-card text-muted-foreground"
                : "bg-card text-foreground border"
        }`}
        {...(notice ? { role: "note" } : {})}
      >
        {view?.quoted && (
          <div
            className={`mb-1 rounded-md border-l-4 px-2 py-1 text-xs ${
              out ? "border-brand-white/60 bg-brand-white/10" : "border-brand-navy/60 bg-muted"
            }`}
          >
            <span className="font-medium">{view.quoted.direction === "out" ? "Tú" : "Cliente"}</span>
            <p className="line-clamp-2 opacity-80">{view.quoted.preview}</p>
          </div>
        )}
        {view?.deletedAt && (
          <p className={`mb-1 text-[11px] italic ${out ? "text-brand-white/70" : "text-muted-foreground"}`}>
            🚫 Eliminado en WhatsApp por su autor (se conserva en el CRM)
          </p>
        )}
        {adReferral && <AdReferralCard referral={adReferral} />}
        {view?.location && (
          <a
            href={`https://www.google.com/maps?q=${view.location.latitude},${view.location.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            // data-link="text" pinta navy: solo en burbujas entrantes (fondo claro).
            // En las salientes (fondo navy) el enlace conserva el texto blanco.
            data-link={out ? undefined : "text"}
            className={`mb-1 block rounded-md border px-2 py-1 text-xs ${out ? "border-brand-white/40 underline-offset-2 hover:underline" : ""}`}
          >
            📍 {view.location.name ?? "Ubicación"}
            {view.location.address && <span className="block opacity-80">{view.location.address}</span>}
          </a>
        )}
        {view && view.contactCards.length > 0 && (
          <div className="mb-1 flex flex-col gap-0.5 text-xs">
            {view.contactCards.map((name, i) => (
              <span key={i}>👤 {name}</span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-1 flex flex-col gap-1">
            {attachments.map((att) => (
              <Attachment key={att.index} attachment={att} onOpen={() => onOpenAttachment(att)} />
            ))}
          </div>
        )}
        {view?.transcription && <TranscriptionNote transcription={view.transcription} out={out} searchTerm={term} />}
        {notice === "sin_contenido" && row.body && (
          <p className="whitespace-pre-wrap break-words">
            <span aria-hidden="true">⚠️ </span>
            {row.body}
          </p>
        )}
        {notice === "verificando" && row.body && <p className="italic">{row.body}</p>}
        {!notice && row.body && (
          <p className="whitespace-pre-wrap break-words">
            <LinkedText text={row.body} searchTerm={term} />
          </p>
        )}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-white/70" : "text-muted-foreground"}`}>
          {view?.importedFromPhone && <span title="Copiado del historial del celular al conectar el número">Importado del celular ·</span>}
          {view?.editedAt && <span>editado</span>}
          <span>{bubbleTime(row.sentAt)}</span>
          {mark && mark.glyph && (
            <span className={mark.className} title={mark.label} aria-label={mark.label}>
              {mark.glyph}
            </span>
          )}
        </div>
        {reactions.length > 0 && (
          <span
            className={`absolute -bottom-3 ${out ? "right-2" : "left-2"} rounded-full border bg-card px-1.5 text-xs text-foreground shadow-sm`}
            aria-label={`Reacciones: ${reactions.join(" ")}`}
          >
            {reactions.join(" ")}
          </span>
        )}
        {out && row.status === "failed" && (
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-red-200">
            <span className="text-red-300">{errorMessage ?? "No se envió."}</span>
            {canRetry && (
              <button
                type="button"
                onClick={() => onRetry(row)}
                className="rounded bg-brand-white/15 px-2 py-0.5 font-medium hover:bg-brand-white/25"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThread({
  detail,
  revalToken,
  nowMs,
  headerAction,
  onBack,
  searchTerm = null,
}: {
  detail: ConversationDetail;
  revalToken: number;
  nowMs: number;
  /**
   * Lupa amarilla (Bandeja y pop-up del Embudo): palabra buscada, ya normalizada
   * (chatSearchTerm). Se resalta, el chat salta a la coincidencia más reciente y la barra
   * «1 de N» recorre las demás. null = sin búsqueda.
   */
  searchTerm?: string | null;
  /** A la derecha del nombre en el encabezado (el pop-up del Embudo pone «Marcar como leído»). */
  headerAction?: ReactNode;
  /** Móvil: flecha ← a la izquierda del nombre para volver a la lista (la Bandeja la pasa). */
  onBack?: () => void;
}) {
  const conversationId = detail.id;
  // Nombre de la etapa (columnas editables del Embudo; llega la clave).
  const { labelOf } = useFunnelStages();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AttachmentView | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // A qué conversación pertenecen los mensajes cargados (el chat se reutiliza al
  // cambiar de conversación en la Bandeja) y cuál está abierta ahora.
  const loadedRef = useRef<{ conversationId: string | null; messages: MessageView[]; hasMore: boolean }>({
    conversationId: null,
    messages: [],
    hasMore: false,
  });
  const openConversationRef = useRef(conversationId);
  useEffect(() => {
    openConversationRef.current = conversationId;
  }, [conversationId]);
  // Sube al programar un mensaje: la franja de programados (A6) se recarga.
  const [scheduledRev, setScheduledRev] = useState(0);
  const [scheduledCount, setScheduledCount] = useState(0);
  // Agente IA (Fase B): pausa + avisos; se recarga con el SSE de la conversación.
  const { agent, reload: reloadAgent } = useConversationAgent(conversationId, revalToken, detail);

  const windowOpen = isWindowOpen(detail.windowExpiresAt, nowMs);
  const hoursLeft = windowHoursLeft(detail.windowExpiresAt, nowMs);
  // Adjuntos (28-sep-2026): solo con la ventana abierta y el canal sin archivar.
  const canAttach = windowOpen && !detail.channel.archived;
  const attachments = useChatAttachments(conversationId);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Descarta optimistas (texto o plantilla) cuyo cuerpo ya llegó como saliente
  // real, sin importar si estaban "queued" o "failed": así no queda un duplicado
  // (la burbuja optimista fallida junto a la fila real) cuando el envío se
  // rechazó y su fila real ya cargó por SSE.
  const reconcile = useCallback((server: MessageView[]) => {
    setOptimistic((current) => {
      if (current.length === 0) return current;
      const outBodies = new Set(server.filter((m) => m.direction === "out").map((m) => m.body ?? ""));
      return current.filter((o) => !outBodies.has(o.body));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await listMessages(conversationId, { limit: PAGE_LIMIT });
      if (!page) {
        setLoadError("No se pudo cargar la conversación.");
        return;
      }
      // Respuesta tardía de una conversación que ya no está abierta: se ignora.
      if (openConversationRef.current !== conversationId) return;
      // Recarga (SSE): trae la página más reciente y CONSERVA los anteriores que el
      // vendedor ya cargó hacia arriba EN ESTA conversación, para no perder su lugar.
      // Solo si EMPALMAN: el mensaje más antiguo de la página nueva ya estaba cargado.
      // Si no (llegaron más de una página de mensajes), se descartan los anteriores
      // y se vuelve a paginar desde la página nueva: nunca queda un hueco escondido.
      const loaded = loadedRef.current;
      const joinAt =
        loaded.conversationId === conversationId && page.messages[0]
          ? loaded.messages.findIndex((m) => m.id === page.messages[0].id)
          : -1;
      const older = joinAt > 0 ? loaded.messages.slice(0, joinAt) : [];
      const next = older.length ? [...older, ...page.messages] : page.messages;
      const nextHasMore = older.length ? loaded.hasMore : page.hasMore;
      loadedRef.current = { conversationId, messages: next, hasMore: nextHasMore };
      setMessages(next);
      setHasMore(nextHasMore);
      reconcile(page.messages);
    } catch {
      setLoadError("No se pudo cargar la conversación.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, reconcile]);

  // Carga inicial y recarga ante cada evento SSE de esta conversación.
  useEffect(() => {
    // Diferido: evita setState síncrono dentro del efecto (react-hooks).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, revalToken]);

  // Búsqueda en los chats: ids de los mensajes con la palabra (del más reciente al más
  // viejo) y cuál se ve (0 = el más reciente). `key` = conversación + palabra: una búsqueda
  // de otro chat u otra palabra no se muestra mientras llega la nueva.
  const [search, setSearch] = useState<{ key: string; ids: string[]; index: number } | null>(null);
  const searchKey = searchTerm ? `${conversationId}|${searchTerm}` : null;
  const activeSearch = search && search.key === searchKey ? search : null;
  const currentMatchId = activeSearch?.ids[activeSearch.index] ?? null;

  // Scroll del historial: SOLO se desliza el historial (la página y el composer
  // quedan fijos). Al cargar anteriores se conserva el lugar; los mensajes nuevos
  // bajan al fondo solo si el vendedor ya estaba abajo, cambió de conversación o
  // acaba de enviar.
  const loadingOlderRef = useRef(false);
  const prependRef = useRef<{ height: number; top: number } | null>(null);
  const nearBottomRef = useRef(true);
  const forceBottomRef = useRef(true);
  const shownConversationRef = useRef(conversationId);

  async function loadOlder() {
    const oldest = messages[0];
    const el = scrollRef.current;
    if (!oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    try {
      const page = await listMessages(conversationId, { before: oldest.id, limit: PAGE_LIMIT });
      const loaded = loadedRef.current;
      if (!page || openConversationRef.current !== conversationId || loaded.conversationId !== conversationId) return;
      if (page.messages.length > 0 && el) prependRef.current = { height: el.scrollHeight, top: el.scrollTop };
      const known = new Set(loaded.messages.map((m) => m.id));
      const next = [...page.messages.filter((m) => !known.has(m.id)), ...loaded.messages];
      loadedRef.current = { conversationId, messages: next, hasMore: page.hasMore };
      setMessages(next);
      setHasMore(page.hasMore);
    } finally {
      loadingOlderRef.current = false;
    }
  }

  function onHistoryScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop < LOAD_OLDER_AT_PX && hasMore && !loading) void loadOlder();
  }

  // Auto-scroll al fondo cuando cambia la cantidad de mensajes/optimistas.
  const rows: Row[] = useMemo(() => [...messages, ...optimistic], [messages, optimistic]);
  // Avisos del agente intercalados por hora con los mensajes.
  const timeline = useMemo(() => interleaveNotices(rows, agent?.notices ?? [], hasMore), [rows, agent?.notices, hasMore]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
  const noticeCount = agent?.notices.length ?? 0;
  // El último mensaje mostrado: cambia al llegar uno nuevo o al abrir otra
  // conversación aunque tenga la misma cantidad de mensajes cargados.
  const lastRow = rows[rows.length - 1];
  const lastKey = lastRow ? (isOptimistic(lastRow) ? lastRow.clientId : lastRow.id) : null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (shownConversationRef.current !== conversationId) {
      shownConversationRef.current = conversationId;
      forceBottomRef.current = true;
      prependRef.current = null;
    }
    const prepend = prependRef.current;
    if (prepend) {
      // Anteriores agregados arriba: el mismo mensaje sigue a la vista.
      prependRef.current = null;
      el.scrollTop = el.scrollHeight - prepend.height + prepend.top;
      return;
    }
    if (forceBottomRef.current || nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      if (rows.length > 0) forceBottomRef.current = false;
    }
  }, [rows.length, lastKey, scheduledCount, conversationId, noticeCount]);

  // La caja para escribir crece con el texto (28-sep-2026) y encoge el
  // historial: si el vendedor estaba abajo, el último mensaje sigue a la vista.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Salto a una coincidencia de la búsqueda: si el mensaje es viejo se cargan páginas
  // anteriores hasta tenerlo y luego se centra en el historial. Espera a que haya llegado
  // la primera página de ESTA conversación (al abrir el chat llegan juntas).
  const pendingJumpRef = useRef<string | null>(null);
  const jumpingRef = useRef(false);
  const scrollTargetRef = useRef<string | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  const runJump = useCallback(async () => {
    const id = pendingJumpRef.current;
    if (!id || jumpingRef.current || loadingOlderRef.current) return;
    if (loadedRef.current.conversationId !== conversationId) return;
    jumpingRef.current = true;
    loadingOlderRef.current = true;
    try {
      for (let round = 0; round < JUMP_MAX_PAGES; round++) {
        const loaded = loadedRef.current;
        const oldest = loaded.messages[0];
        if (!oldest || !loaded.hasMore || loaded.messages.some((m) => m.id === id)) break;
        const page = await listMessages(conversationId, { before: oldest.id, limit: JUMP_PAGE_LIMIT });
        if (!page || openConversationRef.current !== conversationId || loadedRef.current.conversationId !== conversationId) return;
        const known = new Set(loadedRef.current.messages.map((m) => m.id));
        const next = [...page.messages.filter((m) => !known.has(m.id)), ...loadedRef.current.messages];
        loadedRef.current = { conversationId, messages: next, hasMore: page.hasMore };
        // Lo agregado arriba no debe bajar el historial al fondo: el salto lo acomoda.
        nearBottomRef.current = false;
        setMessages(next);
        setHasMore(page.hasMore);
      }
      // Mientras cargaba pidieron otra coincidencia: esa se atiende al terminar.
      if (pendingJumpRef.current !== id) return;
      pendingJumpRef.current = null;
      scrollTargetRef.current = id;
      setJumpTick((n) => n + 1);
    } catch {
      // Falla de red: la barra «1 de N» sigue ahí para volver a intentarlo.
      if (pendingJumpRef.current === id) pendingJumpRef.current = null;
    } finally {
      jumpingRef.current = false;
      loadingOlderRef.current = false;
      if (pendingJumpRef.current && pendingJumpRef.current !== id) setTimeout(() => void runJumpRef.current(), 0);
    }
  }, [conversationId]);
  const runJumpRef = useRef(runJump);
  useEffect(() => {
    runJumpRef.current = runJump;
  }, [runJump]);
  function requestJump(messageId: string) {
    pendingJumpRef.current = messageId;
    void runJumpRef.current();
  }
  // Un salto pedido antes de que llegara la primera página se hace en cuanto llega.
  useEffect(() => {
    if (!pendingJumpRef.current || loading) return;
    const t = setTimeout(() => void runJumpRef.current(), 0);
    return () => clearTimeout(t);
  }, [messages, loading]);
  // Centra la coincidencia (después del auto-scroll de arriba, en su propio render).
  useLayoutEffect(() => {
    const id = scrollTargetRef.current;
    const el = scrollRef.current;
    if (!id || !el) return;
    const node = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!node) return;
    scrollTargetRef.current = null;
    prependRef.current = null;
    forceBottomRef.current = false;
    const box = el.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    el.scrollTop += target.top - box.top - Math.max(0, (el.clientHeight - target.height) / 2);
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [jumpTick]);

  // Coincidencias de la palabra en este chat: se piden al abrirlo, al cambiar la palabra y
  // con cada evento del chat (revalToken: pudo llegar un mensaje con la palabra). Una
  // búsqueda NUEVA salta a la coincidencia más reciente; una recarga se queda donde está.
  const jumpedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!searchTerm) {
      jumpedKeyRef.current = null;
      pendingJumpRef.current = null;
      return;
    }
    const key = `${conversationId}|${searchTerm}`;
    let cancelled = false;
    const t = setTimeout(() => {
      listChatMatches(conversationId, searchTerm).then(
        (ids) => {
          if (cancelled) return;
          setSearch((prev) => {
            if (prev && prev.key === key) {
              const still = ids.indexOf(prev.ids[prev.index] ?? "");
              return { key, ids, index: still >= 0 ? still : Math.min(prev.index, Math.max(ids.length - 1, 0)) };
            }
            return { key, ids, index: 0 };
          });
          if (jumpedKeyRef.current !== key) {
            jumpedKeyRef.current = key;
            if (ids[0]) requestJump(ids[0]);
          }
        },
        () => undefined,
      );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [conversationId, searchTerm, revalToken]);

  // ↑ = coincidencia anterior (más vieja), ↓ = siguiente (más reciente); dan la vuelta.
  function goToMatch(step: 1 | -1) {
    if (!activeSearch || activeSearch.ids.length === 0) return;
    const count = activeSearch.ids.length;
    const index = (activeSearch.index + step + count) % count;
    setSearch({ ...activeSearch, index });
    requestJump(activeSearch.ids[index]);
  }

  // "/tabla" y similares (Fase D): si el texto es un comando de workflow, se
  // dispara la automatización; si no corresponde a ninguno, sale como texto.
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  async function doSendOrCommand(text: string) {
    if (!parseCommand(text)) return doSend(text);
    const result = await runWorkflowCommand({ conversationId, text });
    if (!result.ok) {
      if ("notCommand" in result) return doSend(text);
      setCommandNotice(`⚠ ${result.error}`);
      return;
    }
    setCommandNotice(
      result.status === "queued"
        ? `▶ ${result.name}: en marcha (los mensajes aparecen en el hilo).`
        : `⚠ ${result.name}: no se ejecutó (${result.reason ?? "omitido"}).`,
    );
  }

  async function doSend(text: string) {
    forceBottomRef.current = true;
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimistic((current) => [
      ...current,
      { clientId, optimistic: true, direction: "out", kind: "text", body: text, status: "queued", errorMessage: null, sentAt: new Date() },
    ]);
    const result = await sendMessage(conversationId, text);
    if (!result.ok) {
      setOptimistic((current) =>
        current.map((o) => (o.clientId === clientId ? { ...o, status: "failed", errorMessage: result.message } : o)),
      );
    }
    // ok:true (pending o no) → el message.upserted del SSE recargará y
    // reconciliará; el optimista "queued" se descarta al aparecer el real.
  }

  // Envío optimista de una plantilla (misma mecánica que el texto: la burbuja
  // guarda el cuerpo ya rellenado, que coincide con el mensaje real al llegar
  // por SSE y reconcilia). Solo se usa con la ventana de 24 h cerrada.
  async function doSendTemplate(templateId: string, values: string[], preview: string) {
    forceBottomRef.current = true;
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimistic((current) => [
      ...current,
      { clientId, optimistic: true, direction: "out", kind: "template", body: preview, status: "queued", errorMessage: null, sentAt: new Date() },
    ]);
    const result = await sendTemplate(conversationId, templateId, values);
    if (!result.ok) {
      setOptimistic((current) =>
        current.map((o) => (o.clientId === clientId ? { ...o, status: "failed", errorMessage: result.message } : o)),
      );
    }
  }

  // Los archivos ya subieron; la acción deja las burbujas en cola y el worker las manda en orden.
  async function doSendAttachments(tokens: string[], caption: string): Promise<{ ok: true } | { ok: false; message: string }> {
    forceBottomRef.current = true;
    const result = await sendAttachments(conversationId, tokens, caption);
    if (!result.ok) return result;
    void load();
    return { ok: true };
  }

  async function handleRetry(row: Row) {
    if (isOptimistic(row)) {
      // Optimista fallido: reintentar = volver a enviar el mismo texto.
      setOptimistic((current) => current.filter((o) => o.clientId !== row.clientId));
      await doSend(row.body);
      return;
    }
    // Mensaje real fallido con canRetry: usar retryMessage(id).
    const result = await retryMessage(row.id);
    if (!result.ok) {
      setMessages((current) =>
        current.map((m) => (m.id === row.id ? { ...m, errorMessage: result.message } : m)),
      );
    }
    // Éxito → SSE recarga.
  }

  return (
    // Alto fijo (lo da el contenedor: Bandeja o pop-up del Embudo): encabezado y
    // composer siempre visibles; solo el historial se desliza. container-type:size:
    // los selectores del composer miden su tope contra el alto del chat (cqh) y un
    // texto largo no puede ensanchar la columna (sacaba de vista "Cerrar").
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/40 [container-type:size]">
      {/* Encabezado */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-3 md:gap-3 md:px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver a la lista"
            title="Volver a la lista"
            className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{detail.contact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{formatPhone(detail.contact.phone) || "Sin teléfono"}</p>
          <PhoneLocation phone={detail.contact.phone} />
        </div>
        {headerAction}
        {detail.channel.isTest && <PruebaBadge />}
        {/* "Pausar agente" / "Activar" viven SOLO en el Detalle del contacto (26-sep-2026). */}
        <span className="shrink-0 rounded-full bg-brand-navy/10 px-2.5 py-1 text-xs font-medium text-brand-navy">
          {labelOf(detail.contact.stage)}
        </span>
      </header>

      {/* Aviso de ventana de 24 h */}
      <div
        className={`border-b px-4 py-1.5 text-center text-xs ${
          windowOpen ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        }`}
      >
        {windowOpen
          ? `Ventana abierta · quedan ${hoursLeft} h`
          : detail.windowExpiresAt === null
            ? // Chat abierto por nosotros (primer mensaje, 28-sep-2026): el cliente aún no escribe.
              "El cliente todavía no escribe: mientras no conteste, solo se puede enviar una plantilla (o escríbele gratis desde WhatsApp Web)."
            : "Pasaron 24 h desde su último mensaje. Solo se puede enviar una plantilla."}
        <AdFreeWindowNote adEntry={detail.adEntry} nowMs={nowMs} />
      </div>
      <AgentPausedBanner agent={agent} nowMs={nowMs} />
      {/* Búsqueda en los chats (lupa amarilla): la palabra y «1 de N» para recorrerla. */}
      {searchTerm && (
        <div className="flex shrink-0 items-center gap-2 border-b border-busqueda-borde/50 bg-busqueda/15 px-3 py-1 text-xs md:px-4">
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" aria-live="polite">
            «{searchTerm}» ·{" "}
            {!activeSearch
              ? "buscando…"
              : activeSearch.ids.length === 0
                ? "no aparece en este chat"
                : `${activeSearch.index + 1} de ${activeSearch.ids.length}`}
          </span>
          {activeSearch && activeSearch.ids.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goToMatch(1)}
                aria-label="Coincidencia anterior"
                title="Anterior (más vieja)"
                className="flex size-7 items-center justify-center rounded-md hover:bg-busqueda/30"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => goToMatch(-1)}
                aria-label="Coincidencia siguiente"
                title="Siguiente (más reciente)"
                className="flex size-7 items-center justify-center rounded-md hover:bg-busqueda/30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Historial + caja de escribir: la capa para soltar archivos los cubre a los dos. */}
      <ChatDropZone enabled={canAttach} onFiles={attachments.addFiles} onBrowse={() => pickerRef.current?.click()}>
        {/* Hilo */}
        <div
          ref={scrollRef}
          onScroll={onHistoryScroll}
          className="chat-wallpaper min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4"
        >
          {loading && messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando mensajes…</p>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-brand-orange">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay mensajes.</p>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Cargar mensajes anteriores
                  </button>
                </div>
              )}
              {timeline.map((item) => {
                if (item.kind === "notice") {
                  // Fase E: el error del modelo lleva botones ("Reintentar" / "Apagar").
                  if (item.notice.kind === "agente_error") {
                    // La clave lleva la fecha: una tarjeta reabierta (mismo id) empieza limpia.
                    return <AgentErrorCard key={`aviso-${item.notice.id}-${item.notice.createdAt}`} notice={item.notice} onChanged={() => void reloadAgent()} />;
                  }
                  return <AgentNoticeLine key={`aviso-${item.notice.id}`} notice={item.notice} />;
                }
                const row = item.row;
                const key = isOptimistic(row) ? row.clientId : row.id;
                const prev = rows[(rowIndex.get(row) ?? 0) - 1];
                const showDay =
                  !prev || dayLabel(new Date(prev.sentAt)) !== dayLabel(new Date(row.sentAt));
                return (
                  <div key={key}>
                    {showDay && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                          {dayLabel(new Date(row.sentAt))}
                        </span>
                      </div>
                    )}
                    <Bubble
                      row={row}
                      searchTerm={searchTerm}
                      currentMatch={!isOptimistic(row) && row.id === currentMatchId}
                      onRetry={handleRetry}
                      onOpenAttachment={setViewing}
                    />
                  </div>
                );
              })}
            </>
          )}
          {/* Programados (A6) al final del hilo: van después de lo ya enviado. */}
          <ScheduledInThread
            key={`sched-${conversationId}`}
            conversationId={conversationId}
            windowExpiresAt={detail.windowExpiresAt}
            refreshToken={revalToken + scheduledRev}
            onCountChange={setScheduledCount}
          />
        </div>

        {/* Píldora "Agente IA leyendo/escribiendo/enviando" (flota sobre el fondo del historial). */}
        <AgentActivityPill conversationId={conversationId} refreshToken={revalToken} detailKey={detail} />
        {commandNotice && (
          <div className="mx-4 mb-1 flex items-center justify-between rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 text-xs">
            <span>{commandNotice}</span>
            <button type="button" onClick={() => setCommandNotice(null)} className="ml-3 text-muted-foreground hover:text-foreground" aria-label="Cerrar aviso">
              ✕
            </button>
          </div>
        )}
        {/* Composer (composer.tsx): texto libre, fragmentos y plantillas con la
            ventana abierta; solo plantilla cuando está cerrada. key: al cambiar de
            conversación se reinicia el borrador y se cierran los selectores. */}
        {detail.channel.archived ? <ArchivedComposer /> : <Composer
          key={conversationId}
          conversationId={conversationId}
          windowOpen={windowOpen}
          windowExpiresAt={detail.windowExpiresAt}
          onSendText={(text) => {
            setCommandNotice(null);
            void doSendOrCommand(text);
          }}
          onSendTemplate={(templateId, values, preview) => void doSendTemplate(templateId, values, preview)}
          onScheduled={() => setScheduledRev((n) => n + 1)}
          attachments={attachments}
          onPickFiles={() => pickerRef.current?.click()}
          onSendAttachments={doSendAttachments}
        />}
      </ChatDropZone>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        accept={attachmentAcceptAttr()}
        onChange={(event) => {
          if (canAttach) attachments.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {viewing && <MediaViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
