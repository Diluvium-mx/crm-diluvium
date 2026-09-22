import { describe, expect, it } from "vitest";
import { assignableRoles, teamActionError } from "./rules";

const owner = { userId: "o1", role: "owner" };
const admin = { userId: "a1", role: "admin" };
const agent = { userId: "g1", role: "agent" };
const target = (userId: string, role: string, banned = false) => ({ userId, role, banned });

describe("teamActionError", () => {
  it("solo owner/admin administran", () => {
    expect(teamActionError(agent, target("g2", "agent"), { type: "deactivate" }, 1)).toMatch(/Solo un owner o un admin/);
    expect(teamActionError(admin, target("g2", "agent"), { type: "deactivate" }, 1)).toBeNull();
    expect(teamActionError(owner, target("g2", "agent"), { type: "reset_password" }, 1)).toBeNull();
  });

  it("nadie se desactiva, se cambia el rol ni se restablece la contraseña a sí mismo", () => {
    expect(teamActionError(owner, target("o1", "owner"), { type: "deactivate" }, 2)).toMatch(/desactivarte/);
    expect(teamActionError(admin, target("a1", "admin"), { type: "change_role", newRole: "agent" }, 1)).toMatch(/propio rol/);
    expect(teamActionError(admin, target("a1", "admin"), { type: "reset_password" }, 1)).toMatch(/Mi cuenta/);
  });

  it("un admin no toca al owner ni asigna el rol owner", () => {
    const o2 = target("o2", "owner");
    expect(teamActionError(admin, o2, { type: "reset_password" }, 2)).toMatch(/admin no puede modificar al owner/);
    expect(teamActionError(admin, o2, { type: "deactivate" }, 2)).toMatch(/admin no puede/);
    expect(teamActionError(admin, o2, { type: "change_role", newRole: "agent" }, 2)).toMatch(/admin no puede/);
    expect(teamActionError(admin, target("g2", "agent"), { type: "change_role", newRole: "owner" }, 1)).toMatch(
      /Solo un owner puede asignar/,
    );
    expect(teamActionError(owner, target("g2", "agent"), { type: "change_role", newRole: "owner" }, 1)).toBeNull();
  });

  it("siempre queda al menos un owner activo", () => {
    const o2 = target("o2", "owner");
    expect(teamActionError(owner, o2, { type: "deactivate" }, 1)).toMatch(/al menos un owner activo/);
    expect(teamActionError(owner, o2, { type: "deactivate" }, 2)).toBeNull();
    expect(teamActionError(owner, o2, { type: "change_role", newRole: "admin" }, 1)).toMatch(/al menos un owner/);
    expect(teamActionError(owner, o2, { type: "change_role", newRole: "admin" }, 2)).toBeNull();
    // Un owner ya desactivado no cuenta como activo: bajarle el rol no deja la org sin owner activo.
    expect(teamActionError(owner, target("o3", "owner", true), { type: "change_role", newRole: "agent" }, 1)).toBeNull();
  });

  it("desactivar/reactivar según el estado actual y roles válidos", () => {
    expect(teamActionError(owner, target("g2", "agent", true), { type: "deactivate" }, 1)).toMatch(/Ya está desactivado/);
    expect(teamActionError(owner, target("g2", "agent"), { type: "reactivate" }, 1)).toMatch(/Ya está activo/);
    expect(teamActionError(owner, target("g2", "agent", true), { type: "reactivate" }, 1)).toBeNull();
    expect(teamActionError(owner, target("g2", "agent"), { type: "change_role", newRole: "superadmin" }, 1)).toMatch(/Rol inválido/);
  });
});

describe("assignableRoles", () => {
  it("el owner asigna cualquier rol; el admin no asigna owner; el agente nada", () => {
    expect(assignableRoles("owner")).toEqual(["agent", "admin", "owner"]);
    expect(assignableRoles("admin")).toEqual(["agent", "admin"]);
    expect(assignableRoles("agent")).toEqual([]);
  });
});
