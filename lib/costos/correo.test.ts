import { describe, expect, it } from "vitest";
import { asuntoCorreo, htmlCorreo } from "./correo";
import { type ReporteCostos, mesDe } from "./mes";

const base: ReporteCostos = {
  mes: mesDe("2026-10"),
  organizacion: "Diluvium <MX>",
  renglones: [
    { servicio: "IA · Anthropic", paraQue: "Agente IA (Sonnet)", usd: 1234.5, nota: null, mxn: 22837.25 },
    { servicio: "Railway", paraQue: "Servidores del CRM", usd: null, nota: "Railway ya no tiene el periodo de ese mes", mxn: null },
  ],
  totalUsd: 1234.5,
  totalMxn: 22837.25,
  sinDato: ["Railway"],
  ventas: 38,
  costoPorVentaUsd: 32.49,
  costoPorVentaMxn: 600.98,
  tipoCambio: { mxnPorUsd: 18.4993, dias: 22 },
  nota: null,
  avisos: [],
};

describe("correo de costos", () => {
  it("asunto con el mes y el total en pesos y dólares", () => {
    expect(asuntoCorreo(base)).toBe("Costos del CRM · octubre de 2026 · $22,837.25 (US$1,234.50)");
    expect(asuntoCorreo({ ...base, totalMxn: null })).toBe("Costos del CRM · octubre de 2026 · US$1,234.50");
  });

  it("pesos grandes y dólares abajo, «sin dato», notas, ventas, tipo de cambio; escapa el HTML; sin texto de pie", () => {
    const html = htmlCorreo(base);
    expect(html).toContain("$22,837.25");
    expect(html).toContain("US$1,234.50");
    expect(html).toContain("sin dato");
    expect(html).toContain("Railway ya no tiene el periodo de ese mes");
    expect(html).toContain("(sin Railway)");
    expect(html).toContain("Ventas del mes: <b>38</b>");
    expect(html).toContain("Costo del CRM por venta: <b>$600.98</b>");
    expect(html).toContain("Dólar a $18.50 (promedio de octubre, Diario Oficial).");
    expect(html).toContain("Diluvium &lt;MX&gt;");
    expect(html).not.toContain("Diluvium <MX>");
    expect(html).not.toContain("Correo automático del CRM");
    expect(html).not.toContain("Montos en dólares");
    // Sin avisos ni nota no salen los recuadros.
    expect(html).not.toContain("#DE8C11");
    expect(html).not.toContain("#F3F6FA");
  });

  it("sin tipo de cambio: solo dólares y sin la línea del dólar", () => {
    const html = htmlCorreo({ ...base, tipoCambio: null, totalMxn: null, costoPorVentaMxn: null, renglones: base.renglones.map((x) => ({ ...x, mxn: null })) });
    expect(html).toContain("octubre de 2026: US$1,234.50");
    expect(html).not.toContain("Dólar a");
    expect(html).not.toContain("$22,837.25");
  });

  it("la nota de una sola vez va en su recuadro y los avisos en el naranja", () => {
    const html = htmlCorreo({ ...base, nota: "Es el primer mes completo del CRM", avisos: ["Railway marca un pago pendiente"] });
    expect(html).toContain("#F3F6FA");
    expect(html).toContain("Es el primer mes completo del CRM");
    expect(html).toContain("#DE8C11");
    expect(html).toContain("Railway marca un pago pendiente");
  });
});
