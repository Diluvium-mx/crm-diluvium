import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nspell from "nspell";
import dictionary from "dictionary-es-mx";
import { isMisspelled, suggestionsFor } from "./rules";
import { findWords } from "./tokens";

// El mismo diccionario que sirve el CRM (public/diccionario), leído de node_modules.
const dict = nspell(Buffer.from(dictionary.aff), Buffer.from(dictionary.dic));
const bad = (text: string) => findWords(text).filter((t) => isMisspelled(t.word, dict)).map((t) => t.word);

describe("diccionario servido", () => {
  it("public/diccionario es el mismo que el paquete (si se actualiza el paquete, se copia otra vez)", () => {
    expect(readFileSync("public/diccionario/es-MX.aff").equals(Buffer.from(dictionary.aff))).toBe(true);
    expect(readFileSync("public/diccionario/es-MX.dic").equals(Buffer.from(dictionary.dic))).toBe(true);
  });
});

describe("isMisspelled", () => {
  it("marca las faltas comunes del vendedor", () => {
    expect(bad("Claro que si, con gusto le preparo la cotizacion. Tambien nesesito la altura para la instalacion.")).toEqual([
      "cotizacion",
      "Tambien",
      "nesesito",
      "instalacion",
    ]);
  });

  it("no marca el trato de usted con pronombres pegados", () => {
    expect(bad("Mándeme la foto, envíele la medida, dígame cuándo, puedo cotizarle hoy y mándemelo.")).toEqual([]);
  });

  it("no marca la marca, lugares, siglas ni unidades", () => {
    expect(bad("Diluvium en Los Mochis, Mazatlán y Culiacán, Sinaloa. Ok, el IVA va aparte; mide 240 cm.")).toEqual([]);
  });

  it("marca atajos de chat y letras sueltas que no son palabras", () => {
    expect(bad("porfavor dime xq q pasa, y a ti")).toEqual(["porfavor", "xq", "q"]);
  });
});

describe("findWords", () => {
  it("salta enlaces, correos, variables, comandos y lo que lleva números", () => {
    const words = findWords("Hola {{nombre}}, vea https://diluvium.com.mx/compuertas o escriba a ventas@diluvium.mx /tabla 2.40m m2 @diluvium").map(
      (t) => t.word,
    );
    expect(words).toEqual(["Hola", "vea", "o", "escriba", "a"]);
  });

  it("da la posición exacta de cada palabra", () => {
    expect(findWords("¿Cotización?")).toEqual([{ word: "Cotización", start: 1, end: 11 }]);
  });
});

describe("suggestionsFor", () => {
  it("primero lo que solo difiere en el acento", () => {
    expect(suggestionsFor("Tambien", dict)[0]).toBe("También");
    expect(suggestionsFor("cotizacion", dict)[0]).toBe("cotización");
    expect(suggestionsFor("envio", dict)[0]).toBe("envío");
  });

  it("corrige letras cambiadas", () => {
    expect(suggestionsFor("nesesito", dict)).toContain("necesito");
  });

  it("los atajos sugieren la forma completa", () => {
    expect(suggestionsFor("porfavor", dict)[0]).toBe("por favor");
    expect(suggestionsFor("xq", dict).slice(0, 2)).toEqual(["porque", "por qué"]);
  });

  it("nunca más de 3", () => {
    expect(suggestionsFor("quisas", dict).length).toBeLessThanOrEqual(3);
  });
});
