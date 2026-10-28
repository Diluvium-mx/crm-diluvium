import { describe, expect, it } from "vitest";
import { mensajeResena, textoPlantillaResena } from "./mensaje";

const MZT = "America/Mazatlan";
const TARDE = new Date("2026-10-27T22:00:00Z"); // 15:00 en Mazatlán

describe("mensaje que pide la reseña (texto fijo, sin IA)", () => {
  it("saludo de la hora del cliente, la tienda y dónde se deja", () => {
    const texto = mensajeResena("mercado_libre", TARDE, MZT);
    expect(texto.startsWith("Hola, buenas tardes, le escribo de parte del equipo de Diluvium. Gracias por elegir nuestra compuerta en Mercado Libre.")).toBe(true);
    expect(texto).toContain("en «Mis compras» › la compuerta › «Opinar»");
    expect(texto).toContain("Y si gusta mandarnos la foto por aquí también");
  });

  it("la plantilla lleva la tienda en {{1}}, igual que la aprobada por Meta", () => {
    expect(textoPlantillaResena("mercado_libre")).toBe(
      "Hola, le escribo de parte del equipo de Diluvium por la compuerta que pidió en Mercado Libre. ¿Ya la pudo instalar? Nos ayuda mucho saber cómo le quedó.",
    );
  });

  it("nunca ofrece nada a cambio ni pide estrellas", () => {
    for (const texto of [mensajeResena("mercado_libre", TARDE, MZT), textoPlantillaResena("mercado_libre")]) {
      expect(texto).not.toMatch(/estrella|descuento|regalo|c[oó]digo|gratis/i);
    }
  });
});
