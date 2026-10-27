import { describe, expect, it } from "vitest";
import { esTienda, fraseDeTienda, tiendasNombradas } from "./tiendas";

describe("tiendas en línea que nombra un texto", () => {
  it("Amazon y Mercado Libre como los escriben los clientes (acentos, mayúsculas, junto, ML, meli)", () => {
    expect(tiendasNombradas("La pedí por Amazon")).toEqual(["amazon"]);
    expect(tiendasNombradas("Me la traen por mercado libre")).toEqual(["mercado_libre"]);
    expect(tiendasNombradas("¿Sale igual por MercadoLibre?")).toEqual(["mercado_libre"]);
    expect(tiendasNombradas("¿En amazon o ML llega más rápido?")).toEqual(["amazon", "mercado_libre"]);
    expect(tiendasNombradas("la pedí en meli")).toEqual(["mercado_libre"]);
    expect(tiendasNombradas("MERCADO  LIBRE")).toEqual(["mercado_libre"]);
  });

  it("no confunde palabras que solo se parecen", () => {
    expect(tiendasNombradas("Me lo mandan a la amazonia?")).toEqual([]);
    expect(tiendasNombradas("en el mercado de la colonia, libre de agua")).toEqual([]);
    expect(tiendasNombradas("html y mlm")).toEqual([]);
  });

  it("solo las dos tiendas valen", () => {
    expect(esTienda("amazon")).toBe(true);
    expect(esTienda("mercado_libre")).toBe(true);
    expect(esTienda("walmart")).toBe(false);
    expect(esTienda(3)).toBe(false);
  });
});

describe("la frase del cliente que se ve en la lista", () => {
  it("la ÚLTIMA que nombra esa tienda, en un renglón", () => {
    const textos = ["Ya la encargué en Amazon, gracias", "Mañana la instalo", "Al final sí la pedí\npor Amazon"];
    expect(fraseDeTienda(textos, "amazon")).toBe("Al final sí la pedí por Amazon");
    expect(fraseDeTienda(textos, "mercado_libre")).toBeNull();
  });

  it("se recorta si es muy larga", () => {
    const larga = `La compré en Amazon ${"y ".repeat(200)}`;
    const frase = fraseDeTienda([larga], "amazon", 40);
    expect(frase).toHaveLength(40);
    expect(frase?.endsWith("…")).toBe(true);
  });
});
