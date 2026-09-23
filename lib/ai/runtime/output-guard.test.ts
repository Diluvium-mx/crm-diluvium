import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractAmounts, extractLinks, findBreakdowns, MAX_QTY, parseAmount, reviewReply } from "./output-guard";

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
    expect(r).toEqual({ ok: false, reason: "Monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: $4,200" });
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
      reason: "Monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: $1,000 · enlace fuera de la lista permitida: bit.ly/x",
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
  it("totales (opción A): solo con desglose correcto; montos escritos tal cual en la base pasan", () => {
    const docs = (f: string) => readFileSync(fileURLToPath(new URL(`../../../docs/agente-ia/${f}`, import.meta.url)), "utf8");
    const kb = {
      goal: docs("angela-goal.md"),
      faqs: (JSON.parse(docs("angela-faqs.json")) as { faqs: { question: string; answer: string }[] }).faqs.map(
        (f, i) => ({ ...f, position: i + 1 }),
      ),
    };
    const r = (t: string) => reviewReply(t, kb);
    // Descuento inventado (sin desglose) → retenido, aunque "cuadre" como suma de precios.
    expect(r("La mediana te la dejo en $6,500")).toEqual({
      ok: false,
      reason: "Monto que no está en el Goal ni en las FAQs ni tiene desglose correcto: $6,500",
    });
    expect(r("Las 3 te salen en $16,500").ok).toBe(false);
    // Desglose correcto (ejemplos del dueño) → pasa, también con el total repetido.
    expect(r("3 × $5,500 = $16,500")).toEqual({ ok: true });
    expect(r("$5,500 + $7,000 = $12,500")).toEqual({ ok: true });
    expect(r("Serían 3 x $5,500 = $16,500 MXN. Tu total queda en $16,500.")).toEqual({ ok: true });
    expect(r("2 × $5,500 + 1 × $7,000 = $18,000")).toEqual({ ok: true });
    expect(r("$5,500 × 3 = $16,500")).toEqual({ ok: true });
    expect(r("10 × $749 = $7,490")).toEqual({ ok: true });
    // Desglose con cuentas mal hechas → retenido con su motivo (aunque el total esté en la base).
    expect(r("3 × $5,500 = $15,000")).toEqual({
      ok: false,
      reason: `Desglose que no cuadra (precios de la base, cantidades de 1 a ${MAX_QTY}, cuenta exacta): 3 × $5,500 = $15,000`,
    });
    expect(r("3 × $5,500 = $11,000").ok).toBe(false);
    expect(r("2 × $5,500 + 1 × $7,000 = $18,500").ok).toBe(false);
    // Cantidad fuera de 1 a 10, o precio unitario que no está en la base → retenido.
    expect(r("11 × $749 = $8,239").ok).toBe(false);
    expect(r("3 × $5,000 = $15,000").ok).toBe(false);
    // Un desglose que se justifica a sí mismo con un precio inventado no cuela un descuento.
    expect(r("La mediana: 1 × $6,500 = $6,500")).toMatchObject({ ok: false, reason: expect.stringContaining("Desglose que no cuadra") });
    expect(r("Te queda en $6,500 = $6,500").ok).toBe(false);
    expect(r("2 × $3,250 = $6,500").ok).toBe(false);
    // Un desglose correcto no justifica OTRO monto de la misma respuesta.
    expect(r("3 × $5,500 = $16,500 y el envío te lo dejo en $15,000").ok).toBe(false);
    // Montos escritos tal cual en la base (anticipo, pago completo) → pasan como siempre.
    expect(r("El anticipo es de $3,500 y el resto antes del envío.")).toEqual({ ok: true });
    expect(r("Pago completo: $11,000")).toEqual({ ok: true });
  });

  it("findBreakdowns: posiciones, cantidad por omisión 1 y precio desactivado fuera", () => {
    const known = new Set([550_000, 700_000]);
    const [b] = findBreakdowns("Claro: $5,500 + $7,000 = $12,500 MXN", known);
    expect(b).toMatchObject({ text: "$5,500 + $7,000 = $12,500 MXN", start: 7, total: 1_250_000, valid: true });
    expect(findBreakdowns("sin cuentas aquí", known)).toEqual([]);
    // Una FAQ desactivada no aporta precios: $4,999 no vale como precio unitario.
    expect(reviewReply("2 × $4,999 = $9,998", knowledge).ok).toBe(false);
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
