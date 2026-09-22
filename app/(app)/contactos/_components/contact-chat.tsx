"use client";

// Chat de un contacto dentro del modal de Contactos: reusa el MISMO componente
// de chat de la bandeja (ChatThread). Resuelve la conversación por contacto,
// cubre carga / sin conversación / error, y se mantiene en vivo con el SSE.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDetail } from "@/lib/inbox/types";
import { getConversationByContact } from "@/lib/inbox/actions";
import { ChatThread } from "../../dashboard/_components/chat-thread";
import { useInboxStream } from "../../dashboard/_components/use-inbox-stream";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "none" }
  | { status: "ready"; detail: ConversationDetail };

export function ContactChat({ contactId }: { contactId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [revalToken, setRevalToken] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Id de la conversación resuelta, para que los handlers del SSE (suscritos
  // una sola vez) filtren sin re-suscribirse.
  const conversationIdRef = useRef<string | null>(null);
  const pendingLoadRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pendingLoadRef.current), []);

  const load = useCallback(async () => {
    try {
      const detail = await getConversationByContact(contactId);
      conversationIdRef.current = detail?.id ?? null;
      setState(detail ? { status: "ready", detail } : { status: "none" });
    } catch {
      setState({ status: "error" });
    }
  }, [contactId]);

  useEffect(() => {
    // Diferido: evita setState síncrono dentro del efecto (react-hooks).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Reloj para la ventana de 24 h.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tiempo real con el MISMO hook que la Bandeja: recarga el hilo ante cambios
  // de ESTA conversación y re-pide el detalle en conversation.updated (ventana
  // de 24 h) y en reload. Si el contacto aún no tenía conversación, la primera
  // que se cree para cualquiera dispara una nueva búsqueda (barata) por si es
  // la suya: así su primer mensaje aparece aquí sin recargar.
  useInboxStream((event) => {
    if (event.type === "reload") return void load();
    if (event.type === "contact.created" || event.type === "contacts.bulk") return;
    const id = conversationIdRef.current;
    if (!id) {
      // Con debounce: una ráfaga de mensajes de otros clientes = una búsqueda.
      if (event.type === "conversation.updated") {
        clearTimeout(pendingLoadRef.current);
        pendingLoadRef.current = setTimeout(() => void load(), 1_000);
      }
      return;
    }
    if (event.conversationId !== id) return;
    if (event.type === "conversation.updated") void load();
    else setRevalToken((n) => n + 1);
  });

  if (state.status === "loading") {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Cargando conversación…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-brand-orange">No se pudo cargar la conversación.</p>
        <button type="button" onClick={() => void load()} className="rounded-md border px-3 py-1 text-xs hover:bg-muted">
          Reintentar
        </button>
      </div>
    );
  }
  if (state.status === "none") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-3xl" role="img" aria-label="Chat">💬</span>
        <p className="text-sm font-medium">Aún no hay conversación</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Cuando este contacto escriba por WhatsApp, el historial aparecerá aquí.
        </p>
      </div>
    );
  }
  return <ChatThread detail={state.detail} revalToken={revalToken} nowMs={nowMs} />;
}
