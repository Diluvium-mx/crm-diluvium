// Tiempo real de la bandeja: una sola conexión a Postgres escuchando el canal
// `inbox_events` (los triggers de la migración 0008 hacen NOTIFY en cada
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
    const { org, type, conversationId, messageId, contactId } = data as Record<string, unknown>;
    if (typeof org !== "string" || typeof type !== "string") return null;
    // Contacto nuevo (p. ej. el primer mensaje de un número desconocido): el
    // kanban de Contactos lo agrega sin recargar.
    if (type === "contact.created" && typeof contactId === "string") {
      return { organizationId: org, event: { type, contactId } };
    }
    if (type === "contacts.bulk") return { organizationId: org, event: { type } };
    if (typeof conversationId !== "string") return null;
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

  // onlisten se llama en CADA (re)suscripción del canal: la primera vez (sin
  // suscriptores aún) y cada vez que postgres-js reconecta tras caerse la
  // conexión. En una reconexión se pudieron perder NOTIFYs mientras estuvo
  // caída, así que se difunde `reload` a los SSE ya abiertos para que la UI
  // revalide todo (sin esto, la bandeja quedaría "viva pero muda").
  const onListen = () => {
    for (const sub of subscribers) sub.send({ type: "reload" });
  };

  const ready = sql
    .listen(
      "inbox_events",
      (raw) => {
        const parsed = payloadToEvent(raw);
        if (!parsed) return;
        for (const sub of subscribers) {
          if (sub.organizationId === parsed.organizationId) sub.send(parsed.event);
        }
      },
      onListen,
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      // Si la suscripción inicial falla (p. ej. un blip de la DB), este hub
      // queda inservible: se descacha para que el próximo subscribeToInbox
      // cree uno nuevo en vez de quedarse con una promesa rechazada para
      // siempre. Se cierra la conexión para no filtrarla.
      if (globalForHub.inboxHub?.sql === sql) globalForHub.inboxHub = undefined;
      void sql.end({ timeout: 5 }).catch(() => {});
      throw error;
    });

  return { sql, subscribers, ready };
}

function hub(): Hub {
  globalForHub.inboxHub ??= createHub();
  return globalForHub.inboxHub;
}

/**
 * Suscribe a los eventos de UNA organización. Devuelve la función para
 * cancelar. `send` se llama con cada evento de esa organización (y con un
 * evento `reload` cuando la escucha se re-establece tras una reconexión).
 */
export async function subscribeToInbox(organizationId: string, send: (event: InboxEvent) => void): Promise<() => void> {
  const h = hub();
  await h.ready; // no perder eventos entre suscribirse y que LISTEN esté activo
  const subscriber: Subscriber = { organizationId, send };
  h.subscribers.add(subscriber);
  return () => h.subscribers.delete(subscriber);
}

/** Solo para pruebas: cierra el hub actual y lo descacha (fuerza recrearlo). */
export async function __resetInboxHubForTests(): Promise<void> {
  const h = globalForHub.inboxHub;
  globalForHub.inboxHub = undefined;
  if (h) await h.sql.end({ timeout: 5 }).catch(() => {});
}
