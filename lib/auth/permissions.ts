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
