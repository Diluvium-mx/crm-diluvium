import { describe, expect, it } from "vitest";
import { isAllowedAuthRoute } from "./allowed-routes";

const req = (method: string, path: string) => new Request(`https://crm.example.com${path}`, { method });

describe("isAllowedAuthRoute (S3: solo entrar, salir y revisar la sesión)", () => {
  it("deja pasar las tres que usa el navegador", () => {
    expect(isAllowedAuthRoute(req("POST", "/api/auth/sign-in/email"))).toBe(true);
    expect(isAllowedAuthRoute(req("POST", "/api/auth/sign-out"))).toBe(true);
    expect(isAllowedAuthRoute(req("GET", "/api/auth/get-session?disableCookieCache=true"))).toBe(true);
    expect(isAllowedAuthRoute(req("POST", "/api/auth//Sign-In/email/"))).toBe(true); // misma ruta, otra escritura
  });
  it("cierra todo lo demás (organización, usuario, contraseña, admin) y otros métodos", () => {
    for (const path of [
      "/api/auth/organization/list-members",
      "/api/auth/organization/remove-member",
      "/api/auth/organization/update-member-role",
      "/api/auth/update-user",
      "/api/auth/change-password",
      "/api/auth/sign-up/email",
      "/api/auth/admin/list-users",
      "/api/auth/sign-in/email%2F..%2Forganization",
    ]) {
      expect(isAllowedAuthRoute(req("POST", path))).toBe(false);
    }
    expect(isAllowedAuthRoute(req("GET", "/api/auth/sign-in/email"))).toBe(false);
    expect(isAllowedAuthRoute(req("POST", "/api/auth/get-session"))).toBe(false);
  });
});
