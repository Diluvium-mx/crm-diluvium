// Lecturas de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon y Mercado
// Libre), siempre acotadas a la organización de la sesión.
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, conversations, opinionesConfig, resenasTienda } from "@/lib/db/schema";
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
  windowExpiresAt: Date | null;
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
  windowExpiresAt: conversations.windowExpiresAt,
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

/** Primero las que faltan por pedir; las descartadas no salen. */
export async function listarResenasTienda(organizationId: string): Promise<ResenaFila[]> {
  const filas = await base(organizationId)
    .where(and(eq(resenasTienda.organizationId, organizationId), ne(resenasTienda.estado, "descartada")))
    .orderBy(sql`(${resenasTienda.estado} = 'por_pedir') desc`, desc(resenasTienda.createdAt))
    .limit(LIMITE);
  return filas.map(aFila);
}

export async function resenaTienda(organizationId: string, id: string): Promise<ResenaFila | null> {
  const [fila] = await base(organizationId)
    .where(and(eq(resenasTienda.organizationId, organizationId), eq(resenasTienda.id, id)))
    .limit(1);
  return fila ? aFila(fila) : null;
}

export type EnlacesTiendas = Readonly<Record<Tienda, string | null>>;

export async function enlacesTiendas(organizationId: string): Promise<EnlacesTiendas> {
  const [fila] = await db
    .select({ amazon: opinionesConfig.amazonResenaUrl, mercadoLibre: opinionesConfig.mercadoLibreResenaUrl })
    .from(opinionesConfig)
    .where(eq(opinionesConfig.organizationId, organizationId))
    .limit(1);
  return { amazon: fila?.amazon ?? null, mercado_libre: fila?.mercadoLibre ?? null };
}
