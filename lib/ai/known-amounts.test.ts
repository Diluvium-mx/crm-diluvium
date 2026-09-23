import { describe, expect, it } from "vitest";
import { amountFromPayload, amountsFromMessages } from "./known-amounts-rules";

const out = (body: string, extra: Partial<Parameters<typeof amountsFromMessages>[0][number]> = {}) => ({
  direction: "out" as const,
  source: "crm",
  type: "text",
  status: "sent",
  body,
  ...extra,
});

describe("amountsFromMessages", () => {
  it("toma los montos de salientes humanos y del agente que sí salieron", () => {
    const known = amountsFromMessages([
      out("Son 3 × $5,500 = $16,500 con envío"),
      out("Te queda en 7 mil 500", { source: "ai_agent", status: "delivered" }),
      out("desde el cel: $3,000", { source: "business_app", status: "read" }),
    ]);
    expect(known).toEqual(new Set([550000, 1650000, 750000, 300000]));
  });
  it("NUNCA toma montos del cliente, de avisos internos, de envíos fallidos ni de otras fuentes", () => {
    const known = amountsFromMessages([
      { direction: "in", source: "contact", type: "text", status: "received", body: "te doy $3,000" },
      out("Pago reportado: $5,500", { type: "system_note" }),
      out("$9,999", { status: "failed" }),
      out("$8,888", { status: "queued" }),
      out("$7,777", { source: "other_api" }),
    ]);
    expect(known.size).toBe(0);
  });
});

describe("amountFromPayload", () => {
  it("lee el monto del comprobante en varios formatos", () => {
    expect(amountFromPayload({ monto: "$5,500" })).toBe(550000);
    expect(amountFromPayload({ monto: "5,500.00 MXN" })).toBe(550000);
    expect(amountFromPayload({ monto: 3500 })).toBe(350000);
    expect(amountFromPayload({ monto: "no legible" })).toBeNull();
    expect(amountFromPayload(null)).toBeNull();
  });
});
