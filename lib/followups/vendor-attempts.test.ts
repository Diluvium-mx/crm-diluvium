import { describe, expect, it } from "vitest";
import { chatTail, type TailMessage } from "./vendor-attempts";

const at = (s: string) => new Date(`2026-10-0${s}:00Z`);
const cliente = (t: string): TailMessage => ({ direction: "in", source: "contact", at: at(t) });
const agente = (t: string): TailMessage => ({ direction: "out", source: "ai_agent", at: at(t) });
const vendedor = (t: string, source = "crm"): TailMessage => ({ direction: "out", source, sentByUserId: source === "crm" ? "u1" : null, at: at(t) });

describe("chatTail: seguimientos que ya hizo un vendedor", () => {
  it("el último es del cliente: no hay seguimiento", () => {
    expect(chatTail([agente("2T18:00"), cliente("2T18:05")])).toBeNull();
  });
  it("parada normal: el último mensaje nuestro, sin intentos del vendedor", () => {
    expect(chatTail([cliente("2T18:00"), agente("2T18:01"), agente("2T18:02")])).toEqual({ stopAt: at("2T18:02"), vendorAttempts: [] });
  });
  it("el vendedor escribe al día siguiente sin respuesta: es un intento (CRM o celular)", () => {
    const rows = [cliente("2T18:56"), agente("2T18:57"), vendedor("3T11:38"), vendedor("3T11:38")];
    expect(chatTail(rows)).toEqual({ stopAt: at("2T18:57"), vendorAttempts: [at("3T11:38")] });
    const cel = [cliente("2T18:56"), agente("2T18:57"), vendedor("3T11:38", "business_app"), vendedor("5T10:00", "business_app")];
    expect(chatTail(cel)?.vendorAttempts).toEqual([at("3T11:38"), at("5T10:00")]);
  });
  it("el vendedor contesta tarde una pregunta del cliente: eso es la parada, no un seguimiento", () => {
    expect(chatTail([cliente("2T18:00"), vendedor("3T09:00")])).toEqual({ stopAt: at("3T09:00"), vendorAttempts: [] });
  });
  it("una tanda tardía sin vendedor (automática) no cuenta", () => {
    expect(chatTail([cliente("2T18:00"), agente("2T18:01"), agente("3T09:00")])?.vendorAttempts).toEqual([]);
  });
});
