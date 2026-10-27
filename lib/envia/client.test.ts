// Cliente de Envia (docs/envios.md): lectura tolerante de cada respuesta y errores que se ven en la UI
// tal cual (incluido el «200 con meta: error» documentado por Envia). Sin red: fetch falso.
import { describe, expect, it } from "vitest";
import { enviaConfigFrom } from "./config";
import {
  EnviaApiError,
  enviaClient,
  enviaErrorMessage,
  parseCancel,
  parseGenerated,
  parseOrigins,
  parsePackages,
  parseRates,
  parseZip,
  shipmentBody,
  type ShipmentRequest,
} from "./client";

const CONFIG = enviaConfigFrom({ ENVIA_API_TOKEN: "token-de-pruebas", ENVIA_ENV: "sandbox" })!;

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = handler(url, init ?? {});
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const REQUEST: ShipmentRequest = {
  origin: { name: "Diluvium", phone: "6680000000", street: "Calle Origen", city: "Los Mochis", state: "SI", country: "MX", postalCode: "81200" },
  destination: { name: "María López", phone: "6681112233", street: "Av. Ejemplo", number: "123", district: "Centro", city: "Los Mochis", state: "SI", country: "MX", postalCode: "81200", reference: "Portón negro" },
  packages: [{ content: "Compuerta Anti-Inundaciones", declaredValue: 5500, weightKg: 13, lengthCm: 91, widthCm: 14, heightCm: 66, insuranceMxn: null }],
  carrier: "paquetexpress",
};

describe("configuración", () => {
  it("sin token o con ambiente desconocido no hay Envia", () => {
    expect(enviaConfigFrom({ ENVIA_ENV: "sandbox" })).toBeNull();
    expect(enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "prod" })).toBeNull();
  });
  it("candado del saldo: la cuenta real solo genera con ENVIA_GENERAR=si; la de pruebas siempre", () => {
    expect(CONFIG.canGenerate).toBe(true);
    expect(enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "production" })?.canGenerate).toBe(false);
    expect(enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "production", ENVIA_GENERAR: "no" })?.canGenerate).toBe(false);
    expect(enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "production", ENVIA_GENERAR: " Si " })?.canGenerate).toBe(true);
  });

  it("pruebas y producción usan sus propias URLs", () => {
    expect(CONFIG.shipUrl).toBe("https://api-test.envia.com");
    expect(CONFIG.queriesUrl).toBe("https://queries.test.envia.com");
    expect(enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "production" })?.shipUrl).toBe("https://api.envia.com");
  });
});

describe("lectura de respuestas", () => {
  it("código postal: estado de 2 letras, ciudad y colonias sin repetir", () => {
    const zip = parseZip([
      {
        zip_code: "81200",
        state: { name: "Sinaloa", code: { "2digit": "SI", "3digit": "SIN" } },
        locality: "Los Mochis",
        suburbs: ["Centro", "Anáhuac", "Centro"],
      },
    ]);
    expect(zip).toEqual({ postalCode: "81200", state: "SI", stateName: "Sinaloa", city: "Los Mochis", colonias: ["Anáhuac", "Centro"] });
    expect(parseZip([])).toBeNull();
  });

  it("embalajes guardados", () => {
    expect(parsePackages({ success: true, data: [{ id: 7, name: " Compuerta Chica ", length: 91, width: 14, height: 66, weight: "13" }] })).toEqual([
      { id: "7", name: "Compuerta Chica", lengthCm: 91, widthCm: 14, heightCm: 66, weightKg: 13 },
    ]);
  });

  it("origen: lee camelCase o snake_case y la marca de favorita; descarta las incompletas", () => {
    const origins = parseOrigins({
      data: [
        { name: "Bodega", phone: "6680000000", street: "Calle 1", city: "Culiacán", state: "SI", postal_code: "80000" },
        { name: "Oficina", phone: "6680000001", street: "Calle 2", number: "10", city: "Los Mochis", state_code: "SI", postalCode: "81200", is_favorite: 1 },
        { name: "Sin CP", phone: "1", street: "x", city: "y", state: "SI" },
      ],
    });
    expect(origins).toHaveLength(2);
    expect(origins[1]).toMatchObject({ favorite: true, address: { name: "Oficina", number: "10", postalCode: "81200", country: "MX" } });
    expect(origins[0]!.favorite).toBe(false);
  });

  it("cotización: precio en texto → número", () => {
    expect(parseRates({ meta: "rate", data: [{ carrier: "estafeta", service: "ground", serviceDescription: "Terrestre", deliveryEstimate: "3-5 días", totalPrice: "355.40", currency: "MXN" }] })).toEqual([
      { carrier: "estafeta", service: "ground", serviceLabel: "Terrestre", price: 355.4, currency: "MXN", delivery: "3-5 días" },
    ]);
  });

  it("guía: rastreo, liga de la etiqueta, precio y saldo; varias cajas juntan sus rastreos", () => {
    const label = parseGenerated({
      meta: "generate",
      data: [
        { shipmentId: 166819, trackingNumber: "7072262094", trackUrl: "https://test.envia.com/rastreo?label=7072262094", label: "https://s3.us-east-2.amazonaws.com/envia-staging/x.pdf", totalPrice: 271.65, currentBalance: 9840, currency: "MXN" },
        { trackingNumber: "7072262095", label: "https://s3.us-east-2.amazonaws.com/envia-staging/y.pdf" },
      ],
    });
    expect(label).toMatchObject({ shipmentId: "166819", trackingNumber: "7072262094", price: 271.65, balance: 9840 });
    expect(label.trackingNumbers).toEqual(["7072262094", "7072262095"]);
    expect(() => parseGenerated({ meta: "generate", data: [] })).toThrow(EnviaApiError);
  });

  it("cancelación con reembolso", () => {
    expect(parseCancel({ meta: "cancel", data: { balanceReturned: true, balanceReturnDate: "2025-10-10 12:31:00" } })).toEqual({ balanceReturned: true, balanceReturnDate: "2025-10-10 12:31:00" });
  });

  it("mensajes de error de Envia en sus formas conocidas", () => {
    expect(enviaErrorMessage({ meta: "error", error: { code: 400, description: "Invalid Option", message: "The origin.postalCode field is required." } })).toBe(
      "The origin.postalCode field is required. · Invalid Option",
    );
    expect(enviaErrorMessage({ message: "Unauthorized" })).toBe("Unauthorized");
    expect(enviaErrorMessage({ errors: ["a", "b"] })).toBe("a · b");
    expect(enviaErrorMessage(null)).toBeNull();
  });
});

describe("peticiones", () => {
  it("el cuerpo lleva cajas en CM/KG, país MX y el seguro solo si se pidió", () => {
    const body = shipmentBody({ ...REQUEST, packages: [{ ...REQUEST.packages[0]!, insuranceMxn: 5500 }] }, { printFormat: "PDF", printSize: "PAPER_LETTER" });
    expect(body.packages[0]).toMatchObject({
      type: "box",
      amount: 1,
      lengthUnit: "CM",
      weightUnit: "KG",
      dimensions: { length: 91, width: 14, height: 66 },
      additionalServices: [{ service: "envia_insurance", data: { amount: "5500" } }],
    });
    expect(body.destination).toMatchObject({ country: "MX", state: "SI", district: "Centro", reference: "Portón negro" });
    expect(body.settings).toEqual({ currency: "MXN", printFormat: "PDF", printSize: "PAPER_LETTER" });
    expect(shipmentBody(REQUEST).packages[0]).not.toHaveProperty("additionalServices");
  });

  it("cotiza con el token y una paquetería por llamada", async () => {
    const f = fakeFetch(() => ({ body: { meta: "rate", data: [{ carrier: "paquetexpress", service: "ground", totalPrice: "310", currency: "MXN" }] } }));
    const options = await enviaClient(CONFIG, { fetchImpl: f.impl }).rate(REQUEST);
    expect(options[0]!.price).toBe(310);
    expect(f.calls[0]!.url).toBe("https://api-test.envia.com/ship/rate/");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer token-de-pruebas");
    expect(JSON.parse(String(f.calls[0]!.init.body)).shipment).toEqual({ type: 1, carrier: "paquetexpress" });
  });

  it("un 200 con meta: error es error (con el mensaje de Envia)", async () => {
    const f = fakeFetch(() => ({ body: { meta: "error", error: { code: 400, message: "The destination.postalCode field is required." } } }));
    await expect(enviaClient(CONFIG, { fetchImpl: f.impl }).rate(REQUEST)).rejects.toThrow("The destination.postalCode field is required.");
  });

  it("sin saldo (402) y token rechazado (401) dicen qué pasó", async () => {
    const sinSaldo = fakeFetch(() => ({ status: 402, body: { message: "Payment Required" } }));
    await expect(enviaClient(CONFIG, { fetchImpl: sinSaldo.impl }).generate({ ...REQUEST, service: "ground" }, { printFormat: "PDF", printSize: "PAPER_LETTER" })).rejects.toThrow(
      "No hay saldo suficiente en Envia.",
    );
    const token = fakeFetch(() => ({ status: 401, body: { message: "Unauthorized" } }));
    await expect(enviaClient(CONFIG, { fetchImpl: token.impl }).listPackages()).rejects.toThrow(/rechazó el token \(401\)/);
  });

  it("con el candado cerrado, generar ni siquiera llama a Envia", async () => {
    const f = fakeFetch(() => ({ body: { meta: "generate", data: [] } }));
    const real = enviaConfigFrom({ ENVIA_API_TOKEN: "x", ENVIA_ENV: "production" })!;
    await expect(enviaClient(real, { fetchImpl: f.impl }).generate({ ...REQUEST, service: "ground" }, { printFormat: "PDF", printSize: "PAPER_LETTER" })).rejects.toThrow(
      "Generar guías está apagado",
    );
    expect(f.calls).toHaveLength(0);
  });

  it("el código postal va a geocodes sin token; uno mal escrito ni se pregunta", async () => {
    const f = fakeFetch(() => ({ body: [{ zip_code: "81200", state: { name: "Sinaloa", code: { "2digit": "SI" } }, locality: "Los Mochis", suburbs: [] }] }));
    const client = enviaClient(CONFIG, { fetchImpl: f.impl });
    expect((await client.lookupZip("81200"))?.state).toBe("SI");
    expect(f.calls[0]!.url).toBe("https://geocodes.envia.com/zipcode/MX/81200");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(await client.lookupZip("812")).toBeNull();
    expect(f.calls).toHaveLength(1);
  });

  it("la etiqueta solo se baja de Envia o de S3", async () => {
    const f = fakeFetch(() => ({ body: "%PDF-1.4" }));
    const client = enviaClient(CONFIG, { fetchImpl: f.impl, resolve: async () => ["52.219.0.1"] });
    expect((await client.downloadLabel("https://s3.us-east-2.amazonaws.com/envia-staging/x.pdf")).byteLength).toBeGreaterThan(0);
    await expect(client.downloadLabel("https://ejemplo.com/x.pdf")).rejects.toThrow(/No se pudo bajar la etiqueta/);
  });
});
