import { describe, expect, it } from "vitest";
import { enlaceCompartir, enlaceFoto, enlaceOpinion } from "./enlaces";

describe("enlaceFoto", () => {
  it("abre el chat de la empresa con el texto puesto", () => {
    const url = new URL(enlaceFoto("+526682419579"));
    expect(url.origin + url.pathname).toBe("https://wa.me/526682419579");
    expect(url.searchParams.get("text")).toBe("Hola, les mando la foto de cómo me quedó la compuerta.");
  });
});

describe("enlaceCompartir", () => {
  it("el mensaje lleva el enlace al chat de la empresa con el código", () => {
    const url = new URL(enlaceCompartir("+526682419579", "Diluvium", "DILU-4K7P"));
    expect(url.origin + url.pathname).toBe("https://wa.me/");
    const mensaje = url.searchParams.get("text") ?? "";
    expect(mensaje).toMatch(/^Yo puse una compuerta anti-inundaciones de Diluvium\./);
    const alChat = new URL(mensaje.slice(mensaje.indexOf("https://")));
    expect(alChat.pathname).toBe("/526682419579");
    expect(alChat.searchParams.get("text")).toBe("Hola, vengo de parte de un cliente de Diluvium. Mi código es DILU-4K7P.");
  });
});

describe("enlaceOpinion", () => {
  it("une la dirección del CRM con el token, sin doble diagonal", () => {
    expect(enlaceOpinion("https://crm.example.com/", "abc")).toBe("https://crm.example.com/opinion/abc");
    expect(enlaceOpinion("https://crm.example.com", "abc")).toBe("https://crm.example.com/opinion/abc");
  });
});
