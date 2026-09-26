import { describe, expect, it } from "vitest";
import { roleAllows, statement } from "./permissions";

type Resource = keyof typeof statement;

const policy = {
  owner: {
    contact: ["create", "read", "update", "delete", "import", "export"],
    tag: ["create", "read", "update", "delete"],
    snippet: ["create", "read", "update", "delete"],
    template: ["read", "create", "sync"],
    aiConfig: ["read", "update"],
    sizeRange: ["read", "update"],
    aiSpend: ["read", "update"],
    workflow: ["read", "run", "create", "update", "delete"],
    mediaAsset: ["read", "create", "delete"],
    settings: ["read"],
    member: ["create", "update", "delete"],
  },
  admin: {
    contact: ["create", "read", "update", "delete", "import", "export"],
    tag: ["create", "read", "update", "delete"],
    snippet: ["create", "read", "update", "delete"],
    template: ["read", "create", "sync"],
    aiConfig: ["read", "update"],
    sizeRange: ["read", "update"],
    aiSpend: ["read", "update"],
    workflow: ["read", "run", "create", "update", "delete"],
    mediaAsset: ["read", "create", "delete"],
    settings: ["read"],
    member: ["create", "update", "delete"],
  },
  agent: {
    contact: ["create", "read", "update"],
    tag: ["create", "read", "update"],
    snippet: ["create", "read", "update", "delete"],
    template: ["read"],
    aiConfig: ["read", "update"],
    sizeRange: ["read"],
    aiSpend: ["read"],
    workflow: ["read", "run", "create", "update", "delete"],
    mediaAsset: ["read", "create", "delete"],
    settings: [],
    member: [],
  },
  desconocido: {
    contact: [],
    tag: [],
    snippet: [],
    template: [],
    aiConfig: [],
    sizeRange: [],
    aiSpend: [],
    workflow: [],
    mediaAsset: [],
    settings: [],
    member: [],
  },
} as const satisfies Record<string, Partial<Record<Resource, readonly string[]>>>;

const actionsByResource = {
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
  template: ["read", "create", "sync"],
  aiConfig: ["read", "update"],
  sizeRange: ["read", "update"],
  aiSpend: ["read", "update"],
  workflow: ["read", "run", "create", "update", "delete"],
  mediaAsset: ["read", "create", "delete"],
  settings: ["read"],
  member: ["create", "update", "delete"],
} as const satisfies Partial<Record<Resource, readonly string[]>>;

describe.each(Object.entries(policy))("roleAllows: matriz de %s", (role, grants) => {
  it("permite y deniega exactamente la política declarada", () => {
    for (const [resource, actions] of Object.entries(actionsByResource) as [
      keyof typeof actionsByResource,
      readonly string[],
    ][]) {
      for (const action of actions) {
        expect(
          roleAllows(role, resource, action),
          `${role}.${resource}.${action}`,
        ).toBe(grants[resource].includes(action as never));
      }
    }
  });
});

describe("roleAllows: fallo cerrado", () => {
  it("deniega acciones inexistentes incluso en recursos permitidos", () => {
    expect(roleAllows("owner", "aiSpend", "delete")).toBe(false);
    expect(roleAllows("admin", "settings", "update")).toBe(false);
    expect(roleAllows("agent", "contact", "publish")).toBe(false);
  });

  it("deniega todo a roles desconocidos y al rol vacío", () => {
    for (const resource of Object.keys(actionsByResource) as (keyof typeof actionsByResource)[]) {
      for (const action of actionsByResource[resource]) {
        expect(roleAllows("desconocido", resource, action)).toBe(false);
        expect(roleAllows("", resource, action)).toBe(false);
      }
    }
  });
});
