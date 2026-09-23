import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractAmounts, extractLinks, MAX_PIECES, parseAmount, reviewReply, sumsOfPrices } from "./output-guard";

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
    // Un correo no es enlace (salvo el engaño con dominio en la parte local).
    expect(extractLinks("entra a bit.ly/abc123, o escribe a ventas@otro.com")).toEqual(["bit.ly/abc123"]);
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
    expect(r).toEqual({ ok: false, reason: "Monto que no está en el Goal ni en las FAQs ni es suma de sus precios: $4,200" });
    expect(reviewReply("Promoción: $4,999", knowledge).ok).toBe(false);
    expect(reviewReply("el total es de 16,501", knowledge).ok).toBe(false);
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
      reason: "Monto que no está en el Goal ni en las FAQs ni es suma de sus precios: $1,000 · enlace fuera de la lista permitida: bit.ly/x",
    });
  });
  it("respuesta sin montos ni enlaces pasa", () => {
    expect(reviewReply("¡Hola! ¿Cuánto mide de ancho tu entrada?", knowledge)).toEqual({ ok: true });
  });
});

describe("guardia: lo que encontró la revisión enfocada (23-sep)", () => {
  const held = (t: string) => reviewReply(t, knowledge).ok === false;
  it("montos sin $ ni moneda, con 'mil', rangos, miles con espacio, moneda antes o $ después → retenidos", () => {
    for (const t of [
      "Te la dejo en 4 mil",
      "Son 8 mil las dos",
      "Serían 4,200 en total",
      "Te la dejo en 4,200",
      "entre $3,500 y 4,200",
      "$3,500–4,200",
      "Mediana: 4,200",
      "MXN 4200",
      "4200$",
      "$  4,200",
      "$4 200",
      "$4.200",
      "te queda en 4200mxn",
      "Son 850 las dos",
    ]) expect(held(t), t).toBe(true);
  });
  it("enlaces con cualquier TLD, www., @ en la ruta, usuario, IP u homógrafo → retenidos", () => {
    for (const t of [
      "paga en pagos-diluvium.ru",
      "www.evil.ru/pago",
      "evil.ai",
      "is.gd/abc",
      "linktr.ee/x",
      "pagos.com/x@diluvium.com.mx",
      "diluvium.com.mx@evil.com",
      "https://diluvium.com.mx@evil.com/pago",
      "HTTPS://EVIL.COM",
      "[diluvium](https://evil.com)",
      "http://1.2.3.4/pago",
      "1.2.3.4/pago",
      "diluvіum.com.mx", // "і" cirílica
    ]) expect(held(t), t).toBe(true);
  });
  it("respuestas normales NO se retienen (tiempos, cantidades, medidas, %, correos, direcciones)", () => {
    for (const t of [
      "Tu pedido sale en 3 a 5 días hábiles",
      "La fabricación queda en 3 semanas",
      "Puedes hacer el pago a 6 meses sin intereses",
      "El pago es en 2 partes: 50% y 50%",
      "En total: 3 tapones de $749",
      "Precio por 2 entradas",
      "La compuerta de 1.20 m cuesta $5,500 MXN",
      "Mide 60 cm de alto y pesa 12 kg",
      "Abrimos de 9:00 a.m. a 6:00 p.m.",
      "Calle Morelos #254",
      "Te envío la factura a juan.perez@gmail.com",
      "Manda la foto.jpg o el comprobante.pdf",
    ]) expect(held(t), t).toBe(false);
  });
  it("sin retroceso exponencial: entradas patológicas se revisan en milisegundos", () => {
    const bad = [
      "precio" + " de".repeat(200) + " x",
      "a".repeat(5000) + ".",
      "a.".repeat(2000) + "!",
      "1".repeat(5000) + "x",
      "1,".repeat(2500) + "x",
      ("a-".repeat(60) + ".").repeat(40),
    ];
    for (const b of bad) {
      const t0 = performance.now();
      reviewReply(b, knowledge);
      expect(performance.now() - t0, b.slice(0, 20)).toBeLessThan(200);
    }
    expect(reviewReply("x".repeat(9_000), knowledge)).toEqual({ ok: false, reason: "Respuesta demasiado larga para revisarla sola" });
  });
  it("totales: suma de hasta 10 precios reales de la base (con repetición) pasa; cualquier otro, no", () => {
    const docs = (f: string) => readFileSync(fileURLToPath(new URL(`../../../docs/agente-ia/${f}`, import.meta.url)), "utf8");
    const kb = {
      goal: docs("angela-goal.md"),
      faqs: (JSON.parse(docs("angela-faqs.json")) as { faqs: { question: string; answer: string }[] }).faqs.map(
        (f, i) => ({ ...f, position: i + 1 }),
      ),
    };
    const ok = (t: string) => reviewReply(t, kb).ok;
    // Los ejemplos del dueño, con los precios reales ($5,500 y $7,000).
    expect(ok("Las 3 medianas te salen en $16,500")).toBe(true);
    expect(ok("Mediana + grande: $12,500 en total")).toBe(true);
    expect(ok("10 tapones de 2 pulgadas: $7,490")).toBe(true); // 10 × $749
    expect(ok("Dos compuertas y un tapón: 11,749 pesos")).toBe(true); // $5,500 + $5,500 + $749
    // Hasta 10 piezas: 11 ya no.
    expect(ok("11 tapones de 2 pulgadas: $8,239")).toBe(false); // 11 × $749
    expect(ok("11 kits grandes: $121,000")).toBe(false); // 11 × $11,000
    // Montos que no son suma de precios reales.
    for (const t of ["Te la dejo en $4,200", "$16,501", "Son 8 mil las dos", "$1,000 de descuento"]) expect(ok(t), t).toBe(false);
  });

  it("sumsOfPrices: tabla en unidades del mcd, tope de piezas y precios desactivados fuera", () => {
    const c = (pesos: number) => pesos * 100;
    const got = sumsOfPrices([c(16_500), c(16_501), c(55_000), c(60_500)], [c(5_500)]);
    expect([...got].sort((a, b) => a - b)).toEqual([c(16_500), c(55_000)]); // 10 × 5,500 sí; 11 × 5,500 no
    expect(MAX_PIECES).toBe(10);
    expect(sumsOfPrices([c(100)], [])).toEqual(new Set());
    // Una FAQ desactivada no aporta piezas: promo ($4,999, desactivada) + tapón ($749) = $5,748
    // solo se forma con ese precio, así que se retiene.
    expect(reviewReply("Promo y un tapón: $5,748", knowledge).ok).toBe(false);
  });

  it("la base real (Goal + 47 FAQs) pasa completa: sus propios montos y enlaces están permitidos", () => {
    const docs = (f: string) => readFileSync(fileURLToPath(new URL(`../../../docs/agente-ia/${f}`, import.meta.url)), "utf8");
    const goal = docs("angela-goal.md");
    const faqs = (JSON.parse(docs("angela-faqs.json")) as { faqs: { question: string; answer: string }[] }).faqs.map(
      (f, i) => ({ ...f, position: i + 1 }),
    );
    const kb = { goal, faqs };
    for (const f of faqs) expect(reviewReply(f.answer, kb), f.question).toEqual({ ok: true });
    for (const chunk of goal.split(/\n\n+/)) expect(reviewReply(chunk, kb), chunk.slice(0, 60)).toEqual({ ok: true });
  });
});
