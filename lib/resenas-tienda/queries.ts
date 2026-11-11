// Lecturas de Seguimientos › Amazon y Mercado Libre (docs/opiniones.md § Amazon y Mercado
// Libre), siempre acotadas a la organización de la sesión.
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, resenasTienda, user } from "@/lib/db/schema";
import { esTrato, type EstadoResena, type Tienda, type Trato } from "./tiendas";

export type ResenaFila = {
  id: string;
  contactId: string;
  conversationId: string | null;
  tienda: Tienda;
  frase: string | null;
  estado: EstadoResena;
  trato: Trato | null;
  createdAt: Date;
  pedidaAt: Date | null;
  contacto: string;
  /** Su primer nombre, para el saludo. */
  nombre: string;
  telefono: string | null;
};

const LIMITE = 200;

const columnas = {
  id: resenasTienda.id,
  contactId: resenasTienda.contactId,
  conversationId: resenasTienda.conversationId,
  tienda: resenasTienda.tienda,
  frase: resenasTienda.frase,
  estado: resenasTienda.estado,
  trato: resenasTienda.trato,
  createdAt: resenasTienda.createdAt,
  pedidaAt: resenasTienda.pedidaAt,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  telefono: contacts.phoneE164,
};

type Cruda = Omit<ResenaFila, "tienda" | "estado" | "trato" | "contacto" | "nombre"> & {
  tienda: string;
  estado: string;
  trato: string | null;
  firstName: string;
  lastName: string | null;
};

function aFila({ firstName, lastName, ...f }: Cruda): ResenaFila {
  return {
    ...f,
    tienda: f.tienda as Tienda,
    estado: f.estado as EstadoResena,
    trato: esTrato(f.trato) ? f.trato : null,
    contacto: [firstName, lastName].filter(Boolean).join(" "),
    nombre: firstName.trim().split(/\s+/)[0] ?? "",
  };
}

function base(organizationId: string) {
  return db
    .select(columnas)
    .from(resenasTienda)
    .innerJoin(contacts, and(eq(contacts.id, resenasTienda.contactId), eq(contacts.organizationId, organizationId)));
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

/** Primer nombre de quien tiene la sesión abierta: firma el saludo («Le habla Carlos…»). */
export async function nombreDelVendedor(userId: string): Promise<string | null> {
  const [fila] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return fila?.name.trim().split(/\s+/)[0] || null;
}
