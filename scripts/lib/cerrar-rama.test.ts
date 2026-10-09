import { describe, expect, it } from "vitest";
import { fechaMazatlan, leerWorktrees, motivoParaNoCerrar, nombreCorto, nombreEtiqueta } from "./cerrar-rama";

describe("cerrar-rama", () => {
  it("la fecha es la de Mazatlán, no la de UTC", () => {
    // 10-oct 03:30 UTC = 9-oct 21:30 en Mazatlán (UTC-7).
    expect(fechaMazatlan(new Date("2026-10-10T03:30:00Z"))).toBe("2026-10-09");
    expect(fechaMazatlan(new Date("2026-10-10T08:00:00Z"))).toBe("2026-10-10");
  });

  it("quita el prefijo y deja solo caracteres seguros", () => {
    expect(nombreCorto("fix/aviso-luz-unida")).toBe("aviso-luz-unida");
    expect(nombreCorto("feature/robot-disparo")).toBe("robot-disparo");
    expect(nombreCorto("chore/orden/repo")).toBe("orden-repo");
    expect(nombreCorto("sin-prefijo")).toBe("sin-prefijo");
    expect(nombreCorto("feat/Caché_24H")).toBe("cach-24h");
  });

  it("la etiqueta lleva fecha y rama, y no pisa una que ya existe", () => {
    const fecha = new Date("2026-10-09T20:00:00Z");
    expect(nombreEtiqueta("fix/complemento-rafaga", fecha, new Set())).toBe("prod-2026-10-09-complemento-rafaga");
    const existentes = new Set(["prod-2026-10-09-complemento-rafaga", "prod-2026-10-09-complemento-rafaga-2"]);
    expect(nombreEtiqueta("fix/complemento-rafaga", fecha, existentes)).toBe("prod-2026-10-09-complemento-rafaga-3");
  });

  it("nunca cierra main, staging ni la rama abierta", () => {
    expect(motivoParaNoCerrar("main", "main")).toMatch(/nunca/);
    expect(motivoParaNoCerrar("staging", "main")).toMatch(/nunca/);
    expect(motivoParaNoCerrar("fix/x", "fix/x")).toMatch(/abierta/);
    expect(motivoParaNoCerrar("", "main")).toMatch(/Falta/);
    expect(motivoParaNoCerrar("fix/x", "main")).toBeNull();
  });

  it("lee los worktrees con y sin rama", () => {
    const salida = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /chats/crm uno",
      "HEAD def",
      "branch refs/heads/fix/uno",
      "",
      "worktree /tmp/suelto",
      "HEAD 123",
      "detached",
      "",
    ].join("\n");
    expect(leerWorktrees(salida)).toEqual([
      { ruta: "/repo", rama: "main" },
      { ruta: "/chats/crm uno", rama: "fix/uno" },
      { ruta: "/tmp/suelto", rama: null },
    ]);
  });
});
