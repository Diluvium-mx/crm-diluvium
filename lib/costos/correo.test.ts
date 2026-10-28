import { describe, expect, it } from "vitest";
import { asuntoCorreo, htmlCorreo } from "./correo";
import { type ReporteCostos, mesDe } from "./mes";

const base: ReporteCostos = {
  mes: mesDe("2026-10"),
  organizacion: "Diluvium <MX>",
  renglones: [
    { servicio: "IA · Anthropic", paraQue: "Agente IA (Sonnet)", usd: 1234.5, nota: null },
    { servicio: "Railway", paraQue: "Servidores del CRM", usd: null, nota: "Railway ya no tiene el periodo de ese mes" },
  ],
  totalUsd: 1234.5,
  sinDato: ["Railway"],
  ventas: 38,
  costoPorVentaUsd: 32.49,
  avisos: [],
};

describe("correo de costos", () => {
  it("asunto con el mes y el total", () => {
    expect(asuntoCorreo(base)).toBe("Costos del CRM · octubre de 2026 · US$1,234.50");
  });

  it("tabla con montos, «sin dato», notas, ventas y lo que falta del total; escapa el HTML", () => {
    const html = htmlCorreo(base);
    expect(html).toContain("US$1,234.50");
    expect(html).toContain("sin dato");
    expect(html).toContain("Railway ya no tiene el periodo de ese mes");
    expect(html).toContain("(sin Railway)");
    expect(html).toContain("Ventas del mes: <b>38</b>");
    expect(html).toContain("Costo del CRM por venta: <b>US$32.49</b>");
    expect(html).toContain("Diluvium &lt;MX&gt;");
    expect(html).not.toContain("Diluvium <MX>");
    // Sin avisos no sale el recuadro naranja.
    expect(html).not.toContain("#DE8C11");
  });

  it("los avisos van en el recuadro naranja", () => {
    const html = htmlCorreo({ ...base, avisos: ["Railway marca un pago pendiente"] });
    expect(html).toContain("#DE8C11");
    expect(html).toContain("Railway marca un pago pendiente");
  });
});
