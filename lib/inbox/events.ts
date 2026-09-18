// Tiempo real de la bandeja: una sola conexión a Postgres escuchando el canal
// `inbox_events` (los triggers de la migración 0007 hacen NOTIFY en cada
// INSERT/UPDATE/DELETE de messages y conversations) y la reparte a los
// suscriptores en memoria de ESTE proceso.
//
// Por qué un solo LISTEN y no uno por cliente SSE: LISTEN ocupa una conexión
// mientras vive; con 2 vendedores y varias pestañas se agotarían. Aquí una
// conexión dedicada (max: 1) alimenta a todos.
//
// Aislamiento por organización: el payload del NOTIFY trae `org`; un
// suscriptor SOLO recibe los eventos de su organización. Nunca se difunde un
// evento a una organización distinta.
import "server-only";
import postgres from "postgres";
import type { InboxEvent } from "./types";

type Subscriber = { organizationId: string; send: (event: InboxEvent) => void };

type Hub = {
  sql: postgres.Sql;
  subscribers: Set<Subscriber>;
  ready: Promise<void>;
};

// Sobrevive al hot-reload de Next en desarrollo (un solo hub por proceso).
const globalForHub = globalThis as unknown as { inboxHub?: Hub };

function payloadToEvent(raw: string): { organizationId: string; event: InboxEvent } | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const { org, type, conversationId, messageId } = data as Record<string, unknown>;
    if (typeof org !== "string" || typeof type !== "string" || typeof conversationId !== "string") return null;
    if (type === "conversation.updated") {
      return { organizationId: org, event: { type, conversationId } };
    }
    if ((type === "message.upserted" || type === "message.deleted") && typeof messageId === "string") {
      return { organizationId: org, event: { type, conversationId, messageId } };
    }
    return null;
  } catch {
    return null;
  }
}

function createHub(): Hub {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Conexión propia para LISTEN (no la del pool de la app): max 1, sin timeout
  // de inactividad, para que la escucha no se cierre sola.
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 0, max_lifetime: 0 });
  const subscribers = new Set<Subscriber>();
  // `listen` reconecta solo si la conexión se cae (postgres-js). Al reconectar
  // se pudieron perder eventos: la UI ya revalida cada fila al recibir uno, y
  // además el `onlisten` fuerza un refresco total (ver el SSE).
  const ready = sql
    .listen("inbox_events", (raw) => {
      const parsed = payloadToEvent(raw);
      if (!parsed) return;
      for (const sub of subscribers) {
        if (sub.organizationId === parsed.organizationId) sub.send(parsed.event);
      }
    })
    .then(() => undefined);
  return { sql, subscribers, ready };
}

function hub(): Hub {
  globalForHub.inboxHub ??= createHub();
  return globalForHub.inboxHub;
}

/**
 * Suscribe a los eventos de UNA organización. Devuelve la función para
 * cancelar. `send` se llama con cada evento de esa organización.
 */
export async function subscribeToInbox(organizationId: string, send: (event: InboxEvent) => void): Promise<() => void> {
  const h = hub();
  await h.ready; // no perder eventos entre suscribirse y que LISTEN esté activo
  const subscriber: Subscriber = { organizationId, send };
  h.subscribers.add(subscriber);
  return () => h.subscribers.delete(subscriber);
}
