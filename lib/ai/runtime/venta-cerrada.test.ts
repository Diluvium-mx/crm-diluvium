import { describe, expect, it } from "vitest";
import { defaultStages, type FunnelStage } from "@/lib/contacts/stages";
import { allowedAgentStage, isClientProof, isVendorMessage, vendorAnsweredProof, ventaCerradaHeld } from "./venta-cerrada";

type Row = { direction: string; source: string; attachments: { type: string }[] };
const cliente = (): Row => ({ direction: "in", source: "contact", attachments: [] });
const comprobante = (type = "image"): Row => ({ direction: "in", source: "contact", attachments: [{ type }] });
const sale = (source: string): Row => ({ direction: "out", source, attachments: [] });

describe("vendorAnsweredProof (venta cerrada solo con un vendedor, 2-oct-2026)", () => {
  it("sin comprobante del cliente no hay venta cerrada, aunque un vendedor escriba", () => {
    expect(vendorAnsweredProof([cliente(), sale("crm"), sale("business_app")])).toBe(false);
  });

  it("la confirmación del Agente IA o de un workflow no cuenta", () => {
    expect(vendorAnsweredProof([comprobante(), sale("ai_agent")])).toBe(false);
    expect(vendorAnsweredProof([comprobante(), sale("other_api")])).toBe(false);
  });

  it("un vendedor DESPUÉS del comprobante, desde el CRM o desde el celular", () => {
    expect(vendorAnsweredProof([comprobante(), sale("ai_agent"), sale("crm")])).toBe(true);
    expect(vendorAnsweredProof([comprobante(), sale("business_app")])).toBe(true);
    expect(vendorAnsweredProof([comprobante("document"), cliente(), sale("crm")])).toBe(true);
  });

  it("un vendedor que escribió ANTES del comprobante no lo confirmó", () => {
    expect(vendorAnsweredProof([sale("crm"), comprobante(), sale("ai_agent")])).toBe(false);
  });

  it("cuenta el ÚLTIMO comprobante: la foto de la puerta con un vendedor después no respalda el pago que llega más tarde", () => {
    const puerta = comprobante();
    expect(vendorAnsweredProof([puerta, sale("crm"), cliente(), comprobante(), sale("ai_agent")])).toBe(false);
    expect(vendorAnsweredProof([puerta, sale("crm"), comprobante(), sale("ai_agent"), sale("business_app"), cliente()])).toBe(true);
  });

  it("solo una imagen o un documento del cliente cuentan como comprobante (no audio, video ni lo que manda la empresa)", () => {
    expect(isClientProof(comprobante("audio"))).toBe(false);
    expect(isClientProof(comprobante("video"))).toBe(false);
    expect(isClientProof({ direction: "out", source: "crm", attachments: [{ type: "image" }] })).toBe(false);
    expect(isClientProof({ direction: "in", source: "contact", attachments: null as unknown as Row["attachments"] })).toBe(false);
    expect(isVendorMessage(sale("crm"))).toBe(true);
    expect(isVendorMessage({ direction: "in", source: "crm", attachments: [] })).toBe(false);
  });
});

describe("allowedAgentStage", () => {
  const stages = defaultStages();

  it("Compra sin vendedor → Cerca de compra; con vendedor → Compra", () => {
    expect(allowedAgentStage(stages, "compra", false)).toBe("cerca_compra");
    expect(allowedAgentStage(stages, "compra", true)).toBe("compra");
  });

  it("las demás etapas pasan igual; null sigue en null", () => {
    expect(allowedAgentStage(stages, "interesado", false)).toBe("interesado");
    expect(allowedAgentStage(stages, "cerca_compra", false)).toBe("cerca_compra");
    expect(allowedAgentStage(stages, null, false)).toBeNull();
  });

  it("sigue al PAPEL, no a la clave: columnas renombradas o con el papel en otra", () => {
    const custom: FunnelStage[] = [
      { id: "a", key: "nuevo", name: "Nuevo", position: 1, color: "#64748B", role: "entrada", botRule: "", modelSlot: 1 },
      { id: "b", key: "banco", name: "Datos enviados", position: 2, color: "#0A559A", role: "cerca_compra", botRule: "", modelSlot: 2 },
      { id: "c", key: "pagado", name: "Pagado", position: 3, color: "#059669", role: "venta_cerrada", botRule: "", modelSlot: 2 },
      { id: "d", key: "compra", name: "Entregado", position: 4, color: "#0891B2", role: null, botRule: "", modelSlot: 2 },
    ];
    expect(allowedAgentStage(custom, "pagado", false)).toBe("banco");
    expect(allowedAgentStage(custom, "compra", false)).toBe("compra");
  });

  it("el registro dice por qué se frenó", () => {
    expect(ventaCerradaHeld("compra")).toContain("falta que un vendedor confirme el pago");
  });
});
