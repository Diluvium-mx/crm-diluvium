import { describe, expect, it } from "vitest";
import { roleAllows } from "./permissions";

// Política de fragmentos: TODOS los roles (owner/admin/agent) los gestionan —
// son la herramienta diaria del vendedor. El enforcement (lib/actions/snippets.ts)
// se apoya en esto y falla cerrado ante un rol desconocido.
describe("roleAllows (ACL de fragmentos)", () => {
  it("todos los roles (incluido agent) crean/leen/editan/borran fragmentos", () => {
    for (const role of ["owner", "admin", "agent"]) {
      expect(roleAllows(role, "snippet", "create")).toBe(true);
      expect(roleAllows(role, "snippet", "read")).toBe(true);
      expect(roleAllows(role, "snippet", "update")).toBe(true);
      expect(roleAllows(role, "snippet", "delete")).toBe(true);
    }
  });

  it("un rol desconocido no permite nada (falla cerrado)", () => {
    expect(roleAllows("desconocido", "snippet", "read")).toBe(false);
    expect(roleAllows("", "snippet", "create")).toBe(false);
  });
});

// Gestionar plantillas (alta en Meta, sincronización) es owner/admin; el agente
// solo LEE (para enviarlas desde el chat). Enviar no pasa por este ACL.
describe("roleAllows (ACL de plantillas)", () => {
  it("el agente lee plantillas pero NO las crea ni sincroniza", () => {
    expect(roleAllows("agent", "template", "read")).toBe(true);
    expect(roleAllows("agent", "template", "create")).toBe(false);
    expect(roleAllows("agent", "template", "sync")).toBe(false);
  });

  it("owner y admin gestionan plantillas (read/create/sync)", () => {
    for (const role of ["owner", "admin"]) {
      expect(roleAllows(role, "template", "read")).toBe(true);
      expect(roleAllows(role, "template", "create")).toBe(true);
      expect(roleAllows(role, "template", "sync")).toBe(true);
    }
  });
});
