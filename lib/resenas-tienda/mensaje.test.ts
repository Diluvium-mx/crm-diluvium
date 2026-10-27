import { describe, expect, it } from "vitest";
import { mensajeResena } from "./mensaje";

const MZT = "America/Mazatlan";
const TARDE = new Date("2026-10-27T22:00:00Z"); // 15:00 en Mazatlán

describe("mensaje que pide la reseña (texto fijo, sin IA)", () => {
  it("saludo de la hora del cliente, la tienda y el enlace configurado", () => {
    const texto = mensajeResena("amazon", "https://www.amazon.com.mx/review/create-review?asin=B0F2792F2H", TARDE, MZT);
    expect(texto.startsWith("Hola, buenas tardes, le escribo de parte del equipo de Diluvium. Gracias por elegir nuestra compuerta en Amazon.")).toBe(true);
    expect(texto).toContain("Aquí la puede dejar: https://www.amazon.com.mx/review/create-review?asin=B0F2792F2H");
    expect(texto).toContain("Y si gusta mandarnos la foto por aquí también");
  });

  it("sin enlace, explica dónde se deja dentro de la tienda", () => {
    expect(mensajeResena("mercado_libre", null, TARDE, MZT)).toContain("en «Mis compras» › la compuerta › «Opinar»");
    expect(mensajeResena("amazon", null, TARDE, MZT)).toContain("en «Mis pedidos» › la compuerta");
  });

  it("nunca ofrece nada a cambio ni pide estrellas", () => {
    for (const texto of [mensajeResena("amazon", null, TARDE, MZT), mensajeResena("mercado_libre", null, TARDE, MZT)]) {
      expect(texto).not.toMatch(/estrella|descuento|regalo|c[oó]digo|gratis/i);
    }
  });
});
