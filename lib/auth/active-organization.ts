import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, user } from "@/lib/db/schema/auth";

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

export async function requireActiveMembership(): Promise<ActiveMembership> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    throw new Error("No autenticado.");
  }

  const memberships = await db
    .select({ organizationId: member.organizationId, role: member.role, banned: user.banned })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.userId, session.user.id));

  // Usuario desactivado (A4): sus sesiones se borran al desactivarlo, pero la
  // cookie de sesión en caché (hasta 60 s) podría seguir viva; aquí se corta.
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

