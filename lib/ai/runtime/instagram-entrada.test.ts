import { describe, expect, it } from "vitest";
import { defaultStages, type FunnelStage } from "@/lib/contacts/stages";
import { hasClientPhoto, instagramAllowedStage, instagramHeld, instagramStageLine } from "./instagram-entrada";

type Row = { direction: string; attachments: { type: string }[] | null };
const cliente = (...types: string[]): Row => ({ direction: "in", attachments: types.map((type) => ({ type })) });
const empresa = (...types: string[]): Row => ({ direction: "out", attachments: types.map((type) => ({ type })) });

describe("hasClientPhoto (Instagram se queda en la entrada hasta la foto, 27-oct-2026)", () => {
  it("solo cuenta una imagen que mandó el cliente", () => {
    expect(hasClientPhoto([cliente(), cliente("image")])).toBe(true);
    expect(hasClientPhoto([cliente(), empresa("image")])).toBe(false);
    expect(hasClientPhoto([cliente("video"), cliente("audio"), cliente("document")])).toBe(false);
    expect(hasClientPhoto([{ direction: "in", attachments: null }])).toBe(false);
    expect(hasClientPhoto([])).toBe(false);
  });
});

describe("instagramAllowedStage", () => {
  const stages = defaultStages();
  const sinFoto = { instagram: true, clientPhoto: false };

  it("Instagram sin foto: ni Prospecto ni Interesado (se queda en la entrada)", () => {
    expect(instagramAllowedStage(stages, "prospecto", sinFoto)).toBeNull();
    expect(instagramAllowedStage(stages, "interesado", sinFoto)).toBeNull();
  });

  it("Instagram sin foto: datos bancarios y comprobante mueven como siempre (una venta no se pierde)", () => {
    expect(instagramAllowedStage(stages, "cerca_compra", sinFoto)).toBe("cerca_compra");
    expect(instagramAllowedStage(stages, "compra", sinFoto)).toBe("compra");
  });

  it("con foto, o en WhatsApp, pasa la etapa que pidió; null sigue en null", () => {
    expect(instagramAllowedStage(stages, "interesado", { instagram: true, clientPhoto: true })).toBe("interesado");
    expect(instagramAllowedStage(stages, "prospecto", { instagram: false, clientPhoto: false })).toBe("prospecto");
    expect(instagramAllowedStage(stages, null, sinFoto)).toBeNull();
  });

  it("sigue al PAPEL, no a la clave: una columna nueva antes de «Cerca de compra» también espera la foto", () => {
    const custom: FunnelStage[] = [
      { id: "a", key: "nuevos", name: "Nuevos", position: 1, color: "#64748B", role: "entrada", botRule: "", modelSlot: 1 },
      { id: "b", key: "cotizado", name: "Cotizado", position: 2, color: "#0A559A", role: null, botRule: "", modelSlot: 1 },
      { id: "c", key: "por_pagar", name: "Por pagar", position: 3, color: "#7C3AED", role: "cerca_compra", botRule: "", modelSlot: 2 },
      { id: "d", key: "pagado", name: "Pagado", position: 4, color: "#059669", role: "venta_cerrada", botRule: "", modelSlot: 2 },
    ];
    expect(instagramAllowedStage(custom, "cotizado", sinFoto)).toBeNull();
    expect(instagramAllowedStage(custom, "por_pagar", sinFoto)).toBe("por_pagar");
    expect(instagramAllowedStage(custom, "no_existe", sinFoto)).toBeNull();
  });
});

describe("textos", () => {
  it("la línea para el modelo nombra la etapa de entrada vigente y pide foto y medida", () => {
    const line = instagramStageLine(defaultStages());
    expect(line).toContain("Chat de Instagram");
    expect(line).toContain("«Inbox»");
    expect(line).toMatch(/foto de SU entrada y dé la medida/);
  });

  it("el registro dice por qué se frenó", () => {
    expect(instagramHeld("prospecto")).toMatch(/^etapa prospecto: chat de Instagram sin foto/);
  });
});
