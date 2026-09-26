"use server";

// "Mi cuenta" (/mi-cuenta, menú del usuario: cualquier usuario cambia SU
// contraseña) y Configuración → "Vendedores" (solo owner/admin). ACL en 3 capas: la UI esconde lo que no se
// puede; aquí se exige el permiso del plugin organization (member:create /
// member:update / member:delete, lib/auth/permissions.ts) y las reglas de
// lib/team/rules.ts; y la BD garantiza que siempre quede un owner activo.
// Las contraseñas nunca se devuelven ni se muestran: solo se asignan.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import { ipRateLimiter } from "@/lib/rate-limit";
import { assignableRoles, isTeamRole, teamActionError, type TeamAction } from "@/lib/team/rules";
import {
  countActiveOwners,
  createSeller,
  listTeam,
  loadTeamMember,
  mapTeamDbError,
  setDeactivated,
  setPassword,
  TeamError,
  type TeamMember,
} from "@/lib/team/store";

export type TeamResult = { ok: true } | { ok: false; message: string };

// Intentos de "Mi cuenta" por IP: la server action llama a Better Auth sin
// pasar por /api/auth (donde vive el limiter), así que se limita aquí.
const PASSWORD_RULE = { name: "change-password", max: 10, windowMs: 15 * 60_000 };

async function run(action: () => Promise<void>): Promise<TeamResult> {
  try {
    await action();
    revalidatePath("/configuracion");
    return { ok: true };
  } catch (error) {
    if (error instanceof TeamError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Datos inválidos." };
    if (error instanceof APIError) return { ok: false, message: authErrorMessage(error) };
    throw error;
  }
}

function authErrorMessage(error: APIError): string {
  const code = (error.body as { code?: string } | undefined)?.code;
  switch (code) {
    case "INVALID_PASSWORD":
      return "La contraseña actual no es correcta.";
    case "PASSWORD_TOO_SHORT":
      return "La nueva contraseña es demasiado corta.";
    case "PASSWORD_TOO_LONG":
      return "La nueva contraseña es demasiado larga.";
    case "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER":
      return "No tienes permiso para modificar a este miembro.";
    case "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER":
      return "Debe quedar al menos un owner activo.";
    default:
      return "No se pudo completar la operación.";
  }
}

// ─── Mi cuenta ────────────────────────────────────────────────────────────

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual."),
  newPassword: z.string().min(12, "La nueva contraseña debe tener al menos 12 caracteres.").max(128),
});

export async function changeMyPassword(input: z.infer<typeof changePasswordSchema>): Promise<TeamResult> {
  await requireActiveMembership();
  const requestHeaders = await headers();
  const limited = await ipRateLimiter.check(new Request("http://crm.local/mi-cuenta", { headers: requestHeaders }), [PASSWORD_RULE]);
  if (limited) return { ok: false, message: "Demasiados intentos. Espera unos minutos." };
  return run(async () => {
    const parsed = changePasswordSchema.parse(input);
    // Better Auth verifica la actual y, con revokeOtherSessions, cierra las
    // demás sesiones del usuario (dist/api/routes/update-user.mjs:75).
    await auth.api.changePassword({
      headers: requestHeaders,
      body: { currentPassword: parsed.currentPassword, newPassword: parsed.newPassword, revokeOtherSessions: true },
    });
  });
}

// ─── Vendedores ───────────────────────────────────────────────────────────

async function requireManager(permission: "create" | "update" | "delete") {
  const membership = await requireActiveMembership();
  if (!roleAllows(membership.role, "member", permission)) {
    throw new TeamError("Solo un owner o un admin pueden administrar vendedores.");
  }
  return membership;
}

async function guard(memberId: string, action: TeamAction, permission: "update" | "delete") {
  const actor = await requireManager(permission);
  const target = await loadTeamMember(actor.organizationId, memberId);
  const reason = teamActionError(
    { userId: actor.userId, role: actor.role },
    target,
    action,
    await countActiveOwners(actor.organizationId),
  );
  if (reason) throw new TeamError(reason);
  return { actor, target };
}

export async function listSellers(): Promise<{ members: TeamMember[]; me: string; myRole: string }> {
  const actor = await requireActiveMembership();
  if (!roleAllows(actor.role, "member", "update")) return { members: [], me: actor.userId, myRole: actor.role };
  return { members: await listTeam(actor.organizationId), me: actor.userId, myRole: actor.role };
}

const addSellerSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  email: z.email("Correo inválido."),
  password: z.string().min(12, "La contraseña inicial debe tener al menos 12 caracteres.").max(128),
  role: z.string().default("agent"),
});

export async function addSeller(input: z.input<typeof addSellerSchema>): Promise<TeamResult> {
  return run(async () => {
    const actor = await requireManager("create");
    const parsed = addSellerSchema.parse(input);
    if (!isTeamRole(parsed.role) || !assignableRoles(actor.role).includes(parsed.role)) {
      throw new TeamError("No puedes asignar ese rol.");
    }
    await createSeller({ organizationId: actor.organizationId, ...parsed });
  });
}

export async function changeSellerRole(memberId: string, newRole: string): Promise<TeamResult> {
  return run(async () => {
    const { actor } = await guard(z.string().min(1).parse(memberId), { type: "change_role", newRole }, "update");
    // Lo aplica Better Auth, que además repite sus propias reglas de owner
    // (dist/plugins/organization/routes/crud-members.mjs:236).
    try {
      await auth.api.updateMemberRole({
        headers: await headers(),
        body: { memberId, role: newRole as "agent", organizationId: actor.organizationId },
      });
    } catch (error) {
      if (error instanceof APIError) throw error;
      mapTeamDbError(error);
    }
  });
}

const passwordSchema = z.string().min(12, "La contraseña debe tener al menos 12 caracteres.").max(128);

export async function resetSellerPassword(memberId: string, newPassword: string): Promise<TeamResult> {
  return run(async () => {
    const { target } = await guard(z.string().min(1).parse(memberId), { type: "reset_password" }, "update");
    await setPassword(target.userId, passwordSchema.parse(newPassword));
  });
}

export async function deactivateSeller(memberId: string): Promise<TeamResult> {
  return run(async () => {
    const { target } = await guard(z.string().min(1).parse(memberId), { type: "deactivate" }, "delete");
    await setDeactivated(target.userId, true);
  });
}

export async function reactivateSeller(memberId: string): Promise<TeamResult> {
  return run(async () => {
    const { target } = await guard(z.string().min(1).parse(memberId), { type: "reactivate" }, "delete");
    await setDeactivated(target.userId, false);
  });
}
