import { describe, expect, it } from "vitest";
import { signInNoticeHref, signInNoticeText } from "./sign-in-notice";

describe("avisos de «Iniciar sesión»", () => {
  it("después de cambiar la contraseña pide entrar con la nueva", () => {
    expect(signInNoticeHref("contrasena")).toBe("/sign-in?aviso=contrasena");
    expect(signInNoticeText("contrasena")).toMatch(/contraseña nueva/);
  });

  it("sin aviso o con uno desconocido no muestra nada", () => {
    expect(signInNoticeText(null)).toBeNull();
    expect(signInNoticeText("otro")).toBeNull();
    expect(signInNoticeText("toString")).toBeNull();
  });
});
