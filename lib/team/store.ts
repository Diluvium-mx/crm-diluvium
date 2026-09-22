import "server-only";

// Datos de "Configuración → Vendedores" (A4) con la organización EXPLÍCITA.
// Se usa lo que Better Auth ya trae (fuentes en node_modules/better-auth 1.7.4):
// - Crear usuario: plugin admin, `auth.api.createUser` llamado desde el
//   SERVIDOR sin headers (dist/plugins/admin/routes.mjs:152-153 lo permite solo
//   así; por HTTP exige un admin global, que aquí no existe).
// - Unirlo a la organización con su rol: plugin organization,
//   `auth.api.addMember` (dist/plugins/organization/routes/crud-members.mjs:20).
// - Desactivar: el campo `banned` del plugin admin. Su hook de creación de
//   sesión bloquea el inicio de sesión de un usuario con banned=true
//   (dist/plugins/admin/admin.mjs:30-45). Los endpoints /admin/ban-user y
//   /admin/set-user-password exigen el rol GLOBAL user.role, que este CRM NO
//   usa (el rol vive solo en member.role), así que se hace lo mismo que ellos
//   (routes.mjs:506-556 y 802-866) con el `internalAdapter` de Better Auth,
//   detrás de nuestras reglas (lib/team/rules.ts).
import { and, asc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, user } from "@/lib/db/schema";

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export type TeamMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
};

const ROLE_ORDER = sql`case when ${member.role} like '%owner%' then 0 when ${member.role} like '%admin%' then 1 else 2 end`;

export async function listTeam(organizationId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      banned: user.banned,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(ROLE_ORDER, asc(user.name));
  return rows.map((r) => ({ ...r, banned: r.banned ?? false }));
}

export async function loadTeamMember(organizationId: string, memberId: string): Promise<TeamMember> {
  const [row] = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      banned: user.banned,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new TeamError("Vendedor no encontrado en esta organización.");
  return { ...row, banned: row.banned ?? false };
}

/** Owners de la organización cuyo usuario no está desactivado. */
export async function countActiveOwners(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        sql`'owner' = any(string_to_array(${member.role}, ','))`,
        sql`coalesce(${user.banned}, false) = false`,
      ),
    );
  return Number(row?.n ?? 0);
}

// El trigger de la BD (migración de A4) rechaza dejar una organización sin owner
// activo con este mensaje; se traduce para la UI.
const NO_OWNER_MARK = "org_sin_owner_activo";
function mapDbError(error: unknown): never {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  if (text.includes(NO_OWNER_MARK)) throw new TeamError("Debe quedar al menos un owner activo.");
  throw error;
}

async function checkPasswordLength(password: string) {
  const ctx = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength) {
    throw new TeamError(`La contraseña debe tener al menos ${minPasswordLength} caracteres.`);
  }
  if (password.length > maxPasswordLength) {
    throw new TeamError(`La contraseña no puede pasar de ${maxPasswordLength} caracteres.`);
  }
}

/** Crea el usuario (correo + contraseña inicial) y lo agrega a la organización con su rol. */
export async function createSeller(params: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: string;
}): Promise<void> {
  await checkPasswordLength(params.password);
  const email = params.email.trim().toLowerCase();
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) throw new TeamError("Ya existe un usuario con ese correo.");

  // Sin headers = llamada de servidor (ver arriba). No se manda `role`: el rol
  // global del plugin admin no se usa; el rol real va en member.role.
  const { user: created } = await auth.api.createUser({
    body: { email, password: params.password, name: params.name.trim() },
  });
  try {
    await auth.api.addMember({
      body: { userId: created.id, organizationId: params.organizationId, role: params.role as "agent" },
    });
  } catch (error) {
    // Sin membresía el usuario no serviría y bloquearía el correo: se deshace.
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(created.id);
    throw error;
  }
}

/** Nueva contraseña asignada por owner/admin; cierra las sesiones del usuario. */
export async function setPassword(userId: string, password: string): Promise<void> {
  await checkPasswordLength(password);
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  if (await ctx.internalAdapter.findCredentialAccount(userId)) {
    await ctx.internalAdapter.updatePassword(userId, hash);
  } else {
    await ctx.internalAdapter.createAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  }
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/** Desactiva (no borra: sus mensajes conservan el autor) y revoca sus sesiones; o lo reactiva. */
export async function setDeactivated(userId: string, deactivated: boolean): Promise<void> {
  const ctx = await auth.$context;
  try {
    await ctx.internalAdapter.updateUser(userId, {
      banned: deactivated,
      banReason: deactivated ? "Desactivado desde Configuración" : null,
      banExpires: null,
    });
  } catch (error) {
    mapDbError(error);
  }
  if (deactivated) await ctx.internalAdapter.deleteUserSessions(userId);
}

export { mapDbError as mapTeamDbError };
