// Altas, respuestas y borrado de opiniones (docs/opiniones.md). Toda escritura va
// acotada a la organización; la respuesta del cliente entra por el token del enlace
// (la ruta pública /api/opinion), que ya trae su organización.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { opiniones, opinionesConfig, organization } from "@/lib/db/schema";
import { nuevoCodigo, nuevoToken, prefijoCodigo } from "./codigo";
import { aGuardar, type Respuesta } from "./respuestas";

/** Cuánto vale el enlace desde que se crea. */
export const VIGENCIA_DIAS = 60;
const INTENTOS = 5;

export async function crearOpinion(input: {
  organizationId: string;
  contactId?: string | null;
  conversationId?: string | null;
  prueba: boolean;
  userId?: string | null;
  now?: Date;
}): Promise<{ id: string; token: string; codigo: string }> {
  const now = input.now ?? new Date();
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);
  if (!org) throw new Error("Organización no encontrada");
  const prefijo = prefijoCodigo(org.name);
  const expiresAt = new Date(now.getTime() + VIGENCIA_DIAS * 86_400_000);

  // Token y código salen al azar: si chocan con uno existente (muy raro), otro.
  for (let intento = 1; ; intento++) {
    const fila = { id: crypto.randomUUID(), token: nuevoToken(), codigo: nuevoCodigo(prefijo) };
    try {
      await db.insert(opiniones).values({
        ...fila,
        organizationId: input.organizationId,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        prueba: input.prueba,
        createdByUserId: input.userId ?? null,
        createdAt: now,
        expiresAt,
      });
      return fila;
    } catch (error) {
      if (!isUniqueViolation(error) || intento >= INTENTOS) throw error;
    }
  }
}

export type ResultadoRespuesta = "ok" | "no_existe" | "ya_contestada" | "vencida";

/** Guarda la respuesta del cliente. Una sola vez por enlace y solo mientras esté vigente. */
export async function responderOpinion(r: Respuesta, now = new Date()): Promise<ResultadoRespuesta> {
  const [fila] = await db
    .select({ id: opiniones.id, answeredAt: opiniones.answeredAt, expiresAt: opiniones.expiresAt, org: organization.name })
    .from(opiniones)
    .innerJoin(organization, eq(organization.id, opiniones.organizationId))
    .where(eq(opiniones.token, r.token))
    .limit(1);
  if (!fila) return "no_existe";
  if (fila.answeredAt) return "ya_contestada";
  if (fila.expiresAt.getTime() <= now.getTime()) return "vencida";

  // `answered_at is null` en el mismo UPDATE: dos envíos a la vez no se pisan.
  const guardadas = await db
    .update(opiniones)
    .set({ ...aGuardar(r, fila.org), answeredAt: now })
    .where(and(eq(opiniones.id, fila.id), isNull(opiniones.answeredAt)))
    .returning({ id: opiniones.id });
  return guardadas.length > 0 ? "ok" : "ya_contestada";
}

/** Borra un enlace de prueba (nunca una opinión de un cliente). */
export async function borrarOpinionPrueba(organizationId: string, id: string): Promise<boolean> {
  const borradas = await db
    .delete(opiniones)
    .where(and(eq(opiniones.id, id), eq(opiniones.organizationId, organizationId), eq(opiniones.prueba, true)))
    .returning({ id: opiniones.id });
  return borradas.length > 0;
}

export async function guardarGoogleResenaUrl(organizationId: string, url: string | null, userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(opinionesConfig)
    .values({ organizationId, googleResenaUrl: url, updatedAt: now, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: opinionesConfig.organizationId,
      set: { googleResenaUrl: url, updatedAt: now, updatedByUserId: userId },
    });
}
