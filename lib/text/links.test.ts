import { describe, expect, it } from "vitest";
import { splitLinks } from "./links";

// Solo los links (texto visible → href).
function links(text: string) {
  return splitLinks(text)
    .filter((p) => p.href)
    .map((p) => [p.text, p.href]);
}

describe("splitLinks", () => {
  it("texto sin links queda en un solo pedazo", () => {
    expect(splitLinks("Hola, ¿tienen sucursal en Xalapa?")).toEqual([{ text: "Hola, ¿tienen sucursal en Xalapa?" }]);
    expect(splitLinks("")).toEqual([]);
  });

  it("link largo de MercadoLibre completo, con # y parámetros", () => {
    const url =
      "https://articulo.mercadolibre.com.mx/MLM-1966051269-compuerta-anti-inundaciones-defensa-proteccion-contra-agua-_JM#reco_item_pos=0&reco_backend=item_decorator&da_position=1&id_origin=/home/dynamic_access";
    expect(splitLinks(url)).toEqual([{ text: url, href: url }]);
  });

  it("conserva el texto alrededor y los saltos de línea", () => {
    expect(splitLinks("Aquí le paso el link:\nhttps://diluvium.com.mx/compuertas\nSaludos")).toEqual([
      { text: "Aquí le paso el link:\n" },
      { text: "https://diluvium.com.mx/compuertas", href: "https://diluvium.com.mx/compuertas" },
      { text: "\nSaludos" },
    ]);
  });

  it("www. y dominios sueltos se abren con https://", () => {
    expect(links("Visite www.diluvium.com.mx o diluvium.mx")).toEqual([
      ["www.diluvium.com.mx", "https://www.diluvium.com.mx/"],
      ["diluvium.mx", "https://diluvium.mx/"],
    ]);
  });

  it("links cortos con ruta (Amazon, WhatsApp)", () => {
    expect(links("amzn.to/3xYzAbc y a.co/d/5fGh y wa.me/5215512345678")).toEqual([
      ["amzn.to/3xYzAbc", "https://amzn.to/3xYzAbc"],
      ["a.co/d/5fGh", "https://a.co/d/5fGh"],
      ["wa.me/5215512345678", "https://wa.me/5215512345678"],
    ]);
  });

  it("varios links en un mismo mensaje", () => {
    expect(links("Amazon: https://www.amazon.com.mx/dp/B0X. MercadoLibre: http://mercadolibre.com.mx")).toEqual([
      ["https://www.amazon.com.mx/dp/B0X", "https://www.amazon.com.mx/dp/B0X"],
      ["http://mercadolibre.com.mx", "http://mercadolibre.com.mx/"],
    ]);
  });

  it("la puntuación de la frase queda fuera del link", () => {
    expect(links("Entre a https://diluvium.mx/tienda.")).toEqual([["https://diluvium.mx/tienda", "https://diluvium.mx/tienda"]]);
    expect(links("¿Ya vio https://diluvium.mx?")).toEqual([["https://diluvium.mx", "https://diluvium.mx/"]]);
    expect(links("(ver https://diluvium.mx/faq)")).toEqual([["https://diluvium.mx/faq", "https://diluvium.mx/faq"]]);
    expect(links('"https://diluvium.mx",')).toEqual([["https://diluvium.mx", "https://diluvium.mx/"]]);
    expect(links("*https://diluvium.mx*")).toEqual([["https://diluvium.mx", "https://diluvium.mx/"]]);
  });

  it("un paréntesis con pareja dentro del link se conserva", () => {
    expect(links("https://es.wikipedia.org/wiki/Presa_(hidráulica)")).toEqual([
      ["https://es.wikipedia.org/wiki/Presa_(hidráulica)", "https://es.wikipedia.org/wiki/Presa_(hidr%C3%A1ulica)"],
    ]);
  });

  it("un emoji pegado no entra en el link", () => {
    expect(links("https://diluvium.mx👍")).toEqual([["https://diluvium.mx", "https://diluvium.mx/"]]);
  });

  it("los correos no son links", () => {
    expect(links("Escríbanos a ventas@diluvium.com.mx")).toEqual([]);
    expect(links("mi correo es juan.perez@gmail.com")).toEqual([]);
  });

  it("frases en español sin espacio tras el punto no se vuelven link", () => {
    expect(links("Hola.me interesa la compuerta")).toEqual([]);
    expect(links("Grupo Diluvium S.A.de C.V.")).toEqual([]);
    expect(links("Mide 1.5m de ancho, cuesta $1,250.00 y pesa 3.5kg/m")).toEqual([]);
    expect(links("ok.gracias, etc.")).toEqual([]);
  });

  it("solo abre http/https; www. suelto no es link", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("escriba www. y luego el sitio")).toEqual([]);
    expect(links("ftp://diluvium.mx")).toEqual([["diluvium.mx", "https://diluvium.mx/"]]);
  });

  it("el texto de los pedazos reconstruye el original", () => {
    const text = "Link: https://diluvium.mx/a?b=1, correo ventas@diluvium.mx y www.amazon.com.mx.";
    expect(
      splitLinks(text)
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });
});
