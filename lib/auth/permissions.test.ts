import { describe, expect, it } from "vitest";
import { roleAllows } from "./permissions";

// El enforcement de fragmentos (lib/actions/snippets.ts) se apoya en esta
// política: agente es SOLO lectura sobre snippets; owner/admin gestionan.
describe("roleAllows (ACL de fragmentos)", () => {
  it("el agente NO puede crear/editar/borrar fragmentos, pero sí leer", () => {
    expect(roleAllows("agent", "snippet", "create")).toBe(false);
    expect(roleAllows("agent", "snippet", "update")).toBe(false);
    expect(roleAllows("agent", "snippet", "delete")).toBe(false);
    expect(roleAllows("agent", "snippet", "read")).toBe(true);
  });

  it("owner y admin sí gestionan fragmentos", () => {
    for (const role of ["owner", "admin"]) {
      expect(roleAllows(role, "snippet", "create")).toBe(true);
      expect(roleAllows(role, "snippet", "update")).toBe(true);
      expect(roleAllows(role, "snippet", "delete")).toBe(true);
    }
  });

  it("un rol desconocido no permite nada (falla cerrado)", () => {
    expect(roleAllows("desconocido", "snippet", "read")).toBe(false);
    expect(roleAllows("", "snippet", "create")).toBe(false);
  });
});
