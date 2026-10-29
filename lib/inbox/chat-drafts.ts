// Borradores del chat (29-oct-2026, decisión del dueño): lo que se escribe en la caja de un chat y no
// se envía se guarda en ESTE navegador, por usuario y conversación, y vuelve al regresar a ese chat
// (Bandeja, pop-up del Embudo y celular usan la misma caja). Sin servidor ni base de datos: no cuesta
// nada y nunca sale del equipo (ni al Agente IA ni a Zernio). Solo texto: los adjuntos se suben a un
// lugar temporal que vence. Se borra al enviar o vaciar la caja, solo a los 7 días sin tocarlo y
// todos al cerrar sesión. Reglas puras; lo que toca el navegador: dashboard/_components/use-chat-draft.ts.

export const DRAFT_PREFIX = "diluvium.borrador.";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;

/** Lo que se usa del almacenamiento del navegador (localStorage o, sin él, uno en memoria). */
export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

type Saved = { t: string; at: number };

export function draftKey(userId: string, conversationId: string): string {
  return `${DRAFT_PREFIX}${userId}.${conversationId}`;
}

/** Texto guardado, o null si no hay, está dañado o ya venció. */
export function parseDraft(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (typeof saved.t !== "string" || typeof saved.at !== "number") return null;
    if (now - saved.at > DRAFT_TTL_MS || saved.t.trim() === "") return null;
    return saved.t;
  } catch {
    return null;
  }
}

export function readDraft(store: DraftStore, userId: string, conversationId: string, now: number): string | null {
  return parseDraft(store.getItem(draftKey(userId, conversationId)), now);
}

/** Guarda el texto; vacío (o solo espacios) borra el borrador. */
export function writeDraft(store: DraftStore, userId: string, conversationId: string, text: string, now: number): void {
  const key = draftKey(userId, conversationId);
  if (text.trim() === "") {
    store.removeItem(key);
    return;
  }
  store.setItem(key, JSON.stringify({ t: text, at: now } satisfies Saved));
}

/** Quita los borradores vencidos o dañados (chats que ya no se abrieron); con `all`, todos. */
export function purgeDrafts(store: DraftStore, now: number, all = false): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    if (all || parseDraft(store.getItem(key), now) === null) store.removeItem(key);
  }
}

/** Almacenamiento en memoria: sin localStorage (bloqueado), el borrador dura lo que dure la página. */
export function memoryDraftStore(): DraftStore {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
