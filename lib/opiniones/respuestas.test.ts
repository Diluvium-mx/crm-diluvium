import { describe, expect, it } from "vitest";
import { aGuardar, respuestaSchema, textoPermiso } from "./respuestas";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const base = { token: TOKEN, estrellas: 5, lluvia: "resistio", permiso: "sin_nombre" } as const;

function mensajes(input: unknown): string[] {
  const r = respuestaSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("respuestaSchema", () => {
  it("acepta lo mínimo: estrellas, lluvia y permiso", () => {
    const r = respuestaSchema.parse(base);
    expect(r).toMatchObject({ estrellas: 5, texto: "", nombre: "", ciudad: "" });
  });

  it("pide estrellas, lluvia y permiso con mensajes de usted", () => {
    expect(mensajes({ token: TOKEN })).toEqual([
      "Elija de 1 a 5 estrellas.",
      "Díganos si ya le tocó una lluvia.",
      "Díganos si podemos compartir su opinión.",
    ]);
  });

  it("estrellas solo de 1 a 5 y enteras", () => {
    expect(mensajes({ ...base, estrellas: 0 })).toEqual(["Elija de 1 a 5 estrellas."]);
    expect(mensajes({ ...base, estrellas: 6 })).toEqual(["Elija de 1 a 5 estrellas."]);
    expect(mensajes({ ...base, estrellas: 4.5 })).toEqual(["Elija de 1 a 5 estrellas."]);
  });

  it("con su nombre, el nombre es obligatorio (la ciudad no)", () => {
    expect(mensajes({ ...base, permiso: "con_nombre", nombre: "  " })).toEqual(["Escriba su nombre para compartirlo."]);
    expect(mensajes({ ...base, permiso: "con_nombre", nombre: "Rosa" })).toEqual([]);
  });

  it("rechaza un token que no es del formato", () => {
    expect(mensajes({ ...base, token: "corto" })).toEqual(["Este enlace no es válido."]);
  });

  it("limita el texto a 1000 letras", () => {
    expect(mensajes({ ...base, texto: "a".repeat(1001) })).toEqual(["Escriba máximo 1000 letras."]);
  });
});

describe("aGuardar", () => {
  it("sin permiso con nombre no guarda nombre ni ciudad", () => {
    const r = respuestaSchema.parse({ ...base, nombre: "Rosa", ciudad: "Culiacán", texto: " Muy buena " });
    expect(aGuardar(r, "Diluvium")).toEqual({
      estrellas: 5,
      texto: "Muy buena",
      lluvia: "resistio",
      permiso: "sin_nombre",
      nombre: null,
      ciudad: null,
      permisoTexto: "Autorizo a Diluvium a compartir mi opinión en sus redes y anuncios sin mi nombre.",
    });
  });

  it("con su nombre guarda nombre y ciudad; vacíos como null", () => {
    const r = respuestaSchema.parse({ ...base, permiso: "con_nombre", nombre: "Rosa", ciudad: "" });
    expect(aGuardar(r, "Diluvium")).toMatchObject({ texto: null, nombre: "Rosa", ciudad: null });
  });
});

describe("textoPermiso", () => {
  it("dice exactamente lo que autorizó", () => {
    expect(textoPermiso("Diluvium", "con_nombre")).toContain("con mi nombre y mi ciudad");
    expect(textoPermiso("Diluvium", "no")).toBe("No autorizo a Diluvium a compartir mi opinión: es solo para su equipo.");
  });
});
