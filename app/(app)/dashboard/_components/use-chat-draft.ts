"use client";

// Borrador del chat en ESTE navegador (reglas en lib/inbox/chat-drafts.ts). La caja de texto lo
// guarda con cada cambio y la lista de la Bandeja lo lee para mostrar «Borrador: …». Sin
// localStorage (bloqueado o lleno) vive en memoria mientras dure la página y no falla.
// useSyncExternalStore: en el servidor y durante la hidratación no hay borrador; en cuanto hidrata,
// React vuelve a pintar con lo guardado. Los cambios se avisan a todos los que lo leen.
import { useSyncExternalStore } from "react";
import { memoryDraftStore, purgeDrafts, readDraft, writeDraft, type DraftStore } from "@/lib/inbox/chat-drafts";

const listeners = new Set<() => void>();
const memory = memoryDraftStore();
// Si el navegador no deja usar localStorage, desde ahí todo va a la memoria.
let memoryOnly = false;
let purged = false;

function withStore<T>(fn: (store: DraftStore) => T): T {
  if (!memoryOnly) {
    try {
      return fn(window.localStorage);
    } catch {
      memoryOnly = true;
    }
  }
  return fn(memory);
}

function subscribe(fn: () => void): () => void {
  // Una vez por página: se quitan los borradores vencidos (chats que ya no se abrieron).
  if (!purged) {
    purged = true;
    withStore((store) => purgeDrafts(store, Date.now()));
  }
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** Borrador guardado de ese chat (null si no hay o aún no se sabe quién es el usuario). */
export function useSavedChatDraft(userId: string | null, conversationId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? withStore((store) => readDraft(store, userId, conversationId, Date.now())) : null),
    () => null,
  );
}

/** Guarda lo escrito (vacío lo borra). */
export function saveChatDraft(userId: string | null, conversationId: string, text: string): void {
  if (!userId) return;
  withStore((store) => writeDraft(store, userId, conversationId, text, Date.now()));
  listeners.forEach((fn) => fn());
}

/** Al cerrar sesión: no quedan textos de clientes en el navegador. */
export function clearAllChatDrafts(): void {
  withStore((store) => purgeDrafts(store, Date.now(), true));
  purgeDrafts(memory, Date.now(), true);
  listeners.forEach((fn) => fn());
}
