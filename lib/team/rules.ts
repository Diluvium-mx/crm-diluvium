// Reglas de "Configuración → Vendedores" (A4), puras para testearlas solas.
// El rol vive SOLO en member.role (plugin organization de Better Auth).
//
// - Solo owner/admin administran vendedores.
// - Un admin no toca al owner (ni puede asignar el rol owner).
// - Nadie se desactiva, ni se cambia el rol, ni se restablece la contraseña a
//   sí mismo desde aquí (la propia se cambia en "Mi cuenta").
// - Siempre queda al menos un owner ACTIVO.
// Estas reglas se aplican en la server action; la BD además garantiza el
// "≥1 owner activo" con un trigger (migración de A4), y la UI esconde lo que
// el usuario no puede hacer.

export const TEAM_ROLES = ["owner", "admin", "agent"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Vendedor",
};

export type TeamActor = { userId: string; role: string };
export type TeamTarget = { userId: string; role: string; banned: boolean };
export type TeamAction =
  | { type: "change_role"; newRole: string }
  | { type: "reset_password" }
  | { type: "deactivate" }
  | { type: "reactivate" };

function hasRole(roleField: string, role: TeamRole): boolean {
  return roleField.split(",").map((r) => r.trim()).includes(role);
}

export function isTeamManager(role: string): boolean {
  return hasRole(role, "owner") || hasRole(role, "admin");
}

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/**
 * ¿Puede `actor` hacer `action` sobre `target`? Devuelve el motivo en español
 * si no, o null si sí. `activeOwners` = owners activos (no desactivados) de la
 * organización ANTES de la acción.
 */
export function teamActionError(
  actor: TeamActor,
  target: TeamTarget,
  action: TeamAction,
  activeOwners: number,
): string | null {
  if (!isTeamManager(actor.role)) return "Solo un owner o un admin pueden administrar vendedores.";
  const actorIsOwner = hasRole(actor.role, "owner");
  const targetIsOwner = hasRole(target.role, "owner");

  if (target.userId === actor.userId) {
    if (action.type === "reset_password") return "Tu contraseña se cambia en “Mi cuenta”.";
    if (action.type === "deactivate") return "No puedes desactivarte a ti mismo.";
    return "No puedes cambiar tu propio rol ni tu estado.";
  }
  if (targetIsOwner && !actorIsOwner) return "Un admin no puede modificar al owner.";

  switch (action.type) {
    case "change_role": {
      if (!isTeamRole(action.newRole)) return "Rol inválido.";
      if (action.newRole === "owner" && !actorIsOwner) return "Solo un owner puede asignar el rol owner.";
      if (targetIsOwner && action.newRole !== "owner" && !target.banned && activeOwners <= 1) {
        return "Debe quedar al menos un owner activo.";
      }
      return null;
    }
    case "deactivate":
      if (target.banned) return "Ya está desactivado.";
      if (targetIsOwner && activeOwners <= 1) return "Debe quedar al menos un owner activo.";
      return null;
    case "reactivate":
      return target.banned ? null : "Ya está activo.";
    case "reset_password":
      return null;
  }
}

/** Rol que se le puede ASIGNAR a alguien nuevo según quién lo crea. */
export function assignableRoles(actorRole: string): TeamRole[] {
  return hasRole(actorRole, "owner") ? ["agent", "admin", "owner"] : isTeamManager(actorRole) ? ["agent", "admin"] : [];
}
