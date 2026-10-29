import { describe, expect, it } from "vitest";
import { clientNameWords, withoutUnknownName, withoutUnknownNames } from "./nombre-cliente";

// El caso del 28-oct: la clienta nunca dio su nombre; «Carlos» es el vendedor.
const CLIENTA = clientNameWords([
  "Buena tarde ya los contacte con mercado libre ya hice el pedido de 1 unidad",
  "Es correcto se pidió M",
  "Enterado cualquier duda los contacto",
  "YANUSA",
]);

describe("withoutUnknownName", () => {
  it("quita el nombre del vendedor con el que el Agente IA se dirigió a la clienta (28-oct)", () => {
    const r = withoutUnknownName("Claro, Carlos. Quedamos a sus órdenes para cualquier duda durante la instalación. ¡Gracias por su compra! 😊", CLIENTA);
    expect(r.text).toBe("Claro. Quedamos a sus órdenes para cualquier duda durante la instalación. ¡Gracias por su compra! 😊");
    expect(r.removed).toEqual(["Carlos"]);
  });

  it("quita el nombre al final, en medio, tras un saludo, con «don» o antes de un emoji", () => {
    const casos: [string, string][] = [
      ["Quedamos a sus órdenes, Carlos.", "Quedamos a sus órdenes."],
      ["¡Gracias por su compra, Carlos!", "¡Gracias por su compra!"],
      ["Mire, Carlos, le explico cómo medir.", "Mire, le explico cómo medir."],
      ["Hola Carlos, ¿cómo está?", "Hola, ¿cómo está?"],
      ["Buenas tardes Carlos.", "Buenas tardes."],
      ["Gracias, don Carlos.", "Gracias."],
      ["Con gusto, Carlos 😊", "Con gusto 😊"],
      ["No puedo darle un tiempo exacto, Carlos. El asesor le escribe.", "No puedo darle un tiempo exacto. El asesor le escribe."],
      ["Perfecto. Muchas gracias, Carlos", "Perfecto. Muchas gracias"],
      ["Gracias, Angela.", "Gracias."],
    ];
    for (const [antes, despues] of casos) expect(withoutUnknownName(antes, CLIENTA).text).toBe(despues);
  });

  it("deja el nombre que dio el cliente: escrito, dictado, en su perfil o en su usuario de Instagram", () => {
    const known = clientNameWords(["Buenas, soy ramon", "[nota de voz] le habla Sandra de Culiacán", "Rosa Martínez", "julio_mtz88"]);
    for (const t of ["Gracias, Ramón.", "Claro, Sandra. El comprobante ya llegó.", "Hola, Rosa.", "Hola Julio, ¿cómo está?", "Gracias, señora Martínez."]) {
      expect(withoutUnknownName(t, known)).toEqual({ text: t, removed: [] });
    }
  });

  it("un nombre de dos palabras sale completo si el cliente no dio las dos", () => {
    const known = clientNameWords(["Soy Juan"]);
    expect(withoutUnknownName("Gracias, Juan Carlos.", known)).toEqual({ text: "Gracias.", removed: ["Juan Carlos"] });
  });

  it("no toca lugares, direcciones, marcas ni cortesías", () => {
    for (const t of [
      "Estamos en Los Mochis, Sinaloa.",
      "Podemos enviarle el producto para que se lo reenvíe a Paiporta, Valencia.",
      "Av. Juárez 123, Col. Centro.",
      "Sí, Mercado Libre le dará el seguimiento.",
      "Claro, por Mercado Libre.",
      "Sí, Nuevo León.",
      "Gracias, igualmente.",
      "Claro, Igualmente.",
      "La compuerta estándar cuesta $5,500 MXN con envío incluido.",
      "Soy Angela, asesora de Diluvium. ¿Usted tiene problemas de inundaciones?",
      "Para una entrada de 95 cm corresponde el tamaño M, con un precio de $5,500 MXN y envío gratis.",
    ]) {
      expect(withoutUnknownName(t, CLIENTA)).toEqual({ text: t, removed: [] });
    }
  });
});

describe("withoutUnknownNames", () => {
  it("revisa cada burbuja y junta los nombres quitados", () => {
    const r = withoutUnknownNames(["Claro, Carlos. Mercado Libre le dará el seguimiento del envío.", "Si le surge cualquier duda, aquí estamos. 😊"], CLIENTA);
    expect(r).toEqual({ keep: ["Claro. Mercado Libre le dará el seguimiento del envío.", "Si le surge cualquier duda, aquí estamos. 😊"], removed: ["Carlos"] });
  });
});

describe("clientNameWords", () => {
  it("sin acentos ni mayúsculas y sin vacíos", () => {
    expect([...clientNameWords(["Ramón PEÑA", null, undefined, ""])]).toEqual(["ramon", "pena"]);
  });
});
