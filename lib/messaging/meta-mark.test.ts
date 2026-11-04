import { describe, expect, it } from "vitest";
import { metaMarkColumns, parseMetaMark } from "./meta-mark";
import { normalizeZernioEvent } from "./zernio";

const delivered = (extra: Record<string, unknown>) => ({
  id: "evt_1",
  event: "message.delivered",
  message: { id: "z_1", platformMessageId: "wamid.ABC" },
  account: { id: "acc_1", platform: "whatsapp" },
  timestamp: "2026-11-04T18:00:00.000Z",
  ...extra,
});

describe("parseMetaMark", () => {
  it("lee la marca de Meta del aviso (cobrado, categoría, tipo y su ventana)", () => {
    const mark = parseMetaMark(
      delivered({
        pricing: { billable: true, pricingModel: "PMP", category: "SERVICE", type: "regular" },
        billingConversation: { id: "conv_9", expiresAt: "2026-11-05T18:00:00.000Z", originType: "service" },
      }),
    );
    expect(mark).toEqual({
      billable: true,
      category: "service",
      pricingType: "regular",
      windowExpiresAt: new Date("2026-11-05T18:00:00.000Z"),
      windowOrigin: "service",
    });
  });

  it("gratis por anuncio, con la expiración en segundos como la da Meta", () => {
    const mark = parseMetaMark(
      delivered({
        pricing: { billable: false, category: "referral_conversion", type: "free_entry_point" },
        billingConversation: { id: "c", expiresAt: 1793900000, originType: "referral_conversion" },
      }),
    );
    expect(mark?.billable).toBe(false);
    expect(mark?.pricingType).toBe("free_entry_point");
    expect(mark?.windowExpiresAt?.toISOString()).toBe(new Date(1793900000 * 1000).toISOString());
  });

  it("sin marca (Meta la deja en null en la mayoría de los avisos) → undefined", () => {
    expect(parseMetaMark(delivered({ pricing: null, billingConversation: null }))).toBeUndefined();
    expect(parseMetaMark(delivered({}))).toBeUndefined();
    expect(parseMetaMark(delivered({ pricing: { billable: "quizá", category: 7 } }))).toBeUndefined();
  });

  it("solo llena lo que trae: un aviso sin ventana no borra la que ya estaba", () => {
    const mark = parseMetaMark(delivered({ pricing: { billable: "true", category: "marketing", type: "regular" } }));
    expect(mark && metaMarkColumns(mark)).toEqual({ metaBillable: true, metaCategory: "marketing", metaPricingType: "regular" });
  });

  it("descarta fechas absurdas", () => {
    const mark = parseMetaMark(delivered({ billingConversation: { expiresAt: "no es fecha", originType: "marketing" } }));
    expect(mark).toEqual({ billable: null, category: null, pricingType: null, windowExpiresAt: null, windowOrigin: "marketing" });
  });
});

describe("normalizeZernioEvent: la marca viaja con el estado", () => {
  it("message.read con pricing → estado con su marca", () => {
    const event = normalizeZernioEvent({ ...delivered({ pricing: { billable: true, category: "utility", type: "regular" } }), event: "message.read" });
    expect(event).toMatchObject({ kind: "status", status: "read", providerMessageId: "wamid.ABC", metaMark: { billable: true, category: "utility" } });
  });

  it("sin pricing el estado sale igual que siempre, sin marca", () => {
    const event = normalizeZernioEvent(delivered({ pricing: null, billingConversation: null }));
    expect(event.kind).toBe("status");
    expect(event).not.toHaveProperty("metaMark");
  });
});
