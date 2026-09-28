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
//
// Historial (Bloque E, 28-sep-2026; filas que solo ven owner/admin): desactivar, reactivar y
// restablecer la contraseña se escriben aquí mismo, con drizzle, en UNA transacción con su
// fila (lo mismo que hacía el internalAdapter: columnas de `user`/`account` y borrar sesiones).
// El alta y el cambio de rol los hace Better Auth (sus reglas y su transacción): su fila se
// escribe en cuanto Better Auth confirma (logTeamChange). La contraseña NUNCA se guarda ahí.
import { and, asc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { account, member, session, user } from "@/lib/db/schema";
import { logChanges } from "@/lib/historial/log";
import type { ChangeAction } from "@/lib/historial/labels";
import { ROLE_LABELS, isTeamRole } from "./rules";

// Autor de sistema de las notas importadas (migraciones 0022/0023): no inicia
// sesión ni es miembro de ninguna organización. Nunca se "adopta" como vendedor,
// y su correo (dominio .invalid, RFC 2606: no existe) no se le da a nadie aunque
// la fila aún no exista (la 0022/0023 solo la crean si hay notas).
const SYSTEM_IMPORT_USER_ID = "usuario-sistema-importado";

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

/** Crea el usuario (correo + contraseña inicial) y lo agrega a la organización con su rol. Devuelve su id. */
export async function createSeller(params: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: string;
}): Promise<string> {
  await checkPasswordLength(params.password);
  const email = params.email.trim().toLowerCase();
  if (email.endsWith(".invalid")) throw new TeamError("Ese correo está reservado por el sistema.");
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) {
    if (existing.id === SYSTEM_IMPORT_USER_ID) throw new TeamError("Ese correo está reservado por el sistema.");
    const memberships = await db.select({ id: member.id }).from(member).where(eq(member.userId, existing.id)).limit(1);
    if (memberships.length > 0) throw new TeamError("Ya existe un usuario con ese correo.");
    // Usuario huérfano (un alta anterior se cortó entre crear el usuario y
    // agregarlo a la organización): se completa en vez de bloquear el correo.
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateUser(existing.id, { name: params.name.trim() });
    await setPassword(existing.id, params.password);
    await auth.api.addMember({
      body: { userId: existing.id, organizationId: params.organizationId, role: params.role as "agent" },
    });
    return existing.id;
  }

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
  return created.id;
}

/** Quién hizo el cambio y a quién, para la fila del historial. */
export type TeamLog = { organizationId: string; actorId: string; targetName: string };

export const roleLabel = (role: string) => role.split(",").map((r) => (isTeamRole(r.trim()) ? ROLE_LABELS[r.trim() as keyof typeof ROLE_LABELS] : r.trim())).join(", ");

function teamEntry(log: TeamLog, userId: string, action: ChangeAction["vendedores"], oldValue: string | null, newValue: string | null) {
  return { organizationId: log.organizationId, userId: log.actorId, kind: "vendedores" as const, action, subject: log.targetName, subjectId: userId, oldValue, newValue };
}

/** Alta o cambio de rol (los hace Better Auth): fila del historial en cuanto confirma. */
export async function logTeamChange(
  log: TeamLog,
  userId: string,
  change: { action: "alta"; role: string } | { action: "rol"; from: string; to: string },
): Promise<void> {
  await logChanges(
    db,
    change.action === "alta"
      ? teamEntry(log, userId, "alta", null, `Rol: ${roleLabel(change.role)}`)
      : teamEntry(log, userId, "rol", roleLabel(change.from), roleLabel(change.to)),
  );
}

/**
 * Nueva contraseña asignada por owner/admin; cierra las sesiones del usuario. Con `log`
 * (restablecer desde Vendedores) deja la fila en la misma transacción, SIN la contraseña.
 */
export async function setPassword(userId: string, password: string, log?: TeamLog): Promise<void> {
  await checkPasswordLength(password);
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx.insert(account).values({ id: crypto.randomUUID(), userId, providerId: "credential", accountId: userId, password: hash, createdAt: now, updatedAt: now });
    }
    await tx.delete(session).where(eq(session.userId, userId));
    if (log) await logChanges(tx, teamEntry(log, userId, "contrasena", null, null));
  });
}

/** Desactiva (no borra: sus mensajes conservan el autor) y revoca sus sesiones; o lo reactiva. */
export async function setDeactivated(userId: string, deactivated: boolean, log?: TeamLog): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ banned: deactivated, banReason: deactivated ? "Desactivado desde Configuración" : null, banExpires: null, updatedAt: new Date() })
        .where(eq(user.id, userId));
      if (deactivated) await tx.delete(session).where(eq(session.userId, userId));
      if (log) {
        await logChanges(
          tx,
          teamEntry(log, userId, deactivated ? "desactivar" : "reactivar", deactivated ? "Activo" : "Desactivado", deactivated ? "Desactivado" : "Activo"),
        );
      }
    });
  } catch (error) {
    // El trigger "≥1 owner activo" (diferido) truena al confirmar: mismo mensaje de siempre.
    mapDbError(error);
  }
}

export { mapDbError as mapTeamDbError };
