// Acuse corto del cliente al final del chat (10-oct-2026).
import { describe, expect, it } from "vitest";
import { endsWithClientAck, type AckMessage } from "./acuse";

const out = (body: string): AckMessage => ({ direction: "out", type: "text", body });
const inn = (body: string | null, type = "text"): AckMessage => ({ direction: "in", type, body });

describe("endsWithClientAck", () => {
  it("«De acuerdo», «ok gracias», un emoji o un sticker después de nuestro mensaje", () => {
    expect(endsWithClientAck([out("¿Me manda la foto?"), inn("Gracias por la información, si animo le envío la foto"), out("Claro"), inn("De acuerdo")])).toBe(true);
    expect(endsWithClientAck([out("Listo"), inn("Ok"), inn("gracias 👍")])).toBe(true);
    expect(endsWithClientAck([out("Listo"), inn(null, "sticker")])).toBe(true);
  });
  it("no: pregunta, mensaje largo, audio, foto, último mensaje nuestro o chat sin mensajes nuestros", () => {
    expect(endsWithClientAck([out("Listo"), inn("¿y el envío?")])).toBe(false);
    expect(endsWithClientAck([out("Listo"), inn("Sí, solo que ahorita no estoy en mi casa, en cuanto llegue le mando la medida")])).toBe(false);
    expect(endsWithClientAck([out("Listo"), inn("Mide 1.20 m")])).toBe(false);
    expect(endsWithClientAck([out("Listo"), inn(null, "audio")])).toBe(false);
    expect(endsWithClientAck([out("Listo"), inn(null, "image")])).toBe(false);
    expect(endsWithClientAck([out("Listo"), inn("ok"), out("Con gusto")])).toBe(false);
    expect(endsWithClientAck([inn("Hola"), inn("ok")])).toBe(false);
    expect(endsWithClientAck([])).toBe(false);
  });
  it("todos los del final deben ser acuses", () => {
    expect(endsWithClientAck([out("Listo"), inn("ok"), inn("¿cuánto cuesta el envío a Tijuana?")])).toBe(false);
  });
});
