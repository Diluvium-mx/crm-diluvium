import { describe, expect, it } from "vitest";
import type { BillingSnapshot } from "@/lib/dashboard/ai-spend";
import { armarReporte, mesAnterior, mesDe, renglonMeta, renglonRailway, renglonZernio, renglonesIa } from "./mes";

const OCT = mesDe("2026-10");
// Día 3 de noviembre a las 9:00 de Mazatlán: cuando corre el correo.
const DIA3 = new Date("2026-11-03T16:00:00Z");

function snap(provider: string, days: BillingSnapshot["days"], extra: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return { provider, days, balanceUsd: null, loadedUsd: null, fetchedAt: new Date("2026-11-03T15:55:00Z"), lastError: null, ...extra };
}

describe("mesAnterior / mesDe", () => {
  it("el día 3 de noviembre da octubre completo", () => {
    expect(mesAnterior(DIA3)).toEqual({ clave: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", nombre: "octubre de 2026" });
  });
  it("en enero da diciembre del año anterior", () => {
    expect(mesAnterior(new Date("2027-01-03T16:00:00Z")).clave).toBe("2026-12");
  });
  it("usa la hora de Mazatlán: el 1-nov a las 05:00 UTC todavía es 31 de octubre allá", () => {
    expect(mesAnterior(new Date("2026-11-01T05:00:00Z")).clave).toBe("2026-09");
  });
  it("febrero de año bisiesto y mes inválido", () => {
    expect(mesDe("2028-02").hasta).toBe("2028-02-29");
    expect(() => mesDe("2026-13")).toThrow(/Mes inválido/);
    expect(() => mesDe("oct")).toThrow(/Mes inválido/);
  });
});

describe("renglonesIa", () => {
  it("suma solo los días del mes de lo que COBRÓ cada proveedor; Anthropic y OpenAI siempre; los demás si gastaron", () => {
    const { renglones, avisos } = renglonesIa({
      mes: OCT,
      billing: [
        snap("anthropic", { "2026-09-30": { todo: 9 }, "2026-10-01": { todo: 1.25, prod: 1, pruebas: 0.25 }, "2026-10-31": { todo: 2 }, "2026-11-01": { todo: 7 } }),
        snap("xai", { "2026-10-05": { todo: 0.001 } }),
        snap("openrouter", { "2026-10-05": { todo: 0.5 } }),
      ],
      // El CRM calculó de más en Anthropic: no se usa porque hay reporte del proveedor.
      crmDays: [
        { day: "2026-10-01", provider: "anthropic", usd: 5 },
        { day: "2026-10-02", provider: "google", usd: 0.75 },
      ],
    });
    expect(renglones).toEqual([
      { servicio: "IA · Anthropic", paraQue: "Agente IA (Sonnet)", usd: 3.25, nota: null },
      { servicio: "IA · OpenAI", paraQue: "Agente IA (Luna) y audios", usd: 0, nota: null },
      { servicio: "IA · Google", paraQue: "Agente IA", usd: 0.75, nota: "calculado por el CRM (el proveedor no da su cobro)" },
      { servicio: "IA · OpenRouter", paraQue: "Agente IA", usd: 0.5, nota: null },
    ]);
    expect(avisos).toEqual([]);
  });

  it("avisa si la última lectura es de antes del cierre o falló", () => {
    const { avisos } = renglonesIa({
      mes: OCT,
      billing: [
        snap("anthropic", {}, { fetchedAt: new Date("2026-10-20T12:00:00Z"), lastError: "HTTP 401" }),
        snap("openai", {}, { fetchedAt: null, lastError: "HTTP 500" }),
      ],
      crmDays: [],
    });
    expect(avisos).toEqual([
      "Anthropic: el último dato leído es del 20-oct; el monto del mes puede venir incompleto.",
      "Anthropic: la última lectura del cobro falló; revisa el Dashboard.",
      "OpenAI: la última lectura del cobro falló; revisa el Dashboard.",
    ]);
  });
});

describe("renglonRailway", () => {
  const fila = {
    plan: "HOBBY",
    state: "ACTIVE",
    periodStart: new Date("2026-10-05T23:44:00Z"),
    periodEnd: new Date("2026-11-05T23:44:00Z"),
    usageUsd: 11.6,
    fetchedAt: new Date("2026-11-03T15:55:00Z"),
    lastError: null,
  };
  it("el periodo que empieza en el mes, como factura estimada al corte del 5", () => {
    const { renglon, avisos } = renglonRailway(fila, OCT, DIA3);
    // 11.60 en 28.67 días de 31 → 12.54 al corte.
    expect(renglon).toEqual({ servicio: "Railway", paraQue: "Servidores del CRM", usd: 12.54, nota: "periodo 5-oct → 5-nov; estimado, se cobra el 5-nov" });
    expect(avisos).toEqual([]);
  });
  it("si Railway ya pasó al periodo siguiente, sin dato; con pago pendiente, aviso", () => {
    const out = renglonRailway({ ...fila, state: "PAST_DUE", periodStart: new Date("2026-11-05T23:44:00Z"), periodEnd: new Date("2026-12-05T23:44:00Z") }, OCT, DIA3);
    expect(out.renglon.usd).toBeNull();
    expect(out.avisos[0]).toMatch(/pago pendiente/);
    expect(renglonRailway(null, OCT, DIA3).renglon.usd).toBeNull();
  });
});

describe("renglonZernio", () => {
  const fila = {
    periodStart: new Date("2026-11-01T00:00:00Z"),
    totalUsd: 0.05,
    prevTotalUsd: 0.712,
    prevPeriodStart: new Date("2026-10-01T00:00:00Z"),
    suspended: false,
    declineReason: null,
    openInvoice: false,
    lastError: null,
  };
  it("el mes anterior de Zernio cuando es el mes del reporte", () => {
    expect(renglonZernio(fila, OCT).renglon.usd).toBe(0.71);
  });
  it("otro mes: sin dato; cuenta suspendida: aviso", () => {
    expect(renglonZernio(fila, mesDe("2026-09")).renglon.usd).toBeNull();
    expect(renglonZernio({ ...fila, suspended: true }, OCT).avisos).toHaveLength(1);
  });
});

describe("renglonMeta y armarReporte", () => {
  it("Meta estimado con IVA; el total suma lo que tiene dato y el costo por venta usa ese total", () => {
    const meta = renglonMeta({ marketing: 100, utilidad: 10, servicio: 1000 });
    // (100 × 0.0431 + 10 × 0.0108 + 1000 × 0.0105) × 1.16 = 17.30
    expect(meta.usd).toBe(17.3);
    expect(meta.nota).toMatch(/^estimado por el CRM con IVA \(1,110 mensajes cobrables\)/);

    const r = armarReporte({
      mes: OCT,
      organizacion: "Diluvium",
      ia: { renglones: [{ servicio: "IA · Anthropic", paraQue: "x", usd: 30, nota: null }], avisos: ["a"] },
      railway: { renglon: { servicio: "Railway", paraQue: "x", usd: null, nota: "n" }, avisos: [] },
      zernio: { renglon: { servicio: "Zernio", paraQue: "x", usd: 1, nota: null }, avisos: ["z"] },
      meta,
      ventas: 10,
    });
    expect(r.totalUsd).toBe(48.3);
    expect(r.sinDato).toEqual(["Railway"]);
    expect(r.costoPorVentaUsd).toBe(4.83);
    expect(r.avisos).toEqual(["a", "z"]);
    expect(armarReporte({ ...r, ia: { renglones: [], avisos: [] }, railway: { renglon: meta, avisos: [] }, zernio: { renglon: meta, avisos: [] }, meta, ventas: 0 }).costoPorVentaUsd).toBeNull();
  });

  it("Meta sin conteo: sin dato", () => {
    expect(renglonMeta(null).usd).toBeNull();
  });
});
