import { describe, expect, it } from "vitest";
import { whatsappPhoneLink, whatsappWebLink } from "./whatsapp-link";

describe("enlaces de WhatsApp con el texto ya puesto", () => {
  it("WhatsApp Web: teléfono en dígitos y texto codificado", () => {
    expect(whatsappWebLink("+526681234567", "Hola, buenas tardes. ¿Qué tal?")).toBe(
      "https://web.whatsapp.com/send?phone=526681234567&text=Hola%2C+buenas+tardes.+%C2%BFQu%C3%A9+tal%3F",
    );
    expect(whatsappWebLink("+526681234567", "   ")).toBe("https://web.whatsapp.com/send?phone=526681234567");
  });

  it("celular (wa.me): mismo número, texto opcional", () => {
    expect(whatsappPhoneLink("+526681234567")).toBe("https://wa.me/526681234567");
    expect(whatsappPhoneLink("+526681234567", "Hola & adiós")).toBe("https://wa.me/526681234567?text=Hola%20%26%20adi%C3%B3s");
  });
});
