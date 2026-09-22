"use client";

// Suscripción ÚNICA al tiempo real de la bandeja (GET /api/inbox/stream, SSE
// sobre LISTEN/NOTIFY). La usan la Bandeja y el chat del pop-up de Contactos:
// mismo flujo de eventos en ambos lados. EventSource reconecta solo y el
// servidor manda `reload` en cada (re)conexión.
import { useEffect, useRef } from "react";
import type { InboxEvent } from "@/lib/inbox/types";

const EVENT_TYPES = ["reload", "conversation.updated", "message.upserted", "message.deleted", "contact.created"] as const;

function parse(type: string, data: string): InboxEvent | null {
  if (type === "reload") return { type: "reload" };
  try {
    return JSON.parse(data) as InboxEvent;
  } catch {
    return null;
  }
}

/** Llama `onEvent` con cada evento de la organización activa. El handler puede cambiar sin re-suscribir. */
export function useInboxStream(onEvent: (event: InboxEvent) => void): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    const source = new EventSource("/api/inbox/stream");
    const listeners = EVENT_TYPES.map((type) => {
      const listener = (message: MessageEvent<string>) => {
        const event = parse(type, message.data);
        if (event) handler.current(event);
      };
      source.addEventListener(type, listener);
      return [type, listener] as const;
    });
    return () => {
      for (const [type, listener] of listeners) source.removeEventListener(type, listener);
      source.close();
    };
  }, []);
}
