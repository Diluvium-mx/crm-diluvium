import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, user } from "@/lib/db/schema/auth";
import { timeServerAction } from "@/lib/monitoring/slow-actions";
import { esSoloLectura, SoloLecturaError } from "@/lib/auth/solo-lectura";

// Nunca confiar en un organization_id que venga del cliente (CLAUDE.md §7),
// ni tampoco en session.activeOrganizationId a secas: better-auth no lo
// rellena solo al crear la sesión (auth.api.setActiveOrganization es un
// endpoint aparte que nadie llama todavía tras el sign-in — confirmado en
// node_modules/better-auth/dist/plugins/organization/organization.mjs, sin
// databaseHooks de session.create que lo pueble por default) y removeMember
// no invalida las sesiones del miembro expulsado (organization/adapter.mjs),
// así que confiar en el campo de sesión dejaría con acceso a un miembro ya
// removido. Por eso cada llamada resuelve la organización contra la
// membresía vigente en `member`, no contra el campo cacheado en la sesión.
// `role` es el del miembro (owner|admin|agent). Lo usan las acciones que sí
// aplican el ACL de lib/auth/permissions.ts (p. ej. gestión de fragmentos);
// las que no lo aplican simplemente lo ignoran.
export type ActiveMembership = { organizationId: string; userId: string; role: string };

/**
 * Qué hace quien llama, para el rol «Solo lectura» (lib/auth/solo-lectura.ts):
 * - "consulta": solo lee. Se le permite.
 * - "cambio": guarda, envía, borra o gasta. Se le rechaza con SoloLecturaError.
 * Sin decirlo cuenta como "cambio", en TODO (Server Actions, páginas y rutas): falla cerrado. Las
 * páginas, layouts, rutas GET y acciones que solo leen lo declaran con `{ acceso: "consulta" }`.
 * No se decide por el encabezado `next-action`: Next también corre Server Actions como formulario
 * multipart SIN ese encabezado (action-handler.js › decodeAction), y así se saltaba el candado
 * (revisión del 26-nov-2026).
 */
export type Acceso = "consulta" | "cambio";

export async function requireActiveMembership(opciones: { acceso?: Acceso } = {}): Promise<ActiveMembership> {
  const requestHeaders = await headers();
  const membership = await resolveMembership(requestHeaders);
  const acceso = opciones.acceso ?? "cambio";
  if (acceso === "cambio" && esSoloLectura(membership.role)) {
    throw new SoloLecturaError();
  }
  return membership;
}

async function resolveMembership(requestHeaders: Headers): Promise<ActiveMembership> {
  // Toda Server Action pasa por aquí: si tarda ≥ 1 s, sale en el log con su nombre.
  timeServerAction(requestHeaders);
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    throw new Error("No autenticado.");
  }

  const memberships = await db
    .select({ organizationId: member.organizationId, role: member.role, banned: user.banned })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.userId, session.user.id));

  // Usuario desactivado (A4): sus sesiones se borran al desactivarlo; esto es
  // una segunda barrera por si quedara alguna sesión viva.
  if (memberships.some((m) => m.banned)) {
    throw new Error("Usuario desactivado.");
  }

  if (memberships.length === 0) {
    throw new Error("El usuario no tiene membresía activa en ninguna organización.");
  }

  const sessionOrganizationId = session.session.activeOrganizationId;

  const active = sessionOrganizationId
    ? memberships.find((m) => m.organizationId === sessionOrganizationId)
    : undefined;
  if (active) {
    return { organizationId: active.organizationId, userId: session.user.id, role: active.role };
  }

  // Sesión sin organización activa (recién creada por email-signin, que no
  // la fija) o apuntando a una de la que el usuario ya no es miembro: con
  // el modelo de una sola organización (Diluvium) basta con resolverla por
  // membresía. Con más de una, no hay forma segura de adivinar cuál.
  if (memberships.length === 1) {
    return { organizationId: memberships[0].organizationId, userId: session.user.id, role: memberships[0].role };
  }

  throw new Error(
    "El usuario pertenece a varias organizaciones y la sesión no tiene una organización activa válida.",
  );
}


/**
 * Para rutas PÚBLICAS (sin sesión obligatoria, p. ej. el formulario de opinión): ¿quien manda la petición
 * tiene sesión de «Solo lectura»? Sin sesión o con cualquier error: false (el cliente nunca tiene sesión).
 */
export async function sesionEsSoloLectura(requestHeaders: Headers): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return false;
    const rows = await db.select({ role: member.role }).from(member).where(eq(member.userId, session.user.id));
    return rows.some((m) => esSoloLectura(m.role));
  } catch {
    return false;
  }
}
