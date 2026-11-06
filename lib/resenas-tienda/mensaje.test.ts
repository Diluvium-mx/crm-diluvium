import { describe, expect, it } from "vitest";
import { enlaceWhatsAppWeb, mensajesWhatsApp, nombreBonito, type DatosMensaje } from "./mensaje";

const BASE: DatosMensaje = { tienda: "mercado_libre", nombre: "Leticia", trato: "sra", saludo: "buenos días", vendedor: "Carlos" };

describe("mensajes para WhatsApp Web (textos fijos, sin IA)", () => {
  it("saludo con el trato, su nombre y quién escribe; la pregunta nombra la tienda", () => {
    const m = mensajesWhatsApp(BASE);
    expect(m.saludo).toBe("Hola, buenos días, Sra. Leticia. Le habla Carlos, de Diluvium 😃");
    expect(m.pregunta).toBe("Le escribo para saber cómo le fue con su compuerta anti-inundaciones que pidió en Mercado Libre. ¿Ya la pudo instalar?");
  });

  it("Sr., solo su nombre, sin nombre y sin vendedor", () => {
    expect(mensajesWhatsApp({ ...BASE, nombre: "Roberto", trato: "sr", saludo: "buenas tardes" }).saludo).toBe(
      "Hola, buenas tardes, Sr. Roberto. Le habla Carlos, de Diluvium 😃",
    );
    expect(mensajesWhatsApp({ ...BASE, trato: null }).saludo).toBe("Hola, buenos días, Leticia. Le habla Carlos, de Diluvium 😃");
    expect(mensajesWhatsApp({ ...BASE, nombre: "", vendedor: null }).saludo).toBe("Hola, buenos días. Le escribo de parte de Diluvium 😃");
  });

  it("las tres respuestas dicen dónde se deja en su tienda", () => {
    const ml = mensajesWhatsApp(BASE);
    for (const t of [ml.bien, ml.problema, ml.sinInstalar]) expect(t).toContain("en Mercado Libre, en «Mis compras» › la compuerta › «Opinar»");
    const amazon = mensajesWhatsApp({ ...BASE, tienda: "amazon" });
    for (const t of [amazon.bien, amazon.problema, amazon.sinInstalar]) expect(t).toContain("«Mis pedidos» › la compuerta › «Escribir una opinión del producto»");
    expect(amazon.pregunta).toContain("que pidió en Amazon");
  });

  it("nunca ofrece nada a cambio, ni comisión, ni pide estrellas", () => {
    for (const t of Object.values(mensajesWhatsApp(BASE))) {
      expect(t).not.toMatch(/estrella|descuento|regalo|c[oó]digo|gratis|comisi[oó]n|%/i);
    }
  });

  it("nombres en mayúsculas o minúsculas quedan bien escritos", () => {
    expect(nombreBonito("YANUSA")).toBe("Yanusa");
    expect(nombreBonito("maría josé")).toBe("María José");
    expect(nombreBonito("McKenzie")).toBe("McKenzie");
  });

  it("WhatsApp Web con el saludo ya escrito; sin teléfono, no hay enlace", () => {
    expect(enlaceWhatsAppWeb("+526691234567", "Hola, buenos días 😃")).toBe(
      "https://web.whatsapp.com/send?phone=526691234567&text=Hola%2C%20buenos%20d%C3%ADas%20%F0%9F%98%83",
    );
    expect(enlaceWhatsAppWeb(null, "Hola")).toBeNull();
  });
});
