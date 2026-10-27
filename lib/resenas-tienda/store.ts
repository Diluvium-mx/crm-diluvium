// Altas y cambios de las reseñas en Amazon y Mercado Libre (docs/opiniones.md § Amazon y
// Mercado Libre). Toda escritura va acotada a la organización.
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { opinionesConfig, resenasTienda } from "@/lib/db/schema";
import type { EstadoResena, Tienda } from "./tiendas";

/**
 * Lo que anotó el lector. Una fila por contacto: si ya estaba «por pedir» con otra tienda, se
 * cambia; si ya se pidió, se contestó o un vendedor la descartó, se queda como está (el
 * vendedor manda). Devuelve si cambió algo.
 */
export async function anotarCompraEnTienda(input: {
  organizationId: string;
  contactId: string;
  conversationId: string | null;
  tienda: Tienda;
  frase: string | null;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const filas = await db
    .insert(resenasTienda)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      tienda: input.tienda,
      frase: input.frase,
      origen: "lector",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [resenasTienda.organizationId, resenasTienda.contactId],
      set: {
        tienda: sql`excluded.tienda`,
        frase: sql`excluded.frase`,
        conversationId: sql`coalesce(excluded.conversation_id, ${resenasTienda.conversationId})`,
        updatedAt: now,
      },
      setWhere: and(eq(resenasTienda.estado, "por_pedir"), ne(resenasTienda.tienda, sql`excluded.tienda`)),
    })
    .returning({ id: resenasTienda.id });
  return filas.length > 0;
}

/** Lo que ya se sabe del contacto, para la ficha guardada del lector. */
export async function compraEnTiendaDe(
  organizationId: string,
  contactId: string,
): Promise<{ tienda: Tienda; estado: EstadoResena } | null> {
  const [fila] = await db
    .select({ tienda: resenasTienda.tienda, estado: resenasTienda.estado })
    .from(resenasTienda)
    .where(and(eq(resenasTienda.organizationId, organizationId), eq(resenasTienda.contactId, contactId)))
    .limit(1);
  return fila ? { tienda: fila.tienda as Tienda, estado: fila.estado as EstadoResena } : null;
}

/** El vendedor marca cómo quedó (o la descarta: el cliente no compró ahí). */
export async function cambiarEstadoResena(
  organizationId: string,
  id: string,
  estado: EstadoResena,
  now = new Date(),
): Promise<boolean> {
  const filas = await db
    .update(resenasTienda)
    .set({ estado, updatedAt: now })
    .where(and(eq(resenasTienda.id, id), eq(resenasTienda.organizationId, organizationId)))
    .returning({ id: resenasTienda.id });
  return filas.length > 0;
}

/** Ya salió el mensaje que pide la reseña. */
export async function marcarPedida(organizationId: string, id: string, userId: string, now = new Date()): Promise<void> {
  await db
    .update(resenasTienda)
    .set({ estado: "pedida", pedidaAt: now, pedidaPorUserId: userId, updatedAt: now })
    .where(and(eq(resenasTienda.id, id), eq(resenasTienda.organizationId, organizationId)));
}

/** Enlaces de reseña de las tiendas (vacío = el mensaje explica dónde se deja). */
export async function guardarEnlacesTiendas(
  organizationId: string,
  enlaces: { amazon: string | null; mercadoLibre: string | null },
  userId: string,
  now = new Date(),
): Promise<void> {
  const valores = { amazonResenaUrl: enlaces.amazon, mercadoLibreResenaUrl: enlaces.mercadoLibre, updatedAt: now, updatedByUserId: userId };
  await db
    .insert(opinionesConfig)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({ target: opinionesConfig.organizationId, set: valores });
}
