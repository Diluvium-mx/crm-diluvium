// Lecturas de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon y Mercado
// Libre), siempre acotadas a la organización de la sesión.
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, messages, resenasTienda, templates } from "@/lib/db/schema";
import { PLANTILLA_RESENA } from "./mensaje";
import type { EstadoResena, Tienda } from "./tiendas";

export type ResenaFila = {
  id: string;
  contactId: string;
  conversationId: string | null;
  tienda: Tienda;
  frase: string | null;
  estado: EstadoResena;
  createdAt: Date;
  pedidaAt: Date | null;
  contacto: string;
  telefono: string | null;
  /** Del chat donde lo dijo: si todavía se le puede escribir texto libre. */
  canal: string | null;
  channelId: string | null;
  windowExpiresAt: Date | null;
  /** Última plantilla «Reseña en tienda» que salió en ese chat desde que lo dijo (sin las que fallaron). */
  plantillaAt: Date | null;
};

const LIMITE = 200;

const columnas = {
  id: resenasTienda.id,
  contactId: resenasTienda.contactId,
  conversationId: resenasTienda.conversationId,
  tienda: resenasTienda.tienda,
  frase: resenasTienda.frase,
  estado: resenasTienda.estado,
  createdAt: resenasTienda.createdAt,
  pedidaAt: resenasTienda.pedidaAt,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  telefono: contacts.phoneE164,
  canal: channels.type,
  channelId: conversations.channelId,
  windowExpiresAt: conversations.windowExpiresAt,
  plantillaAt: sql<Date | null>`(
    select max(coalesce(${messages.sentAt}, ${messages.createdAt})) from ${messages}
    where ${messages.organizationId} = ${resenasTienda.organizationId}
      and ${messages.conversationId} = ${resenasTienda.conversationId}
      and ${messages.direction} = 'out' and ${messages.templateName} = ${PLANTILLA_RESENA}
      and ${messages.status} <> 'failed' and coalesce(${messages.sentAt}, ${messages.createdAt}) >= ${resenasTienda.createdAt}
  )`.mapWith(messages.createdAt),
};

type Cruda = Omit<ResenaFila, "tienda" | "estado" | "contacto"> & {
  tienda: string;
  estado: string;
  firstName: string;
  lastName: string | null;
};

function aFila({ firstName, lastName, ...f }: Cruda): ResenaFila {
  return {
    ...f,
    tienda: f.tienda as Tienda,
    estado: f.estado as EstadoResena,
    contacto: [firstName, lastName].filter(Boolean).join(" "),
  };
}

function base(organizationId: string) {
  return db
    .select(columnas)
    .from(resenasTienda)
    .innerJoin(contacts, and(eq(contacts.id, resenasTienda.contactId), eq(contacts.organizationId, organizationId)))
    .leftJoin(
      conversations,
      and(eq(conversations.id, resenasTienda.conversationId), eq(conversations.organizationId, organizationId)),
    )
    .leftJoin(channels, eq(channels.id, conversations.channelId));
}

/** Lo más reciente primero (la vista las acomoda por sección); las quitadas no salen. */
export async function listarResenasTienda(organizationId: string): Promise<ResenaFila[]> {
  const filas = await base(organizationId)
    .where(and(eq(resenasTienda.organizationId, organizationId), ne(resenasTienda.estado, "descartada")))
    .orderBy(desc(resenasTienda.createdAt))
    .limit(LIMITE);
  return filas.map(aFila);
}

export async function resenaTienda(organizationId: string, id: string): Promise<ResenaFila | null> {
  const [fila] = await base(organizationId)
    .where(and(eq(resenasTienda.organizationId, organizationId), eq(resenasTienda.id, id)))
    .limit(1);
  return fila ? aFila(fila) : null;
}

/** La plantilla «Reseña en tienda» del canal de ese chat (su estado lo revisa el envío). */
export async function plantillaResenaId(organizationId: string, channelId: string): Promise<string | null> {
  const [fila] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.organizationId, organizationId), eq(templates.channelId, channelId), eq(templates.name, PLANTILLA_RESENA)))
    .limit(1);
  return fila?.id ?? null;
}
