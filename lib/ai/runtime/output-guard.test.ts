import { describe, expect, it } from "vitest";
import { extractAmounts, extractLinks, parseAmount, reviewReply } from "./output-guard";

// Base de conocimiento con la forma real (docs/agente-ia): precios con $ y los
// enlaces de Amazon y Mercado Libre en las FAQs.
const AMAZON = "https://www.amazon.com.mx/gp/product/B0F2792F2H?th=1";
const ML =
  "https://articulo.mercadolibre.com.mx/MLM-1966051269-compuerta-anti-inundaciones-defensa-proteccion-contra-agua-_JM?attributes=abc&quantity=1";
const knowledge = {
  goal: "Eres Angela. La compuerta mediana cuesta $5,500 MXN; dos salen en $11,000. Anticipo de 3,000 pesos.",
  faqs: [
    { position: 1, question: "¿Precio de la chica?", answer: "$3,500" },
    { position: 2, question: "¿Tapones?", answer: "$749 MXN, $799 MXN y $849 MXN" },
    { position: 3, question: "¿Venden en Amazon?", answer: `Sí: ${AMAZON}\n\nMercado Libre: ${ML}` },
    { position: 4, question: "¿Promoción?", answer: "Solo este mes $4,999", enabled: false },
  ],
};

describe("parseAmount / extractAmounts", () => {
  it("miles con coma o punto, decimales y 'mil'", () => {
    expect(parseAmount("5,500")).toBe(5500);
    expect(parseAmount("5.500")).toBe(5500);
    expect(parseAmount("5,500.50")).toBe(5500.5);
    expect(parseAmount("5.5", true)).toBe(5500);
    expect(parseAmount("749")).toBe(749);
  });
  it("detecta $, moneda y precio en contexto; una cifra cuenta una vez", () => {
    const v = (t: string) => extractAmounts(t).map((a) => a.value);
    expect(v("Cuesta $5,500 MXN")).toEqual([5500]);
    expect(v("son $ 5500.00")).toEqual([5500]);
    expect(v("te sale en 11 mil pesos")).toEqual([11000]);
    expect(v("el total es de 4,200")).toEqual([4200]);
    expect(v("$5 mil")).toEqual([5000]);
  });
  it("medidas y cantidades NO son montos", () => {
    expect(extractAmounts("Tu entrada mide 80 cm y lleva 2 compuertas de 1.20 m")).toEqual([]);
    expect(extractAmounts("cuesta 80 cm de alto")).toEqual([]);
    expect(extractAmounts("equivalen 2 metros")).toEqual([]);
  });
});

describe("extractLinks", () => {
  it("con y sin esquema, sin puntuación final; 'Diluvium.' no es enlace", () => {
    expect(extractLinks("Visita https://diluvium.com.mx/tienda. Gracias, Diluvium.")).toEqual(["https://diluvium.com.mx/tienda"]);
    expect(extractLinks("entra a bit.ly/abc123, o escribe a ventas@otro.com")).toEqual(["bit.ly/abc123", "otro.com"]);
    expect(extractLinks("S.A. de C.V., etc. 1.20 m")).toEqual([]);
  });
});

describe("reviewReply (guardia de salida)", () => {
  it("montos del Goal y de las FAQs activas pasan (en cualquier formato)", () => {
    expect(reviewReply("Claro, la mediana cuesta $5,500 MXN y la chica $3,500.", knowledge)).toEqual({ ok: true });
    expect(reviewReply("Dos te salen en 11 mil pesos; el anticipo es de $3,000.", knowledge)).toEqual({ ok: true });
    expect(reviewReply("Los tapones: $749, $799 o $849.", knowledge)).toEqual({ ok: true });
  });
  it("un monto inventado (o de una FAQ desactivada) → no se envía, con el motivo", () => {
    const r = reviewReply("Te la dejo en $4,200 y el envío gratis.", knowledge);
    expect(r).toEqual({ ok: false, reason: "Monto que no está en el Goal ni en las FAQs: $4,200" });
    expect(reviewReply("Promoción: $4,999", knowledge).ok).toBe(false);
    expect(reviewReply("el total es de 16,500", knowledge).ok).toBe(false);
  });
  it("enlaces: diluvium.com.mx y los de Amazon/Mercado Libre de las FAQs pasan", () => {
    expect(reviewReply("Mira https://www.diluvium.com.mx/compuertas y tienda.diluvium.com.mx", knowledge)).toEqual({ ok: true });
    expect(reviewReply(`En Amazon: ${AMAZON}`, knowledge)).toEqual({ ok: true });
    // Mismo producto de Mercado Libre sin los parámetros (como viene en el Goal).
    expect(
      reviewReply("https://articulo.mercadolibre.com.mx/MLM-1966051269-compuerta-anti-inundaciones-defensa-proteccion-contra-agua-_JM", knowledge),
    ).toEqual({ ok: true });
  });
  it("enlaces fuera de la lista → no se envía", () => {
    expect(reviewReply("Paga aquí: https://pagos-rapidos.com/diluvium", knowledge)).toEqual({
      ok: false,
      reason: "Enlace fuera de la lista permitida: https://pagos-rapidos.com/diluvium",
    });
    expect(reviewReply("otro producto: https://www.amazon.com.mx/gp/product/OTRO", knowledge).ok).toBe(false);
    expect(reviewReply("escríbeme por wa.me/5215555555555", knowledge).ok).toBe(false);
    expect(reviewReply("diluvium.com.mx.evil.com/x", knowledge).ok).toBe(false);
  });
  it("monto y enlace juntos → un solo motivo con ambos", () => {
    const r = reviewReply("Son $1,000 en bit.ly/x", knowledge);
    expect(r).toEqual({
      ok: false,
      reason: "Monto que no está en el Goal ni en las FAQs: $1,000 · enlace fuera de la lista permitida: bit.ly/x",
    });
  });
  it("respuesta sin montos ni enlaces pasa", () => {
    expect(reviewReply("¡Hola! ¿Cuánto mide de ancho tu entrada?", knowledge)).toEqual({ ok: true });
  });
});
