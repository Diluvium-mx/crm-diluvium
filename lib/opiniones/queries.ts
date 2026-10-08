// Lecturas de opiniones (docs/opiniones.md): la página pública por token y la lista
// de Seguimientos › Opinión, siempre acotada a la organización de la sesión.
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, contacts, opiniones, opinionesConfig, organization } from "@/lib/db/schema";

export type EstadoOpinion = "pendiente" | "contestada" | "vencida";

export type OpinionPublica = {
  estado: EstadoOpinion;
  organizacion: string;
  codigo: string;
  /** WhatsApp de la empresa (E.164) para mandar la foto y para compartir; null si no hay canal. */
  telefonoEmpresa: string | null;
  googleResenaUrl: string | null;
};

function estadoDe(answeredAt: Date | null, expiresAt: Date, now: Date): EstadoOpinion {
  if (answeredAt) return "contestada";
  return expiresAt.getTime() <= now.getTime() ? "vencida" : "pendiente";
}

/** WhatsApp activo de la organización: el real antes que uno de prueba, el más nuevo primero. */
async function telefonoWhatsapp(organizationId: string): Promise<string | null> {
  const [canal] = await db
    .select({ phone: channels.phoneE164 })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.type, "whatsapp"),
        eq(channels.isActive, true),
        isNull(channels.archivedAt),
        sql`${channels.phoneE164} is not null`,
      ),
    )
    .orderBy(asc(channels.isTest), desc(channels.createdAt))
    .limit(1);
  return canal?.phone ?? null;
}

export async function opinionPorToken(token: string, now = new Date()): Promise<OpinionPublica | null> {
  const [fila] = await db
    .select({
      organizationId: opiniones.organizationId,
      codigo: opiniones.codigo,
      answeredAt: opiniones.answeredAt,
      expiresAt: opiniones.expiresAt,
      organizacion: organization.name,
      googleResenaUrl: opinionesConfig.googleResenaUrl,
    })
    .from(opiniones)
    .innerJoin(organization, eq(organization.id, opiniones.organizationId))
    .leftJoin(opinionesConfig, eq(opinionesConfig.organizationId, opiniones.organizationId))
    .where(eq(opiniones.token, token))
    .limit(1);
  if (!fila) return null;
  return {
    estado: estadoDe(fila.answeredAt, fila.expiresAt, now),
    organizacion: fila.organizacion,
    codigo: fila.codigo,
    telefonoEmpresa: await telefonoWhatsapp(fila.organizationId),
    googleResenaUrl: fila.googleResenaUrl ?? null,
  };
}

export type OpinionFila = {
  id: string;
  token: string;
  codigo: string;
  prueba: boolean;
  estado: EstadoOpinion;
  createdAt: Date;
  answeredAt: Date | null;
  expiresAt: Date;
  contacto: string | null;
  estrellas: number | null;
  texto: string | null;
  lluvia: string | null;
  permiso: string | null;
  nombre: string | null;
  ciudad: string | null;
};

const LIMITE = 200;

/** Lo más reciente primero (por respuesta o, si no ha contestado, por alta). */
export async function listarOpiniones(organizationId: string, now = new Date()): Promise<OpinionFila[]> {
  const filas = await db
    .select({
      id: opiniones.id,
      token: opiniones.token,
      codigo: opiniones.codigo,
      prueba: opiniones.prueba,
      createdAt: opiniones.createdAt,
      answeredAt: opiniones.answeredAt,
      expiresAt: opiniones.expiresAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      estrellas: opiniones.estrellas,
      texto: opiniones.texto,
      lluvia: opiniones.lluvia,
      permiso: opiniones.permiso,
      nombre: opiniones.nombre,
      ciudad: opiniones.ciudad,
    })
    .from(opiniones)
    .leftJoin(contacts, and(eq(contacts.id, opiniones.contactId), eq(contacts.organizationId, organizationId)))
    .where(eq(opiniones.organizationId, organizationId))
    .orderBy(desc(sql`coalesce(${opiniones.answeredAt}, ${opiniones.createdAt})`), desc(opiniones.createdAt))
    .limit(LIMITE);
  return filas.map(({ firstName, lastName, ...f }) => ({
    ...f,
    estado: estadoDe(f.answeredAt, f.expiresAt, now),
    contacto: firstName ? [firstName, lastName].filter(Boolean).join(" ") : null,
  }));
}

export async function googleResenaUrl(organizationId: string): Promise<string | null> {
  const [fila] = await db
    .select({ url: opinionesConfig.googleResenaUrl })
    .from(opinionesConfig)
    .where(eq(opinionesConfig.organizationId, organizationId))
    .limit(1);
  return fila?.url ?? null;
}
