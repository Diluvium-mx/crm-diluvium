import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...ownerAc.statements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
});

export const agent = ac.newRole({
  contact: ["create", "read", "update"],
  tag: ["create", "read", "update"],
  snippet: ["read"],
});

const roles = { owner, admin, agent } as const;

/**
 * ¿El rol (owner|admin|agent) permite `action` sobre `resource`, según el ACL de
 * arriba? Fuente única: lee los grants de los roles, sin duplicar la política.
 * Un rol desconocido no permite nada (falla cerrado).
 */
export function roleAllows(role: string, resource: keyof typeof statement, action: string): boolean {
  const roleAc = roles[role as keyof typeof roles] as
    | { statements: Record<string, readonly string[] | undefined> }
    | undefined;
  return roleAc?.statements[resource]?.includes(action) ?? false;
}
