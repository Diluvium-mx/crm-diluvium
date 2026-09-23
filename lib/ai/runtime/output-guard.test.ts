import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractAmounts, extractLinks, extractPromos, findBreakdowns, MAX_QTY, parseAmount, reviewReply } from "./output-guard";

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
      // (Meses sin intereses y % dependen de la base: los cubre el test de promociones.)
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
  it("detección de montos (4ª revisión): 'mil' con resto, cifras sueltas, más contexto, Unicode y $ ilegible", () => {
    const held = (t: string) => reviewReply(t, knowledge).ok === false;
    for (const t of [
      "Te la dejo en $7 mil 500.", // antes se leía $7,000 (en la base) y el 500 quedaba suelto
      "La grande te queda en 11 mil 500.",
      "Te la dejo a 6500.",
      "Sí, 6500 está bien.",
      "Precio final 6500",
      "El costo es 2500",
      "Te dejo los 3 tapones por 2000.",
      "Te rebajo 500 si pagas hoy.",
      "Te la dejo a 850.", // 3 cifras: solo lo atrapa el contexto "dejo"
      "Te la dejo en ６５００", // cifras de ancho completo sin $: solo tras normalizar
      "Te la dejo en 6\u200b500", // ancho cero dentro del número
      "La grande sale en $11,000 + 500 de envío.",
      "＄6500", // signo de ancho completo
      "$６５００",
      "$6⁵⁰⁰",
      "$\u200b6500", // ancho cero
      "$\n6500", // salto de línea entre $ y cifras → no se pudo leer → revisión
      "$6,5000",
      "$ 6.500a@x.co",
    ]) expect(held(t), t).toBe(true);
    expect(reviewReply("$6,5000", knowledge)).toEqual({ ok: false, reason: "Monto que no se pudo leer: $6" });
    // Identificadores y datos que no son precio siguen pasando.
    for (const t of [
      "Tu CP 81200 y teléfono 668 242 6364, ¿correcto?",
      "Tu pedido #45821 ya salió.",
      "Desde 2019 fabricamos compuertas.",
      "Mide 1200 mm de ancho",
      "Horario de 9:00 a 18:00",
    ]) expect(held(t), t).toBe(false);
  });

  it("las cantidades de la frase deben ser las del desglose", () => {
    const r = (t: string) => reviewReply(t, knowledge).ok;
    expect(r("Para tus 6 compuertas el total es 3 × $5,500 = $16,500")).toBe(false);
    expect(r("Por las seis te queda: 3 × $5,500 = $16,500")).toBe(false);
    expect(r("3 × $5,500 = $16,500 las 6 compuertas")).toBe(false);
    expect(r("Para tus 3 compuertas: 3 × $5,500 = $16,500")).toBe(true);
    expect(r("Las dos: 2 × $5,500 = $11,000")).toBe(true);
    expect(r("Son 3 × $5,500 = $16,500 para tus 3 entradas de 95 cm.")).toBe(true); // 95 cm es medida
    expect(r("Tus 2 medianas y 1 chica: 2 × $5,500 + 1 × $3,500 = $14,500")).toBe(true); // 2, 1 y 3 piezas
  });

  it("un enlace en medio no oculta un precio en contexto; un monto con forma de correo cuenta", () => {
    expect(reviewReply("Te la dejo en diluvium.com.mx 4200", knowledge).ok).toBe(false);
    expect(reviewReply("Cuesta www.diluvium.com.mx 850", knowledge).ok).toBe(false);
    expect(reviewReply("total $6.500@x.co", knowledge).ok).toBe(false);
    expect(reviewReply("total $6.500a@x.co", knowledge).ok).toBe(false);
    expect(reviewReply("Cuesta diluvium.com.mx diluvium.com.mx diluvium.com.mx 6500", knowledge).ok).toBe(false);
    expect(reviewReply("Escríbeme a ventas@diluvium.com.mx o a juan.perez@gmail.com", knowledge)).toEqual({ ok: true });
  });

  it("sin retroceso exponencial: entradas patológicas se revisan en milisegundos", () => {
    const bad = [
      "precio" + " de".repeat(200) + " x",
      "a".repeat(5000) + ".",
      "a.".repeat(2000) + "!",
      "1".repeat(5000) + "x",
      "1,".repeat(2500) + "x",
      ("a-".repeat(60) + ".").repeat(40),
      "1 x x $1 + ".repeat(700),
      "$1+".repeat(2600) + "=",
      "mediana $5,500 + ".repeat(400) + "= $1",
      "(a) ".repeat(1900) + "= $1",
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
    expect(r("Serían 3 x $5,500 = $16,500 MXN en total.")).toEqual({ ok: true });
    // Con etiquetas de vocabulario cerrado y frases de precio unitario.
    expect(r("Grande $7,000 + mediana $5,500 = $12,500")).toEqual({ ok: true });
    expect(r("$5,500 (mediana) + $7,000 (grande) = $12,500")).toEqual({ ok: true });
    expect(r("Mediana $5,500 + tapón $749 = $6,249")).toEqual({ ok: true });
    expect(r("3 × $749 por pieza = $2,247")).toEqual({ ok: true });
    expect(r("$5,500 c/u + $7,000 = $12,500")).toEqual({ ok: true });
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
    // Un desglose correcto no justifica OTRO monto de la misma respuesta, ni el MISMO
    // número en otra frase (desglose "señuelo" para colar un descuento).
    expect(r("3 × $5,500 = $16,500 y el envío te lo dejo en $15,000").ok).toBe(false);
    expect(r("$3,000 + $3,500 = $6,500. La grande te la dejo en $6,500.").ok).toBe(false);
    expect(r("Referencia: 1 × $5,500 + 1 × $749 = $6,249.\n\nLa grande te la dejo en $6,249 si pagas hoy.").ok).toBe(false);
    expect(r("Serían 3 x $5,500 = $16,500 MXN. Tu total queda en $16,500.").ok).toBe(false);
    // Operaciones encadenadas o restas: solo se leería un pedazo de la cuenta.
    for (const t of [
      "3 × $749 × 2 = $1,498",
      "3 × 2 × $749 = $1,498",
      "3 × $749 × 2 = $4,494",
      "3 × $5,500 = $16,500 − $1,500 = $15,000",
      "3 × $5,500 = $16,500 - $1,500",
      "3 × $5,500 menos $1,000 = $15,500",
      // Restarle un monto que SÍ está en la base (la mini, $3,000) no vuelve válido el total,
      // con cualquier raya o con palabras.
      "3 × $5,500 = $16,500 − $3,000",
      "3 × $5,500 = $16,500 - $3,000",
      "3 × $5,500 = $16,500 – $3,000 de descuento",
      "3 × $5,500 = $16,500 — $3,000",
      "3 × $5,500 = $16,500 menos $3,000",
      "3 × $5,500 = $16,500, menos $3,000",
      "3 × $5,500 = $16,500 ÷ 2",
      "$11,000 – $3,000 + $3,500 = $6,500",
      "$11,000 entre $3,000 + $3,500 = $6,500",
      "Grande $11,000 menos mini $3,000 + chica $3,500 = $6,500",
    ]) expect(r(t).ok, t).toBe(false);
    // Etiquetas que esconden montos, cantidades u operaciones → revisión humana.
    for (const t of [
      "Grande $11,000 (hoy $6,500) = $11,000",
      "Mediana $5,500 (hoy 4,500) = $5,500",
      "$7,000 ($1,000 de descuento) = $7,000",
      "Mediana (hoy $4,500) $5,500 = $5,500",
      "$5,500 (x2) + $7,000 = $12,500",
      "3 × $749 (×2) = $2,247",
      "3 × $5,500 x tres = $16,500",
      "$5,500 x dos + $7,000 = $12,500",
      "dos x $5,500 + $7,000 = $12,500",
      "3 medianas $5,500 + grande $7,000 = $12,500",
      "tres × $5,500 = $16,500",
      "3 × $749 por 2 = $1,498",
      // Falso positivo aceptado (lado seguro): la etiqueta no admite cifras.
      "2 compuertas medianas (1 m) × $5,500 = $11,000",
    ]) expect(r(t).ok, t).toBe(false);
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

  it("promociones: %, NxM y meses sin intereses solo si están tal cual en la base activa", () => {
    const docs = (f: string) => readFileSync(fileURLToPath(new URL(`../../../docs/agente-ia/${f}`, import.meta.url)), "utf8");
    const goal = docs("angela-goal.md");
    const faqs = (JSON.parse(docs("angela-faqs.json")) as { faqs: { question: string; answer: string }[] }).faqs.map(
      (f, i) => ({ ...f, position: i + 1 }),
    );
    const kb = { goal, faqs };
    // La base real trae 50% y 6 meses sin intereses; lo codificado dentro de un enlace ("%3A", "39x3") no cuenta.
    const base = [...new Set(extractPromos(`${goal}\n${faqs.map((f) => `${f.question}\n${f.answer}`).join("\n")}`).map((p) => p.key))];
    expect(base.sort()).toEqual(["%50", "msi6"]);
    expect(reviewReply("Te puedo dar un 10% de descuento si pagas hoy.", kb)).toEqual({
      ok: false,
      reason: "Promoción que no está en el Goal ni en las FAQs: 10%",
    });
    for (const t of [
      "Solo por hoy tenemos 2x1 en tapones.",
      "Llévate 3x2",
      "Promoción 2 por 1",
      "2 × 1 en tapones",
      "Hasta 18 meses sin intereses.",
      "Paga a 12 MSI",
      "Te hago el 15 por ciento",
      "3 × $5,500 = $16,500 con 10% de descuento",
      // Revisión final (P1): puntuación al final, "interés" en singular, mensualidades y plazo aparte.
      "Esta semana tenemos 2x1.",
      "Aprovecha el 2x1, solo hoy.",
      "Solo hoy: 2 por 1.",
      "Sí, también a 12 meses sin interés con tarjeta participante.",
      "Sí, puedes pagar hasta en 12 mensualidades sin intereses.",
      "Sí, manejamos meses sin intereses: hasta 12 meses con tarjeta de crédito.",
      "Tenemos MSI hasta 12 meses.",
    ]) expect(reviewReply(t, kb).ok, t).toBe(false);
    for (const t of [
      "Puedes pagar a 6 meses sin intereses.",
      "El anticipo es del 50%.",
      "La entrada mide 90x60 cm", // medida, no promoción
      "3 × $5,500 = $16,500",
      "Sí, 6 meses sin interés.",
      "Sí, 6 meses sin intereses. La fabricación tarda 3 semanas.",
    ]) expect(reviewReply(t, kb), t).toEqual({ ok: true });
    // Una promo de una FAQ DESACTIVADA no cuenta.
    const off = { goal: "Eres Angela.", faqs: [{ position: 1, question: "¿Promo?", answer: "2x1 en tapones", enabled: false }] };
    expect(reviewReply("Tenemos 2x1 en tapones", off).ok).toBe(false);
    expect(reviewReply("Tenemos 2x1 en tapones", { ...off, faqs: [{ ...off.faqs[0], enabled: true }] })).toEqual({ ok: true });
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
