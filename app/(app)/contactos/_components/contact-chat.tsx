"use client";

// Chat de un contacto dentro del modal de Contactos: reusa el MISMO componente
// de chat de la bandeja (ChatThread). Resuelve la conversación por contacto,
// cubre carga / sin conversación / error, y se mantiene en vivo con el SSE.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDetail, InboxEvent } from "@/lib/inbox/types";
import { getConversationByContact } from "@/lib/inbox/actions";
import { ChatThread } from "../../dashboard/_components/chat-thread";

function parseEvent(data: string): InboxEvent | null {
  try {
    return JSON.parse(data) as InboxEvent;
  } catch {
    return null;
  }
}

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

  // Tiempo real: recarga el hilo ante cambios de ESTA conversación y re-pide el
  // detalle en conversation.updated (ventana de 24 h) y en reload.
  useEffect(() => {
    const source = new EventSource("/api/inbox/stream");
    const matches = (event: MessageEvent): boolean => {
      const payload = parseEvent(event.data);
      const id = conversationIdRef.current;
      return Boolean(id && payload && "conversationId" in payload && payload.conversationId === id);
    };
    const onThread = (event: MessageEvent) => {
      if (matches(event)) setRevalToken((n) => n + 1);
    };
    const onConversation = (event: MessageEvent) => {
      if (matches(event)) void load();
    };
    const onReload = () => void load();
    source.addEventListener("reload", onReload);
    source.addEventListener("conversation.updated", onConversation);
    source.addEventListener("message.upserted", onThread);
    source.addEventListener("message.deleted", onThread);
    return () => source.close();
  }, [load]);

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
