"use client";

// Suscripción ÚNICA por pestaña al tiempo real de la bandeja (GET
// /api/inbox/stream, SSE sobre LISTEN/NOTIFY). La usan la Bandeja, el kanban de
// Contactos y el chat de su pop-up: todos comparten UNA sola conexión
// (EventSource de módulo con conteo de suscriptores) y reciben los mismos
// eventos. Se abre con el primer suscriptor y se cierra con el último.
// EventSource reconecta solo y el servidor manda `reload` en cada (re)conexión.
import { useEffect, useRef } from "react";
import type { InboxEvent } from "@/lib/inbox/types";

const EVENT_TYPES = [
  "reload",
  "conversation.updated",
  "message.upserted",
  "message.deleted",
  "contact.created",
  "contacts.bulk",
] as const;

type Listener = (event: InboxEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

function parse(type: string, data: string): InboxEvent | null {
  if (type === "reload") return { type: "reload" };
  try {
    return JSON.parse(data) as InboxEvent;
  } catch {
    return null;
  }
}

function open(): void {
  if (source) return;
  source = new EventSource("/api/inbox/stream");
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message: MessageEvent<string>) => {
      const event = parse(type, message.data);
      if (!event) return;
      for (const listener of [...listeners]) listener(event);
    });
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}

/** Llama `onEvent` con cada evento de la organización activa. El handler puede cambiar sin re-suscribir. */
export function useInboxStream(onEvent: (event: InboxEvent) => void): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => subscribe((event) => handler.current(event)), []);
}
