import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloLecturaError } from "./solo-lectura";

// El candado de «Solo lectura» en requireActiveMembership (lib/auth/solo-lectura.ts): sin base ni
// Better Auth; la sesión y la membresía son dobles.
const doubles = vi.hoisted(() => ({
  headers: new Headers(),
  role: "agent",
}));

vi.mock("next/headers", () => ({ headers: async () => doubles.headers }));
vi.mock("@/lib/monitoring/slow-actions", () => ({ timeServerAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "u1" }, session: { activeOrganizationId: "org1" } }) } },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => [{ organizationId: "org1", role: doubles.role, banned: false }],
        }),
      }),
    }),
  },
}));

const { requireActiveMembership } = await import("./active-organization");

const comoAccion = () => {
  doubles.headers = new Headers({ "next-action": "7f00abc" });
};
const comoPagina = () => {
  doubles.headers = new Headers();
};

describe("requireActiveMembership con «Solo lectura»", () => {
  beforeEach(() => {
    doubles.role = "viewer";
    comoPagina();
  });

  it("una Server Action sin declararse de consulta se rechaza (falla cerrado)", async () => {
    comoAccion();
    await expect(requireActiveMembership()).rejects.toBeInstanceOf(SoloLecturaError);
    await expect(requireActiveMembership({ acceso: "cambio" })).rejects.toBeInstanceOf(SoloLecturaError);
  });

  it("una Server Action de consulta sí pasa", async () => {
    comoAccion();
    await expect(requireActiveMembership({ acceso: "consulta" })).resolves.toEqual({ organizationId: "org1", userId: "u1", role: "viewer" });
  });

  it("una página pasa; una ruta que escribe (acceso: cambio) se rechaza", async () => {
    await expect(requireActiveMembership()).resolves.toMatchObject({ role: "viewer" });
    await expect(requireActiveMembership({ acceso: "cambio" })).rejects.toBeInstanceOf(SoloLecturaError);
  });

  it("los demás roles no cambian en nada", async () => {
    for (const role of ["owner", "admin", "agent"]) {
      doubles.role = role;
      comoAccion();
      await expect(requireActiveMembership()).resolves.toMatchObject({ role });
      await expect(requireActiveMembership({ acceso: "cambio" })).resolves.toMatchObject({ role });
      comoPagina();
      await expect(requireActiveMembership({ acceso: "cambio" })).resolves.toMatchObject({ role });
    }
  });
});
