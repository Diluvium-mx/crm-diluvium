import { describe, expect, it } from "vitest";
import { SEND_ACCEPTED, SEND_RATE_LIMITED, SEND_UNCONFIRMED } from "./rules";
import { plainSendReason } from "./send-reasons";

describe("plainSendReason (motivo en palabras simples)", () => {
  it("explica los códigos comunes de WhatsApp", () => {
    expect(plainSendReason("131047")).toMatch(/ventana de 24 h está cerrada/);
    expect(plainSendReason("470")).toMatch(/ventana de 24 h/);
    expect(plainSendReason("131026")).toBe("ese número no puede recibir mensajes de WhatsApp");
    expect(plainSendReason("131053")).toBe("WhatsApp no pudo subir el archivo");
    expect(plainSendReason("131051")).toBe("WhatsApp no permite ese tipo de archivo");
    // El código puede venir dentro de otro texto del proveedor.
    expect(plainSendReason("whatsapp_131053")).toBe("WhatsApp no pudo subir el archivo");
  });

  it("cualquier otro código: «WhatsApp no lo entregó (código N)»", () => {
    expect(plainSendReason("131000", "Something went wrong")).toBe("WhatsApp no lo entregó (código 131000)");
    expect(plainSendReason("VALIDATION_ERROR")).toBe("WhatsApp no lo entregó (código VALIDATION_ERROR)");
  });

  it("los códigos del CRM también salen en español claro", () => {
    expect(plainSendReason(SEND_ACCEPTED)).toMatch(/sí recibió el mensaje/);
    expect(plainSendReason(SEND_UNCONFIRMED)).toMatch(/no confirmó/);
    expect(plainSendReason("send_unknown:network")).toMatch(/no confirmó/);
    expect(plainSendReason(SEND_RATE_LIMITED)).toMatch(/pidió esperar/);
    expect(plainSendReason("channel_unavailable", "El canal de WhatsApp de esta conversación no está disponible")).toBe(
      "El canal de WhatsApp de esta conversación no está disponible",
    );
  });
});
